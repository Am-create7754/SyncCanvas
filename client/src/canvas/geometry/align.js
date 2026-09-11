import { visualBoundsOfObjectList } from './objectBounds.js';
import { visualBoundsOfObject } from './rotation.js';

const translate = (points, dx, dy) => points.map((p) => ({ x: p.x + dx, y: p.y + dy }));

/**
 * Computes the {id, patch:{points}} batch-update entries that align every object in
 * `objects` against the combined selection bounds — the reference frame the spec calls
 * for (Part F, #20). World-space throughout, so it's correct regardless of zoom/pan.
 * Objects already on the target line are skipped so a no-op align never produces a
 * spurious history entry. Shape matches every other batch-update producer (move, resize,
 * group) so CanvasEngine.applyBatchUpdate/commitBatchUpdate never needs a special case.
 *
 * Rotation-aware (Phase 11 polish pass): both the combined reference frame and each
 * object's own extent use its true visual (rotated) bounds — a tilted rectangle aligns by
 * where it actually appears on screen, not its unrotated local box. Only ever TRANSLATES
 * `obj.points` (see `translate` below), so an object's `rotation` field is never touched —
 * aligning never changes how something is rotated, only where it sits.
 * @param {object[]} objects
 * @param {'left'|'center-h'|'right'|'top'|'center-v'|'bottom'} mode
 * @returns {Array<{id:string, patch:{points:Array<{x,y}>}}>}
 */
export function computeAlignPatches(objects, mode) {
  if (objects.length < 2) return [];
  const overall = visualBoundsOfObjectList(objects);
  if (!overall) return [];

  const patches = [];
  for (const obj of objects) {
    const b = visualBoundsOfObject(obj);
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case 'left': dx = overall.minX - b.minX; break;
      case 'right': dx = overall.maxX - b.maxX; break;
      case 'center-h': dx = (overall.minX + overall.maxX) / 2 - (b.minX + b.maxX) / 2; break;
      case 'top': dy = overall.minY - b.minY; break;
      case 'bottom': dy = overall.maxY - b.maxY; break;
      case 'center-v': dy = (overall.minY + overall.maxY) / 2 - (b.minY + b.maxY) / 2; break;
      default: break;
    }
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) continue;
    patches.push({ id: obj.id, patch: { points: translate(obj.points, dx, dy) } });
  }
  return patches;
}

/**
 * Computes patches that space `objects` evenly along `axis`, keeping the two outermost
 * objects (by bbox center) fixed and distributing the gap between them evenly among the
 * rest — matching how design tools define "distribute spacing" (Part G, #22-23). Works
 * with mixed sizes and negative coordinates since it's pure world-space arithmetic; no
 * exception needed for either.
 * Rotation-aware (Phase 11 polish pass): sizing/spacing is computed from each object's
 * true visual (rotated) extent; only ever translates, never touches `rotation`.
 * @param {object[]} objects
 * @param {'horizontal'|'vertical'} axis
 * @returns {Array<{id:string, patch:{points:Array<{x,y}>}}>}
 */
export function computeDistributePatches(objects, axis) {
  if (objects.length < 3) return [];
  const minKey = axis === 'horizontal' ? 'minX' : 'minY';
  const maxKey = axis === 'horizontal' ? 'maxX' : 'maxY';

  const items = objects
    .map((obj) => ({ obj, b: visualBoundsOfObject(obj) }))
    .sort((a, b) => (a.b[minKey] + a.b[maxKey]) / 2 - (b.b[minKey] + b.b[maxKey]) / 2);

  const first = items[0];
  const last = items[items.length - 1];
  const span = last.b[minKey] - first.b[maxKey];
  const middleSizes = items.slice(1, -1).reduce((sum, it) => sum + (it.b[maxKey] - it.b[minKey]), 0);
  const gap = (span - middleSizes) / (items.length - 1);

  const patches = [];
  let cursor = first.b[maxKey] + gap;
  for (let i = 1; i < items.length - 1; i++) {
    const { obj, b } = items[i];
    const size = b[maxKey] - b[minKey];
    const delta = cursor - b[minKey];
    if (Math.abs(delta) > 1e-6) {
      patches.push({
        id: obj.id,
        patch: { points: axis === 'horizontal' ? translate(obj.points, delta, 0) : translate(obj.points, 0, delta) },
      });
    }
    cursor += size + gap;
  }
  return patches;
}
