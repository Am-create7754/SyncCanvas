import { boundsOfPoints } from './points.js';
import { visualBoundsOfObject } from './rotation.js';

/** @returns {{minX,minY,maxX,maxY}|null} world-space bounds spanning every object's
 *  points, or null if there are no objects — shared by fit-to-content and the mini-map
 *  so "what counts as the drawing's extent" is defined in exactly one place. */
export function boundsOfObjects(objectsMap) {
  const allPoints = [];
  for (const obj of objectsMap.values()) allPoints.push(...obj.points);
  if (allPoints.length === 0) return null;
  return boundsOfPoints(allPoints);
}

/** Same as `boundsOfObjects` but over a plain array rather than a Map — the shape a
 *  multi-selection (Select tool, Ctrl+A, marquee) is naturally kept in. Used for the
 *  combined selection bounding box and as the reference frame for align/distribute. */
export function boundsOfObjectList(objects) {
  const allPoints = [];
  for (const obj of objects) allPoints.push(...obj.points);
  if (allPoints.length === 0) return null;
  return boundsOfPoints(allPoints);
}

/** Shared reducer behind visualBoundsOfObjects/visualBoundsOfObjectList — one merge
 *  implementation for both the Map and array shapes, so there's exactly one place that
 *  unions per-object rotated bounds (never duplicated per caller). */
function mergeVisualBounds(objectsIterable) {
  let result = null;
  for (const obj of objectsIterable) {
    const b = visualBoundsOfObject(obj);
    result = result
      ? { minX: Math.min(result.minX, b.minX), minY: Math.min(result.minY, b.minY), maxX: Math.max(result.maxX, b.maxX), maxY: Math.max(result.maxY, b.maxY) }
      : b;
  }
  return result;
}

/** Same as `boundsOfObjects` but accounts for each object's rotation (Phase 11) — used
 *  wherever under-reporting a rotated object's true visual extent would be wrong (Fit to
 *  Content, mini-map content bounds). Identical to `boundsOfObjects` when nothing is
 *  rotated. */
export function visualBoundsOfObjects(objectsMap) {
  return mergeVisualBounds(objectsMap.values());
}

/** Same as `visualBoundsOfObjects` but over a plain array — the multi-selection bounding
 *  box and align/distribute's reference frame (see align.js), so a rotated object in a
 *  selection is enclosed/aligned by its true visual extent rather than its unrotated
 *  local bounds. */
export function visualBoundsOfObjectList(objects) {
  return mergeVisualBounds(objects);
}
