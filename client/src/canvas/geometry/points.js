/** @returns {number} Euclidean distance between two {x,y} points. */
export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Point-reduction filter for freehand capture: only accept a new point if it moved far
 * enough (in world units) from the last accepted point. This is the main lever for
 * network + memory efficiency on freehand strokes — raw pointermove fires far more often
 * than the eye can distinguish, so without this a single stroke can emit hundreds of
 * near-duplicate points that cost bandwidth and canvas-object memory without adding
 * visible detail. minDistance is divided by zoom so strokes stay equally smooth at any
 * zoom level (fewer world-unit points needed when zoomed out).
 */
export function shouldAcceptPoint(lastPoint, newPoint, minDistance) {
  if (!lastPoint) return true;
  return distance(lastPoint, newPoint) >= minDistance;
}

/** @returns {{minX:number,minY:number,maxX:number,maxY:number}} axis-aligned bounds of a point list. */
export function boundsOfPoints(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
