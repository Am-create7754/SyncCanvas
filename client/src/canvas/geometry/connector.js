import { boundsOfPoints } from './points.js';
import { getObjectCenter, rotateAround } from './rotation.js';
import { CONNECTOR_ANCHORS } from '@synccanvas/shared';

/**
 * Pure connector geometry (Phase 12) — anchor positions, routing, label placement,
 * arrowhead orientation. No canvas, no engine state, matching every other module in this
 * folder. Rotation-awareness is entirely delegated to `rotateAround`/`getObjectCenter`
 * (Phase 11) rather than re-derived here — a rotated shape's anchors are just its
 * unrotated anchors passed through the exact same transform the object itself renders
 * with.
 */

/** Shapes a connector can attach to. Freehand strokes (path/eraser) are excluded — an
 *  arbitrary stroke doesn't have a stable rectangular "side" the way a shape does — and a
 *  connector can never attach to another connector. */
export const CONNECTABLE_TYPES = new Set(['rect', 'circle', 'line', 'sticky', 'frame']);

const DEFAULT_ELBOW_PADDING = 20;

function localAnchorPoint(shape, anchor) {
  const { minX, minY, maxX, maxY } = boundsOfPoints(shape.points);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  switch (anchor) {
    case 'top': return { x: midX, y: minY };
    case 'right': return { x: maxX, y: midY };
    case 'bottom': return { x: midX, y: maxY };
    case 'left': return { x: minX, y: midY };
    default: return { x: midX, y: midY };
  }
}

/** @returns {{x,y}} the WORLD-space position of `shape`'s named anchor, accounting for
 *  its current rotation (Phase 11 reuse — see module doc comment). */
export function computeAnchorPoint(shape, anchor) {
  const local = localAnchorPoint(shape, anchor);
  const rotation = shape.rotation ?? 0;
  return rotation ? rotateAround(local, getObjectCenter(shape), rotation) : local;
}

/** @returns {Array<{anchor:string, point:{x,y}}>} all four cardinal anchors for `shape`,
 *  in world space — what the ephemeral anchor-dot overlay renders. */
export function getAllAnchorPoints(shape) {
  return CONNECTOR_ANCHORS.map((anchor) => ({ anchor, point: computeAnchorPoint(shape, anchor) }));
}

/** @returns {{anchor:string, point:{x,y}, dist:number}} whichever of `shape`'s four
 *  anchors is closest to `worldPoint` — used both to decide which anchor a connector
 *  drag/release should snap to, and (with a tolerance) whether a pointerdown actually
 *  grabbed an anchor at all. */
export function nearestAnchor(shape, worldPoint) {
  let best = null;
  for (const { anchor, point } of getAllAnchorPoints(shape)) {
    const dist = Math.hypot(worldPoint.x - point.x, worldPoint.y - point.y);
    if (!best || dist < best.dist) best = { anchor, point, dist };
  }
  return best;
}

const ANCHOR_NORMAL = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

function offsetByAnchor(point, anchor, distance) {
  const n = ANCHOR_NORMAL[anchor] ?? { x: 0, y: 0 };
  return { x: point.x + n.x * distance, y: point.y + n.y * distance };
}

/** Drops consecutive points that are effectively the same location (e.g. when padding
 *  collapses to nothing) so a route never carries a zero-length segment. */
function dedupeAdjacent(points) {
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const p = points[i];
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-6) result.push(p);
  }
  return result;
}

/**
 * A lightweight, fully deterministic orthogonal router (Phase 12 spec explicitly wants
 * this over "an enormous graph-routing engine"): step straight out from each anchor by
 * `padding` along its normal (so the line doesn't immediately hug/re-enter its own
 * source/target shape), then join the two padded points with a single bend — horizontal
 * first if the start anchor is left/right, vertical first if it's top/bottom, which is
 * what makes the route "leave" the shape in the direction that anchor naturally implies.
 * No obstacle graph, no A*; this covers the common diagram case cleanly and cheaply.
 */
function computeElbowRoute(start, startAnchor, end, endAnchor, padding) {
  const startOut = offsetByAnchor(start, startAnchor, padding);
  const endOut = offsetByAnchor(end, endAnchor, padding);
  const horizontalFirst = startAnchor === 'left' || startAnchor === 'right';
  const bend = horizontalFirst ? { x: endOut.x, y: startOut.y } : { x: startOut.x, y: endOut.y };
  return dedupeAdjacent([start, startOut, bend, endOut, end]);
}

/**
 * The one function that turns "connector between these two anchored shapes" into the
 * `points` array every existing piece of the app (hit-testing, rendering, bounds,
 * mini-map, PNG export) already knows how to consume unchanged — a connector's `points`
 * is just a polyline like any freehand stroke, computed here instead of drawn by hand.
 * @param {object} startShape @param {string} startAnchor
 * @param {object} endShape @param {string} endAnchor
 * @param {'straight'|'elbow'} routing
 * @returns {Array<{x,y}>}
 */
export function computeConnectorPoints(startShape, startAnchor, endShape, endAnchor, routing, padding = DEFAULT_ELBOW_PADDING) {
  const start = computeAnchorPoint(startShape, startAnchor);
  const end = computeAnchorPoint(endShape, endAnchor);
  if (routing === 'elbow') return computeElbowRoute(start, startAnchor, end, endAnchor, padding);
  return [start, end];
}

/** @returns {{x,y}} where a connector's label should be drawn — the middle segment's
 *  midpoint for a multi-point (elbow) route, or the simple midpoint for a straight one. */
export function connectorLabelPosition(points) {
  if (points.length <= 2) {
    const [a, b] = points;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  const i = Math.floor((points.length - 1) / 2);
  const a = points[i];
  const b = points[i + 1] ?? a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** @returns {number} degrees (canvas convention) of the FINAL segment's direction — what
 *  an end arrowhead orients along, regardless of straight vs. elbow routing. */
export function finalSegmentAngle(points) {
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  return Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
}

/** @returns {number} degrees of the FIRST segment's direction, reversed to point back
 *  toward the start — what a start arrowhead orients along. */
export function firstSegmentAngle(points) {
  const a = points[1];
  const b = points[0];
  return Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
}
