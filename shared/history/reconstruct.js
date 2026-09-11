/**
 * Pure, side-effect-free document reconstruction for Phase 9 (session replay / timeline /
 * time travel). Identical logic runs on the server (authoritative RESTORE_VERSION handling)
 * and the client (smooth local scrubbing without a round-trip per tick) — one implementation,
 * imported by both, so they can never drift apart on what "operation #287" actually means.
 *
 * Deliberately mirrors the wire-broadcast payload shapes Room.js already produces for each
 * operation type (BATCH_UPDATE's {patches}, OBJECTS_CREATE's {objects}, etc.) so recording
 * an operation never requires inventing a second representation of the same change.
 */

const cloneObject = (obj) => ({ ...obj, points: obj.points.map((p) => ({ ...p })) });
const cloneObjects = (objects) => objects.map(cloneObject);

/**
 * Applies ONE recorded operation to a document (array of canvas objects), returning a NEW
 * array — the input is never mutated, so callers can safely reuse a cached prior state.
 * @param {object[]} objects
 * @param {{type:string, forward:object}} op
 * @returns {object[]}
 */
export function applyOperation(objects, op) {
  const forward = op.forward ?? {};

  switch (op.type) {
    case 'OBJECT_CREATE':
    case 'STROKE_CREATE': {
      const map = new Map(objects.map((o) => [o.id, o]));
      for (const obj of forward.objects ?? []) map.set(obj.id, cloneObject(obj));
      return [...map.values()];
    }

    case 'OBJECT_DELETE': {
      const remove = new Set(forward.ids ?? []);
      return objects.filter((o) => !remove.has(o.id));
    }

    case 'OBJECT_MOVE':
    case 'OBJECT_RESIZE':
    case 'OBJECT_ROTATE':
    case 'OBJECT_STYLE_CHANGE':
    case 'GROUP':
    case 'UNGROUP':
    case 'ALIGN':
    case 'DISTRIBUTE': {
      const map = new Map(objects.map((o) => [o.id, o]));
      for (const { id, patch } of forward.patches ?? []) {
        const existing = map.get(id);
        if (existing) map.set(id, { ...existing, ...patch });
      }
      return [...map.values()];
    }

    case 'LAYER_CHANGE': {
      const map = new Map(objects.map((o) => [o.id, o]));
      const order = forward.order ?? [];
      const reordered = order.filter((id) => map.has(id)).map((id) => map.get(id));
      // Anything not named in `order` (shouldn't normally happen) is kept, appended at the
      // end, so a malformed/partial order can never silently drop objects from view.
      const named = new Set(order);
      const rest = objects.filter((o) => !named.has(o.id));
      return [...reordered, ...rest];
    }

    case 'CLEAR_CANVAS':
      return [];

    case 'DOCUMENT_IMPORT':
    case 'DOCUMENT_RESTORE':
      return cloneObjects(forward.objects ?? []);

    case 'CHECKPOINT_CREATED':
      return objects; // a pure marker — never changes the document itself

    default:
      return objects;
  }
}

/**
 * Reconstructs the full document as of `targetSequence` (inclusive) from a room's history
 * log — starting from the nearest checkpoint at or before that sequence rather than
 * replaying from the very beginning every time (Phase 9 #9/#46).
 * @param {{operations:Array, checkpoints:Array<{sequence:number, objects:object[]}>,
 *   baseSequence:number, baseSnapshot:object[]}} history
 * @param {number} targetSequence
 * @returns {object[]}
 */
export function reconstructAt(history, targetSequence) {
  let base = { sequence: history.baseSequence ?? 0, objects: history.baseSnapshot ?? [] };
  for (const cp of history.checkpoints ?? []) {
    if (cp.sequence <= targetSequence && cp.sequence > base.sequence) base = cp;
  }

  let objects = cloneObjects(base.objects);
  for (const op of history.operations) {
    if (op.sequence <= base.sequence) continue;
    if (op.sequence > targetSequence) break;
    objects = applyOperation(objects, op);
  }
  return objects;
}
