import { generateId } from '../utils/id.js';

const PASTE_OFFSET = 20; // world units — small enough to stay obviously "the same shape", large enough to see

/**
 * Clones a set of persistent objects for paste/duplicate. Every clone gets a BRAND NEW id
 * (never reuse an id — two persistent objects sharing one would corrupt Room state) and a
 * small offset so the result is visibly distinguishable from the source. `userId` is
 * stripped since the server re-attributes creations to whoever's pasting; ephemeral
 * concerns (selection, presence) never touch persistent objects in the first place, so
 * there's nothing to strip there.
 *
 * A copied group keeps its members grouped with each other, but as a NEW, independent
 * group — pasting a copy of a group must never silently rejoin it to the original.
 */
export function cloneObjectsForPaste(objects, offset = PASTE_OFFSET) {
  const idMap = new Map(objects.map((obj) => [obj.id, generateId()]));
  const groupIdMap = new Map(); // old groupId -> freshly allocated new groupId

  const clones = [];
  for (const obj of objects) {
    // A connector only makes sense alongside BOTH the shapes it connects — if either
    // endpoint wasn't part of this copy, the pasted connector would dangle (pointing at an
    // object absent from the new copy), so it's dropped rather than pasted half-broken
    // (Phase 12 spec #10). Checked before cloning since there's nothing useful to build.
    if (obj.type === 'connector' && (!idMap.has(obj.start.objectId) || !idMap.has(obj.end.objectId))) continue;

    const clone = {
      ...obj,
      id: idMap.get(obj.id),
      points: obj.points.map((p) => ({ x: p.x + offset, y: p.y + offset })),
      createdAt: Date.now(),
    };
    delete clone.userId;
    if (obj.groupId) {
      if (!groupIdMap.has(obj.groupId)) groupIdMap.set(obj.groupId, generateId());
      clone.groupId = groupIdMap.get(obj.groupId);
    } else {
      delete clone.groupId;
    }
    if (obj.type === 'connector') {
      // Both endpoints are known to be in idMap (checked above) — remap them to the
      // FRESH ids their own connected shapes just got, so the pasted connector still
      // points at the pasted copies, never the originals.
      clone.start = { ...obj.start, objectId: idMap.get(obj.start.objectId) };
      clone.end = { ...obj.end, objectId: idMap.get(obj.end.objectId) };
    }
    clones.push(clone);
  }
  return clones;
}
