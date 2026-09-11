import { boundsOfPoints } from './points.js';
import { getObjectCenter, toLocalPoint } from './rotation.js';

/** @returns {number} shortest distance from point `p` to the segment `a`-`b`. */
function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

function hitTestStroke(points, p, tolerance) {
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y) <= tolerance;
  for (let i = 1; i < points.length; i++) {
    if (distanceToSegment(p, points[i - 1], points[i]) <= tolerance) return true;
  }
  return false;
}

function hitTestEllipse(points, p, tolerance) {
  if (points.length < 2) return false;
  const [a, b] = points;
  const rx = Math.abs(b.x - a.x) / 2 + tolerance;
  const ry = Math.abs(b.y - a.y) / 2 + tolerance;
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  if (rx === 0 || ry === 0) return false;
  const nx = (p.x - cx) / rx;
  const ny = (p.y - cy) / ry;
  return nx * nx + ny * ny <= 1;
}

function hitTestBoundingBox(points, p, tolerance) {
  if (points.length < 2) return false;
  const { minX, minY, maxX, maxY } = boundsOfPoints(points);
  return p.x >= minX - tolerance && p.x <= maxX + tolerance && p.y >= minY - tolerance && p.y <= maxY + tolerance;
}

/**
 * @returns {boolean} true if world point `p` counts as "clicking on" `object`. Shapes are
 * unfilled strokes on screen, but for usability we treat their whole bounding box (rect)
 * or ellipse (circle) as clickable rather than requiring a pixel-precise hit on the
 * outline — matching how most drawing tools let you select a shape from anywhere inside it.
 */
export function hitTestObject(object, p, tolerance) {
  // Phase 11: a rotated object's `points` always describe its UNROTATED shape (rotation
  // is a pure rendering/hit-testing transform, never baked into stored geometry — see
  // canvas/geometry/rotation.js) — so hit-testing it correctly means transforming the
  // query point INTO that local frame first, then running the exact same per-type tests
  // below unchanged, rather than teaching each one about rotation individually.
  const localP = object.rotation ? toLocalPoint(p, getObjectCenter(object), object.rotation) : p;
  switch (object.type) {
    case 'path':
    case 'eraser':
    case 'line':
      return hitTestStroke(object.points, localP, tolerance + object.width / 2);
    case 'connector':
      // A connector's `points` is its fully-routed polyline (straight or elbow — see
      // canvas/geometry/connector.js) — the exact same stroke hit-test a line/path
      // already uses, no connector-specific geometry needed. Connectors never rotate
      // (their shape is derived from two OTHER objects' positions), so `localP` here is
      // just `p` unchanged.
      return hitTestStroke(object.points, localP, tolerance + object.width / 2);
    case 'circle':
      return hitTestEllipse(object.points, localP, tolerance);
    case 'rect':
    case 'sticky':
    case 'frame':
      return hitTestBoundingBox(object.points, localP, tolerance);
    default:
      return false;
  }
}

/** @returns {string|null} the id of the topmost object under `p`, or null if none. */
export function hitTestScene(objectsMap, p, tolerance) {
  const objects = [...objectsMap.values()];
  for (let i = objects.length - 1; i >= 0; i--) {
    if (hitTestObject(objects[i], p, tolerance)) return objects[i].id;
  }
  return null;
}
