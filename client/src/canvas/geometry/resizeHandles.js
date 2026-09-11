import { boundsOfPoints } from './points.js';

/** Shapes Phase 8 supports resize handles for. Freehand strokes are excluded — the spec
 *  doesn't require arbitrary freehand resizing and the architecture (raw point list, no
 *  bbox semantics) doesn't make it "straightforward" the way it does for line/rect/circle.
 *  Sticky notes and frames (Phase 12) use the exact same bbox-handle model as rect —
 *  resizing either just changes its 2-corner `points`, same as any other bbox shape.
 *  Connectors are excluded: their geometry is derived from two OTHER objects, never
 *  directly draggable. A standalone text object (final polish phase) uses the same
 *  2-corner bbox model too — resizing it just changes the wrap width/clip height text
 *  re-flows inside, same "resize = re-fit content into a bigger/smaller box" idea sticky
 *  notes already established. */
export const RESIZABLE_TYPES = new Set(['rect', 'circle', 'line', 'sticky', 'frame', 'text']);

const MIN_SHAPE_SIZE = 2; // world units — keeps a bbox from collapsing to zero (divide-by-zero in circle rendering)

/**
 * @returns {Array<{id, x, y, cursor}>} handle positions in WORLD space for the given
 * object. Rect/circle get 8 bbox handles (4 corners + 4 sides); line gets its 2 endpoints.
 * Callers draw/hit-test these using a screen-constant size (world radius = N / viewport.scale)
 * so handles neither shrink to invisibility nor balloon at extreme zoom.
 */
export function getResizeHandles(object) {
  if (object.type === 'line') {
    const [a, b] = object.points;
    return [
      { id: 'start', x: a.x, y: a.y, cursor: 'pointer' },
      { id: 'end', x: b.x, y: b.y, cursor: 'pointer' },
    ];
  }
  if (!RESIZABLE_TYPES.has(object.type)) return [];

  const { minX, minY, maxX, maxY } = boundsOfPoints(object.points);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return [
    { id: 'nw', x: minX, y: minY, cursor: 'nwse-resize' },
    { id: 'n', x: midX, y: minY, cursor: 'ns-resize' },
    { id: 'ne', x: maxX, y: minY, cursor: 'nesw-resize' },
    { id: 'e', x: maxX, y: midY, cursor: 'ew-resize' },
    { id: 'se', x: maxX, y: maxY, cursor: 'nwse-resize' },
    { id: 's', x: midX, y: maxY, cursor: 'ns-resize' },
    { id: 'sw', x: minX, y: maxY, cursor: 'nesw-resize' },
    { id: 'w', x: minX, y: midY, cursor: 'ew-resize' },
  ];
}

/** @returns {{id,x,y,cursor}|null} the first handle within `tolerance` (world units) of `point`. */
export function hitTestHandles(handles, point, tolerance) {
  for (const h of handles) {
    if (Math.hypot(point.x - h.x, point.y - h.y) <= tolerance) return h;
  }
  return null;
}

/**
 * Computes new object points for a resize drag. Rect/circle are normalized to a
 * {min,max} bbox representation — matching how drawRect/drawCircle already read `points`
 * (via Math.min/max), so which corner is "a" vs "b" is never semantically meaningful.
 * Line moves the dragged endpoint directly. `handleId` is one of the ids `getResizeHandles`
 * produces; direction is read from which of n/s/e/w characters it contains.
 * @returns {Array<{x,y}>}
 */
export function resizePoints(type, startPoints, handleId, pointerWorld) {
  if (type === 'line') {
    const [a, b] = startPoints;
    if (handleId === 'start') return [{ ...pointerWorld }, { ...b }];
    if (handleId === 'end') return [{ ...a }, { ...pointerWorld }];
    return startPoints;
  }

  let { minX, minY, maxX, maxY } = boundsOfPoints(startPoints);
  if (handleId.includes('w')) minX = Math.min(pointerWorld.x, maxX - MIN_SHAPE_SIZE);
  if (handleId.includes('e')) maxX = Math.max(pointerWorld.x, minX + MIN_SHAPE_SIZE);
  if (handleId.includes('n')) minY = Math.min(pointerWorld.y, maxY - MIN_SHAPE_SIZE);
  if (handleId.includes('s')) maxY = Math.max(pointerWorld.y, minY + MIN_SHAPE_SIZE);
  return [{ x: minX, y: minY }, { x: maxX, y: maxY }];
}
