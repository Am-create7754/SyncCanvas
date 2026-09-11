import { boundsOfPoints } from './points.js';

/** Shapes Phase 11 supports rotation for. Circle is deliberately excluded — an unfilled
 *  circle stroke is rotationally symmetric, so rotating it would be visually meaningless
 *  (per spec: "irrelevant unless its styling/content makes rotation meaningful"). Sticky
 *  notes (Phase 12) are included — a tilted note is a normal, meaningful diagram element.
 *  Frames and connectors are deliberately excluded: a frame organizes other objects
 *  spatially (a rotated container would make "is this object inside the frame" ambiguous),
 *  and a connector's shape is derived from its endpoints, not something it has of its own. */
export const ROTATABLE_TYPES = new Set(['rect', 'line', 'sticky']);

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** @returns {number} `degrees` normalized into [0, 360) — the one canonical range every
 *  reader/writer of `object.rotation` agrees on (server validation included). */
export function normalizeRotation(degrees) {
  return ((degrees % 360) + 360) % 360;
}

/** @returns {{x:number,y:number}} the world-space center of an object's LOCAL (unrotated)
 *  point definition — `object.points` always describes the shape as if rotation were 0;
 *  rotation is applied entirely as a transform around this center, both when rendering and
 *  when hit-testing, never baked into the stored points themselves. */
export function getObjectCenter(object) {
  const { minX, minY, maxX, maxY } = boundsOfPoints(object.points);
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** Rotates `point` around `center` by `degrees` (clockwise, matching canvas/screen
 *  convention where +y is down). */
export function rotateAround(point, center, degrees) {
  if (!degrees) return { x: point.x, y: point.y };
  const rad = degrees * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/** Inverse of `rotateAround` — converts a WORLD point into the object's LOCAL (unrotated)
 *  frame, which is what makes hit-testing and resize math correct for a rotated object:
 *  everything downstream (hitTestObject, resizePoints) already only understands the
 *  unrotated shape, so transforming the query point once here lets all of that code run
 *  completely unchanged. */
export function toLocalPoint(worldPoint, center, degrees) {
  return rotateAround(worldPoint, center, -degrees);
}

/** @returns {number} the clockwise angle in degrees from `center` to `point`, in the same
 *  convention `rotateAround` uses (0° = pointing right/+x, increasing clockwise). */
export function angleFromCenter(center, point) {
  return Math.atan2(point.y - center.y, point.x - center.x) * RAD_TO_DEG;
}

/** @returns {number} `degrees` snapped to the nearest multiple of `increment`, then
 *  normalized — used for Shift-constrained rotation (spec: 15° increments). */
export function snapRotation(degrees, increment = 15) {
  return normalizeRotation(Math.round(degrees / increment) * increment);
}

/** @returns {{minX,minY,maxX,maxY}} the object's TRUE on-screen extent, accounting for
 *  rotation — the 4 local-bbox corners rotated into world space, then re-bounded. For
 *  rotation 0 this is identical to `boundsOfPoints(object.points)`. Used specifically
 *  where under-reporting a rotated object's extent would be visibly wrong (mini-map
 *  content bounds, Fit to Content) — deliberately NOT used for align/distribute or the
 *  multi-select bounding box, which stay defined in terms of each object's LOCAL geometry
 *  (see Phase 11 report for why that's an intentional scope boundary, not an oversight). */
export function visualBoundsOfObject(object) {
  const rotation = object.rotation ?? 0;
  const localBounds = boundsOfPoints(object.points);
  if (!rotation) return localBounds;
  const { minX, minY, maxX, maxY } = localBounds;
  const center = getObjectCenter(object);
  const corners = [
    { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY },
  ].map((p) => rotateAround(p, center, rotation));
  return boundsOfPoints(corners);
}

const HANDLE_WORLD_OFFSET_BASE = 28; // screen px above the bbox top edge, before /scale

/** @returns {{x:number,y:number}} the rotation handle's WORLD position for `object` at the
 *  given viewport scale — computed in local space (a fixed offset above the bbox's local
 *  top-center) then rotated into world space, so it visually tracks the object's current
 *  rotation exactly like the resize handles do. */
export function getRotationHandlePosition(object, scale) {
  const { minX, minY, maxX } = boundsOfPoints(object.points);
  const localHandle = { x: (minX + maxX) / 2, y: minY - HANDLE_WORLD_OFFSET_BASE / scale };
  const center = getObjectCenter(object);
  return rotateAround(localHandle, center, object.rotation ?? 0);
}
