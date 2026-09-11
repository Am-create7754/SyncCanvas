import { describe, it, expect, beforeEach } from 'vitest';
import { LIMITS } from '@synccanvas/shared';
import { Room } from './Room.js';

function makeObject(id, userId, overrides = {}) {
  return { id, type: 'path', userId, color: '#000', width: 4, points: [{ x: 0, y: 0 }], createdAt: Date.now(), ...overrides };
}

describe('Room', () => {
  let room;
  beforeEach(() => { room = new Room('TEST01'); });

  it('adds an object and tracks it on the room\'s global undo stack', () => {
    room.addObject(makeObject('o1', 'u1'));
    expect(room.objects.has('o1')).toBe(true);
    expect(room.undoStack).toEqual([{ action: 'create', objectId: 'o1', userId: 'u1' }]);
  });

  it('undo removes the most recently created object regardless of who created it (GLOBAL undo)', () => {
    room.addObject(makeObject('o1', 'u1'));
    room.addObject(makeObject('o2', 'u2'));
    room.addObject(makeObject('o3', 'u1'));

    const result = room.undo('u1');

    expect(result).toEqual({ type: 'delete', objectId: 'o3' });
    expect(room.objects.has('o3')).toBe(false);
    expect(room.objects.has('o2')).toBe(true);
  });

  it('redo restores the most recently undone object', () => {
    room.addObject(makeObject('o1', 'u1'));
    room.undo('u1');
    const result = room.redo('u1');
    expect(result.type).toBe('restore');
    expect(result.object.id).toBe('o1');
    expect(room.objects.has('o1')).toBe(true);
  });

  it('a new draw action clears the room\'s global redo stack', () => {
    room.addObject(makeObject('o1', 'u1'));
    room.undo('u1');
    room.addObject(makeObject('o2', 'u1'));
    expect(room.redo('u1')).toBeNull();
  });

  describe('GLOBAL (room-wide) undo/redo — critical assignment scenario', () => {
    // Amber draws A, Arpan draws B, Amber draws C. Undo by EITHER user must remove the
    // latest GLOBAL operation (C) for everyone; the next undo removes B; redo brings them
    // back in reverse. This is the exact scenario the assignment requires and is what
    // distinguishes this from a per-user undo stack (which would have let Arpan's undo
    // only ever touch Arpan's own objects).
    it('undo by a DIFFERENT user than the author still undoes the latest global operation', () => {
      room.addObject(makeObject('A', 'amber'));
      room.addObject(makeObject('B', 'arpan'));
      room.addObject(makeObject('C', 'amber'));

      // Arpan (who did not create C) clicks undo — C still disappears for everyone.
      const first = room.undo('arpan');
      expect(first).toEqual({ type: 'delete', objectId: 'C' });
      expect(room.objects.has('C')).toBe(false);
      expect(room.objects.has('B')).toBe(true);
      expect(room.objects.has('A')).toBe(true);

      // Amber (the original author of C, but NOT of B) undoes next — B disappears next,
      // proving the stack is one shared global order, not "my objects only".
      const second = room.undo('amber');
      expect(second).toEqual({ type: 'delete', objectId: 'B' });
      expect(room.objects.has('B')).toBe(false);
      expect(room.objects.has('A')).toBe(true);

      // Redo (by either user) brings B back, then C back, in reverse order.
      const redo1 = room.redo('arpan');
      expect(redo1.object.id).toBe('B');
      expect(room.objects.has('B')).toBe(true);

      const redo2 = room.redo('amber');
      expect(redo2.object.id).toBe('C');
      expect(room.objects.has('C')).toBe(true);
    });

    it('a new action by ANY user clears the shared redo stack for EVERY user', () => {
      room.addObject(makeObject('A', 'amber'));
      room.undo('amber'); // redo stack now holds A
      room.addObject(makeObject('B', 'arpan')); // a DIFFERENT user acts
      expect(room.redo('amber')).toBeNull(); // Amber's own redo is gone too — one shared stack
    });

    it('undo/redo survive a user disconnecting — the room\'s history is not per-user', () => {
      room.addUser({ id: 'amber', username: 'Amber', color: '#000', socketId: 's1' });
      room.addObject(makeObject('A', 'amber'));
      room.removeUser('amber'); // Amber disconnects
      // Arpan (still in the room) can still undo Amber's action.
      const result = room.undo('arpan');
      expect(result).toEqual({ type: 'delete', objectId: 'A' });
    });

    it('caps the global undo stack at LIMITS.MAX_UNDO_STACK, dropping the oldest entries', () => {
      const original = LIMITS.MAX_UNDO_STACK;
      LIMITS.MAX_UNDO_STACK = 3;
      try {
        room.addObject(makeObject('o1', 'u1'));
        room.addObject(makeObject('o2', 'u1'));
        room.addObject(makeObject('o3', 'u1'));
        room.addObject(makeObject('o4', 'u1'));
        expect(room.undoStack).toHaveLength(3);
        expect(room.undoStack.map((e) => e.objectId)).toEqual(['o2', 'o3', 'o4']);
      } finally {
        LIMITS.MAX_UNDO_STACK = original;
      }
    });
  });

  it('undo skips over objects removed by other means (e.g. clear-canvas) without throwing', () => {
    room.addObject(makeObject('o1', 'u1'));
    room.addObject(makeObject('o2', 'u1'));
    room.objects.delete('o2'); // simulate external removal (clear-canvas)

    const result = room.undo('u1');
    expect(result).toEqual({ type: 'delete', objectId: 'o1' });
  });

  it('undo for a user with no objects returns null', () => {
    expect(room.undo('nobody')).toBeNull();
  });

  it('deleting a user\'s object A then having another user delete/modify never throws and state stays consistent', () => {
    room.addObject(makeObject('o1', 'u1'));
    room.deleteObject('o1'); // e.g. user B force-deleted it via some future feature
    room.appendPoints('o1', [{ x: 1, y: 1 }]); // late update arrives for a gone object
    expect(room.objects.has('o1')).toBe(false);
  });

  it('clear() wipes objects and both undo/redo stacks', () => {
    room.addObject(makeObject('o1', 'u1'));
    room.clear();
    expect(room.objects.size).toBe(0);
    expect(room.undoStack).toHaveLength(0);
  });

  it('appendPoints ignores unknown object ids instead of throwing', () => {
    expect(room.appendPoints('missing', [{ x: 1, y: 1 }])).toBeNull();
  });

  describe('updateObject (style edits)', () => {
    it('applies a style patch and returns the mutated object', () => {
      room.addObject(makeObject('o1', 'u1', { fillEnabled: false }));
      const result = room.updateObject('u1', 'o1', { fillEnabled: true, fillColor: '#F97316', fillOpacity: 0.6 });
      expect(result.ok).toBe(true);
      expect(result.object).toMatchObject({ fillEnabled: true, fillColor: '#F97316', fillOpacity: 0.6 });
      expect(room.objects.get('o1')).toMatchObject({ fillEnabled: true, fillColor: '#F97316' });
    });

    it('returns a not-found result for an unknown object id', () => {
      expect(room.updateObject('u1', 'missing', { color: '#fff' })).toEqual({ ok: false, reason: 'not-found' });
    });

    it('undo reverts a style edit to its previous values, redo re-applies it', () => {
      room.addObject(makeObject('o1', 'u1', { fillColor: '#F97316' }));
      room.updateObject('u1', 'o1', { fillColor: '#8B5CF6' });
      expect(room.objects.get('o1').fillColor).toBe('#8B5CF6');

      const undoResult = room.undo('u1');
      expect(undoResult).toMatchObject({ type: 'update', objectId: 'o1', patch: { fillColor: '#F97316' } });
      expect(room.objects.get('o1').fillColor).toBe('#F97316');

      const redoResult = room.redo('u1');
      expect(redoResult).toMatchObject({ type: 'update', objectId: 'o1', patch: { fillColor: '#8B5CF6' } });
      expect(room.objects.get('o1').fillColor).toBe('#8B5CF6');
    });

    it('a style edit clears the redo stack, like creating a new object does', () => {
      room.addObject(makeObject('o1', 'u1', { fillColor: '#F97316' }));
      room.updateObject('u1', 'o1', { fillColor: '#8B5CF6' });
      room.undo('u1'); // back to orange, redo now holds the purple edit
      room.updateObject('u1', 'o1', { fillColor: '#22C55E' }); // a fresh edit should invalidate that redo
      expect(room.redo('u1')).toBeNull();
    });

    it('undo skips a style edit whose object was deleted since', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.updateObject('u1', 'o1', { color: '#111' });
      room.objects.delete('o1'); // e.g. cleared
      expect(room.undo('u1')).toBeNull();
    });
  });

  describe('batchUpdate (Phase 8: move/resize/align/distribute/group/ungroup)', () => {
    it('applies a patch to each object as ONE undo entry', () => {
      room.addObject(makeObject('o1', 'u1', { points: [{ x: 0, y: 0 }] }));
      room.addObject(makeObject('o2', 'u1', { points: [{ x: 0, y: 0 }] }));
      const { applied, rejected } = room.batchUpdate('u1', [
        { id: 'o1', patch: { points: [{ x: 10, y: 10 }] } },
        { id: 'o2', patch: { points: [{ x: 20, y: 20 }] } },
      ]);
      expect(applied).toHaveLength(2);
      expect(rejected).toEqual([]);
      expect(room.objects.get('o1').points).toEqual([{ x: 10, y: 10 }]);
      expect(room.objects.get('o2').points).toEqual([{ x: 20, y: 20 }]);
      expect(room.undoStack).toHaveLength(3); // 2 creates + 1 batch-update
    });

    it('silently skips ids that no longer exist instead of throwing', () => {
      room.addObject(makeObject('o1', 'u1'));
      const { applied } = room.batchUpdate('u1', [
        { id: 'o1', patch: { color: '#fff' } },
        { id: 'missing', patch: { color: '#fff' } },
      ]);
      expect(applied).toEqual([{ id: 'o1', patch: { color: '#fff' } }]);
    });

    it('one undo reverts every object in the batch; one redo re-applies all of them', () => {
      room.addObject(makeObject('o1', 'u1', { points: [{ x: 0, y: 0 }] }));
      room.addObject(makeObject('o2', 'u1', { points: [{ x: 5, y: 5 }] }));
      room.batchUpdate('u1', [
        { id: 'o1', patch: { points: [{ x: 100, y: 100 }] } },
        { id: 'o2', patch: { points: [{ x: 200, y: 200 }] } },
      ]);

      const undoResult = room.undo('u1');
      expect(undoResult.type).toBe('batch-update');
      expect(undoResult.patches).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'o1', patch: expect.objectContaining({ points: [{ x: 0, y: 0 }] }) }),
        expect.objectContaining({ id: 'o2', patch: expect.objectContaining({ points: [{ x: 5, y: 5 }] }) }),
      ]));
      expect(room.objects.get('o1').points).toEqual([{ x: 0, y: 0 }]);
      expect(room.objects.get('o2').points).toEqual([{ x: 5, y: 5 }]);

      const redoResult = room.redo('u1');
      expect(redoResult.type).toBe('batch-update');
      expect(room.objects.get('o1').points).toEqual([{ x: 100, y: 100 }]);
      expect(room.objects.get('o2').points).toEqual([{ x: 200, y: 200 }]);
    });
  });

  describe('createObjects (Phase 8: paste/duplicate)', () => {
    it('adds every object and records ONE undo entry for the whole batch', () => {
      const added = room.createObjects('u1', [makeObject('o1', 'u1'), makeObject('o2', 'u1')]);
      expect(added).toHaveLength(2);
      expect(room.objects.size).toBe(2);
      expect(room.undoStack).toHaveLength(1);
    });

    it('refuses the whole batch (atomically) if it would exceed the room capacity', () => {
      const original = LIMITS.MAX_OBJECTS_PER_ROOM;
      LIMITS.MAX_OBJECTS_PER_ROOM = 1;
      try {
        const added = room.createObjects('u1', [makeObject('o1', 'u1'), makeObject('o2', 'u1')]);
        expect(added).toBeNull();
        expect(room.objects.size).toBe(0);
      } finally {
        LIMITS.MAX_OBJECTS_PER_ROOM = original;
      }
    });

    it('one undo removes the whole batch; one redo restores it', () => {
      room.createObjects('u1', [makeObject('o1', 'u1'), makeObject('o2', 'u1')]);
      const undoResult = room.undo('u1');
      expect(undoResult).toEqual({ type: 'delete-many', objectIds: expect.arrayContaining(['o1', 'o2']) });
      expect(room.objects.size).toBe(0);

      const redoResult = room.redo('u1');
      expect(redoResult.type).toBe('restore-many');
      expect(room.objects.size).toBe(2);
    });
  });

  describe('deleteObjects (Phase 8: multi-select delete)', () => {
    it('deletes every existing id and records ONE undo entry', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.addObject(makeObject('o2', 'u1'));
      room.addObject(makeObject('o3', 'u1'));
      const { removedIds, deniedByLock } = room.deleteObjects('u1', ['o1', 'o3', 'missing']);
      expect(removedIds).toEqual(expect.arrayContaining(['o1', 'o3']));
      expect(deniedByLock).toEqual([]);
      expect(room.objects.has('o1')).toBe(false);
      expect(room.objects.has('o2')).toBe(true);
      expect(room.objects.has('o3')).toBe(false);
    });

    it('one undo restores every deleted object; one redo deletes them again', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.addObject(makeObject('o2', 'u1'));
      room.deleteObjects('u1', ['o1', 'o2']);
      expect(room.objects.size).toBe(0);

      const undoResult = room.undo('u1');
      expect(undoResult.type).toBe('restore-many');
      expect(room.objects.size).toBe(2);

      const redoResult = room.redo('u1');
      expect(redoResult.type).toBe('delete-many');
      expect(room.objects.size).toBe(0);
    });
  });

  describe('reorderObjects (Phase 8: layer order)', () => {
    it('brings the given ids to the front, preserving their relative order', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.addObject(makeObject('o2', 'u1'));
      room.addObject(makeObject('o3', 'u1'));
      const result = room.reorderObjects('u1', ['o1'], 'front');
      expect(result.after).toEqual(['o2', 'o3', 'o1']);
      expect([...room.objects.keys()]).toEqual(['o2', 'o3', 'o1']);
    });

    it('sends the given ids to the back', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.addObject(makeObject('o2', 'u1'));
      room.addObject(makeObject('o3', 'u1'));
      const result = room.reorderObjects('u1', ['o3'], 'back');
      expect(result.after).toEqual(['o3', 'o1', 'o2']);
    });

    it('moves one step forward/backward without disturbing unrelated objects', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.addObject(makeObject('o2', 'u1'));
      room.addObject(makeObject('o3', 'u1'));
      expect(room.reorderObjects('u1', ['o1'], 'forward').after).toEqual(['o2', 'o1', 'o3']);
    });

    it('derives the new order from its OWN authoritative state, ignoring anything the client might imply', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.addObject(makeObject('o2', 'u1'));
      const result = room.reorderObjects('u1', ['o1', 'nonexistent'], 'front');
      expect(result.after).toEqual(['o2', 'o1']);
    });

    it('returns null for a no-op reorder (already at the requested extreme)', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.addObject(makeObject('o2', 'u1'));
      expect(room.reorderObjects('u1', ['o2'], 'front')).toBeNull();
    });

    it('one undo restores the previous order; one redo re-applies the new order', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.addObject(makeObject('o2', 'u1'));
      room.addObject(makeObject('o3', 'u1'));
      room.reorderObjects('u1', ['o1'], 'front');
      expect([...room.objects.keys()]).toEqual(['o2', 'o3', 'o1']);

      const undoResult = room.undo('u1');
      expect(undoResult).toEqual({ type: 'reorder', order: ['o1', 'o2', 'o3'] });
      expect([...room.objects.keys()]).toEqual(['o1', 'o2', 'o3']);

      const redoResult = room.redo('u1');
      expect(redoResult).toEqual({ type: 'reorder', order: ['o2', 'o3', 'o1'] });
      expect([...room.objects.keys()]).toEqual(['o2', 'o3', 'o1']);
    });
  });

  describe('loadDocument (import/snapshot-restore/crash-recovery)', () => {
    it('wholesale-replaces objects and wipes undo/redo history', () => {
      room.addObject(makeObject('old1', 'u1'));
      room.loadDocument([makeObject('new1', 'u2'), makeObject('new2', 'u2')]);

      expect(room.objects.has('old1')).toBe(false);
      expect(room.objects.has('new1')).toBe(true);
      expect(room.objects.has('new2')).toBe(true);
      expect(room.objects.size).toBe(2);
      expect(room.undo('u1')).toBeNull(); // old history for the previous document is gone
    });

    it('loading an empty document clears the room', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.loadDocument([]);
      expect(room.objects.size).toBe(0);
    });
  });

  describe('Phase 9: persistent operation history', () => {
    it('does NOT record a history entry for addObject alone (draw-start only carries one point)', () => {
      room.addObject(makeObject('o1', 'u1'));
      expect(room.history.operations).toHaveLength(0);
    });

    it('recordStrokeComplete records exactly one OBJECT_CREATE (or STROKE_CREATE) once draw-end arrives', () => {
      room.addObject(makeObject('o1', 'u1', { type: 'path' }));
      room.recordStrokeComplete('u1', 'o1');
      expect(room.history.operations).toHaveLength(1);
      expect(room.history.operations[0]).toMatchObject({ type: 'STROKE_CREATE', userId: 'u1' });
      expect(room.history.operations[0].forward.objects[0].id).toBe('o1');
    });

    it('labels a shape (non-freehand) completion as OBJECT_CREATE', () => {
      room.addObject(makeObject('o1', 'u1', { type: 'rect' }));
      room.recordStrokeComplete('u1', 'o1');
      expect(room.history.operations[0].type).toBe('OBJECT_CREATE');
    });

    it('is a no-op if the object is already gone by the time draw-end arrives', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.deleteObject('o1');
      expect(() => room.recordStrokeComplete('u1', 'o1')).not.toThrow();
      expect(room.history.operations).toHaveLength(0);
    });

    it('updateObject records ONE OBJECT_STYLE_CHANGE entry', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.updateObject('u1', 'o1', { color: '#fff' });
      expect(room.history.operations).toHaveLength(1);
      expect(room.history.operations[0].type).toBe('OBJECT_STYLE_CHANGE');
    });

    it('batchUpdate labels the operation using the given opType', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.batchUpdate('u1', [{ id: 'o1', patch: { points: [{ x: 1, y: 1 }] } }], 'OBJECT_RESIZE');
      expect(room.history.operations[0].type).toBe('OBJECT_RESIZE');
    });

    it('batchUpdate falls back to inferring a label when opType is omitted', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.batchUpdate('u1', [{ id: 'o1', patch: { groupId: null } }]);
      expect(room.history.operations[0].type).toBe('UNGROUP');
    });

    it('createObjects/deleteObjects/reorderObjects each record one meaningful entry', () => {
      room.createObjects('u1', [makeObject('o1', 'u1'), makeObject('o2', 'u1')]);
      room.deleteObjects('u1', ['o1']);
      room.addObject(makeObject('o3', 'u1'));
      room.reorderObjects('u1', ['o2'], 'front'); // o2 is currently behind o3 -> a real reorder
      const types = room.history.operations.map((op) => op.type);
      expect(types).toEqual(['OBJECT_CREATE', 'OBJECT_DELETE', 'LAYER_CHANGE']);
    });

    it('clear() records ONE CLEAR_CANVAS entry no matter how many objects existed', () => {
      for (let i = 0; i < 50; i++) room.addObject(makeObject(`o${i}`, 'u1'));
      room.clear('u1');
      const clearOps = room.history.operations.filter((op) => op.type === 'CLEAR_CANVAS');
      expect(clearOps).toHaveLength(1);
      expect(clearOps[0].summary.count).toBe(50);
    });

    it('loadDocument records DOCUMENT_IMPORT by default, or DOCUMENT_RESTORE when told to', () => {
      room.loadDocument([makeObject('o1', 'u1')], 'u1');
      expect(room.history.operations.at(-1).type).toBe('DOCUMENT_IMPORT');
      room.loadDocument([makeObject('o2', 'u1')], 'u1', 'DOCUMENT_RESTORE');
      expect(room.history.operations.at(-1).type).toBe('DOCUMENT_RESTORE');
    });

    it('the history log survives loadDocument even though undo/redo stacks are wiped', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.loadDocument([makeObject('o2', 'u1')], 'u1');
      expect(room.undoStack).toHaveLength(0);
      expect(room.history.operations.length).toBeGreaterThan(0);
    });

    it('undo of a create records a matching OBJECT_DELETE entry (an inverse persistent operation)', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.recordStrokeComplete('u1', 'o1');
      room.undo('u1');
      expect(room.history.operations.at(-1).type).toBe('OBJECT_DELETE');
    });

    it('undo of a batch-update records the SAME opType as the original action, reversed', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.batchUpdate('u1', [{ id: 'o1', patch: { points: [{ x: 1, y: 1 }] } }], 'OBJECT_MOVE');
      room.undo('u1');
      expect(room.history.operations.at(-1).type).toBe('OBJECT_MOVE');
    });

    it('redo of an undone create records another OBJECT_CREATE entry', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.recordStrokeComplete('u1', 'o1');
      room.undo('u1');
      room.redo('u1');
      expect(room.history.operations.at(-1).type).toBe('OBJECT_CREATE');
    });

    describe('createCheckpoint / restoreToCheckpoint / restoreToSequence', () => {
      it('creates a named, shared checkpoint and records a CHECKPOINT_CREATED marker', () => {
        room.addObject(makeObject('o1', 'u1'));
        const checkpoint = room.createCheckpoint('u1', 'Initial layout');
        expect(checkpoint.name).toBe('Initial layout');
        expect(room.history.operations.at(-1).type).toBe('CHECKPOINT_CREATED');
      });

      it('restoreToSequence reconstructs and applies a historical state as a NEW DOCUMENT_RESTORE entry', () => {
        room.addObject(makeObject('a', 'u1'));
        room.recordStrokeComplete('u1', 'a');
        const seqAfterA = room.history.latestSequence();
        room.addObject(makeObject('b', 'u1'));
        room.recordStrokeComplete('u1', 'b');
        expect(room.objects.size).toBe(2);

        const { objects: restored } = room.restoreToSequence('u1', seqAfterA);
        expect(restored.map((o) => o.id)).toEqual(['a']);
        expect(room.objects.size).toBe(1);
        expect(room.history.operations.at(-1).type).toBe('DOCUMENT_RESTORE');
        // history is NOT truncated — every prior operation is still there (Phase 9 #35).
        // makeObject defaults to type 'path', so its completion is a STROKE_CREATE.
        expect(room.history.operations.some((op) => op.type === 'STROKE_CREATE' && op.forward.objects[0].id === 'b')).toBe(true);
      });

      it('restoreToSequence rejects an out-of-range sequence instead of corrupting state', () => {
        room.addObject(makeObject('a', 'u1'));
        room.recordStrokeComplete('u1', 'a');
        expect(room.restoreToSequence('u1', 999)).toBeNull();
        expect(room.objects.size).toBe(1);
      });

      it('restoreToCheckpoint restores exactly the checkpointed document', () => {
        room.addObject(makeObject('a', 'u1'));
        const checkpoint = room.createCheckpoint('u1', 'Before redesign');
        room.addObject(makeObject('b', 'u1'));
        expect(room.objects.size).toBe(2);

        const { objects: restored } = room.restoreToCheckpoint('u1', checkpoint.id);
        expect(restored.map((o) => o.id)).toEqual(['a']);
        expect(room.objects.size).toBe(1);
      });

      it('restoreToCheckpoint returns null for an unknown checkpoint id', () => {
        expect(room.restoreToCheckpoint('u1', 'does-not-exist')).toBeNull();
      });
    });

    describe('importHistory', () => {
      it('replaces the room log with freshly re-sequenced imported operations', () => {
        room.addObject(makeObject('o1', 'u1'));
        room.recordStrokeComplete('u1', 'o1');
        room.importHistory('u2', {
          operations: [{ type: 'OBJECT_CREATE', userId: 'ghost', username: 'Ghost', timestamp: 1, forward: { objects: [makeObject('imported', 'u2')] } }],
        });
        expect(room.history.operations).toHaveLength(1);
        expect(room.history.operations[0].sequence).toBe(1);
      });
    });
  });

  describe('Phase 10: object revisions + soft locking', () => {
    it('a brand-new object always starts at revision 0', () => {
      room.addObject(makeObject('o1', 'u1'));
      expect(room.objects.get('o1').revision).toBe(0);
    });

    it('updateObject bumps the revision by exactly 1 per successful edit', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.updateObject('u1', 'o1', { color: '#fff' });
      expect(room.objects.get('o1').revision).toBe(1);
      room.updateObject('u1', 'o1', { color: '#000' });
      expect(room.objects.get('o1').revision).toBe(2);
    });

    it('updateObject rejects a stale baseRevision instead of applying it, and returns the authoritative object', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.updateObject('u1', 'o1', { color: '#fff' }); // now at revision 1
      const result = room.updateObject('u1', 'o1', { color: '#f00' }, 0); // client still thinks it's 0
      expect(result).toEqual({ ok: false, reason: 'stale-revision', authoritative: room.objects.get('o1') });
      expect(room.objects.get('o1').color).toBe('#fff'); // rejected update never applied
    });

    it('updateObject accepts a matching baseRevision', () => {
      room.addObject(makeObject('o1', 'u1'));
      const result = room.updateObject('u1', 'o1', { color: '#fff' }, 0);
      expect(result.ok).toBe(true);
      expect(room.objects.get('o1').revision).toBe(1);
    });

    it('updateObject rejects an edit to an object locked by another user, without touching it', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.acquireLocks('u2', 'Bob', 's2', ['o1']);
      const result = room.updateObject('u1', 'o1', { color: '#fff' });
      expect(result).toEqual({ ok: false, reason: 'lock-denied', authoritative: room.objects.get('o1') });
      expect(room.objects.get('o1').color).not.toBe('#fff');
    });

    it('updateObject allows the lock owner to edit their own locked object', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.acquireLocks('u1', 'Amber', 's1', ['o1']);
      expect(room.updateObject('u1', 'o1', { color: '#fff' }).ok).toBe(true);
    });

    it('batchUpdate partially applies — one contested object is rejected, the rest still succeed', () => {
      room.addObject(makeObject('o1', 'u1', { points: [{ x: 0, y: 0 }] }));
      room.addObject(makeObject('o2', 'u1', { points: [{ x: 0, y: 0 }] }));
      room.acquireLocks('u2', 'Bob', 's2', ['o2']);
      const { applied, rejected } = room.batchUpdate('u1', [
        { id: 'o1', patch: { points: [{ x: 1, y: 1 }] } },
        { id: 'o2', patch: { points: [{ x: 2, y: 2 }] } },
      ]);
      expect(applied).toEqual([{ id: 'o1', patch: { points: [{ x: 1, y: 1 }] } }]);
      expect(rejected).toEqual([{ id: 'o2', reason: 'lock-denied', authoritative: room.objects.get('o2') }]);
      expect(room.objects.get('o1').points).toEqual([{ x: 1, y: 1 }]);
      expect(room.objects.get('o2').points).toEqual([{ x: 0, y: 0 }]); // untouched
    });

    it('deleteObjects denies deletion of an object locked by another user and reports it', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.addObject(makeObject('o2', 'u1'));
      room.acquireLocks('u2', 'Bob', 's2', ['o1']);
      const { removedIds, deniedByLock } = room.deleteObjects('u1', ['o1', 'o2']);
      expect(removedIds).toEqual(['o2']);
      expect(deniedByLock).toEqual([{ id: 'o1', lockedBy: room.locks.get('o1') }]);
      expect(room.objects.has('o1')).toBe(true); // never deleted out from under the editor
    });

    it('clear() releases every lock along with wiping the document', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.acquireLocks('u1', 'Amber', 's1', ['o1']);
      const { releasedLockIds } = room.clear('u1');
      expect(releasedLockIds).toEqual(['o1']);
      expect(room.locks.count()).toBe(0);
    });

    it('loadDocument never trusts an incoming revision — every object resets to 0', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.updateObject('u1', 'o1', { color: '#fff' }); // o1 now at revision 1
      room.loadDocument([makeObject('o1', 'u1', { revision: 99 })], 'u2', 'DOCUMENT_IMPORT');
      expect(room.objects.get('o1').revision).toBe(0);
    });

    it('loadDocument releases locks referencing objects the new document no longer has', () => {
      room.addObject(makeObject('o1', 'u1'));
      room.acquireLocks('u1', 'Amber', 's1', ['o1']);
      const releasedLockIds = room.loadDocument([makeObject('o2', 'u2')], 'u2', 'DOCUMENT_IMPORT');
      expect(releasedLockIds).toEqual(['o1']);
      expect(room.locks.count()).toBe(0);
    });

    it('undo skips (rather than reverts) an object currently locked by another user', () => {
      room.addObject(makeObject('o1', 'u1', { color: '#000' }));
      room.updateObject('u1', 'o1', { color: '#fff' });
      room.acquireLocks('u2', 'Bob', 's2', ['o1']);
      expect(room.undo('u1')).toBeNull(); // nothing else left to undo — the update was skipped, and the create is also locked
      expect(room.objects.get('o1').color).toBe('#fff'); // never reverted out from under Bob
    });

    it('undo of a style edit bumps the revision and embeds it in the returned patch', () => {
      room.addObject(makeObject('o1', 'u1', { color: '#000' }));
      room.updateObject('u1', 'o1', { color: '#fff' }); // revision 1
      const result = room.undo('u1');
      expect(result.patch.revision).toBe(2);
      expect(room.objects.get('o1').revision).toBe(2);
    });

    describe('acquireLocks / releaseLocks / heartbeatLocks', () => {
      it('acquireLocks drops ids that do not exist in this room before checking atomicity', () => {
        room.addObject(makeObject('o1', 'u1'));
        const result = room.acquireLocks('u1', 'Amber', 's1', ['o1', 'does-not-exist']);
        expect(result).toEqual({ ok: true, objectIds: ['o1'] });
      });

      it('acquireLocks returns no-such-objects when every id is missing', () => {
        expect(room.acquireLocks('u1', 'Amber', 's1', ['missing'])).toEqual({ ok: false, reason: 'no-such-objects' });
      });

      it('releaseLocks / heartbeatLocks delegate straight to the registry', () => {
        room.addObject(makeObject('o1', 'u1'));
        room.acquireLocks('u1', 'Amber', 's1', ['o1']);
        expect(room.heartbeatLocks('u1', ['o1'])).toEqual(['o1']);
        expect(room.releaseLocks('u1', ['o1'])).toEqual(['o1']);
        expect(room.locks.get('o1')).toBeNull();
      });
    });

    describe('requestControl / respondToControl', () => {
      it('requestControl fails against an object that does not exist in this room', () => {
        expect(room.requestControl('missing', { userId: 'u2', userName: 'Bob', socketId: 's2' })).toEqual({ ok: false, reason: 'no-such-object' });
      });

      it('the full takeover flow: request -> holder releases -> requester can now acquire it', () => {
        room.addObject(makeObject('o1', 'u1'));
        room.acquireLocks('u1', 'Amber', 's1', ['o1']);
        const req = room.requestControl('o1', { userId: 'u2', userName: 'Bob', socketId: 's2' });
        expect(req.ok).toBe(true);
        const response = room.respondToControl('o1', 'u1', 'release');
        expect(response).toMatchObject({ ok: true, action: 'release' });
        // The lock is gone — the caller (handlers.js) is responsible for re-granting it to
        // the requester; Room itself doesn't auto-grant so the caller can also broadcast.
        expect(room.locks.get('o1')).toBeNull();
        expect(room.acquireLocks('u2', 'Bob', 's2', ['o1'])).toEqual({ ok: true, objectIds: ['o1'] });
      });
    });

    it('disconnect-style cleanup (removeUser) releases every lock the user held — no ghost locks', () => {
      room.addUser({ id: 'u1', username: 'Amber', color: '#000', socketId: 's1' });
      room.addObject(makeObject('o1', 'u1'));
      room.acquireLocks('u1', 'Amber', 's1', ['o1']);
      room.removeUser('u1');
      expect(room.locks.count()).toBe(0);
    });
  });

  describe('resolveJoinMode (fix pass: disconnect-grace/reconnect race regression)', () => {
    it('picks update when a live user record exists for that id', () => {
      room.addUser({ id: 'u1', username: 'Amber', color: '#000', socketId: 's1' });
      const result = room.resolveJoinMode('u1', true);
      expect(result.mode).toBe('update');
      expect(result.user.id).toBe('u1');
    });

    it('picks create for a brand-new id with no pending removal', () => {
      const result = room.resolveJoinMode('u1', true);
      expect(result).toEqual({ mode: 'create', wasReconnecting: false });
    });

    it('picks create+wasReconnecting for a stale grace-timer that outlived its user record — the exact race that used to crash join-room', () => {
      // Simulate the race directly: a pendingRemovals entry exists for 'u1', but (unlike
      // the normal lifecycle) there is no corresponding room.users entry — e.g. two
      // connections briefly shared this userId and the OTHER one's disconnect handler
      // already scheduled this timer and then had its own user record removed elsewhere.
      room.pendingRemovals.set('u1', setTimeout(() => {}, 999999));
      expect(room.users.has('u1')).toBe(false);

      const result = room.resolveJoinMode('u1', true);
      expect(result).toEqual({ mode: 'create', wasReconnecting: true });

      clearTimeout(room.pendingRemovals.get('u1'));
    });

    it('never crashes or dereferences anything when there is truly no known id (anonymous join)', () => {
      expect(() => room.resolveJoinMode(undefined, false)).not.toThrow();
      expect(room.resolveJoinMode(undefined, false)).toEqual({ mode: 'create', wasReconnecting: false });
    });
  });
});
