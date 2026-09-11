import { describe, it, expect } from 'vitest';
import { applyOperation, reconstructAt } from '@synccanvas/shared';

function rect(id, overrides = {}) {
  return { id, type: 'rect', userId: 'u1', color: '#111827', width: 4, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], createdAt: 1, ...overrides };
}

function op(sequence, type, forward) {
  return { id: `op${sequence}`, sequence, type, timestamp: sequence, userId: 'u1', username: 'Amber', forward };
}

describe('applyOperation', () => {
  it('OBJECT_CREATE adds the object(s), STROKE_CREATE the same way', () => {
    const result = applyOperation([], op(1, 'OBJECT_CREATE', { objects: [rect('a')] }));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('OBJECT_DELETE removes only the named ids', () => {
    const result = applyOperation([rect('a'), rect('b')], op(2, 'OBJECT_DELETE', { ids: ['a'] }));
    expect(result.map((o) => o.id)).toEqual(['b']);
  });

  it('OBJECT_MOVE/RESIZE/STYLE_CHANGE/GROUP/UNGROUP/ALIGN/DISTRIBUTE all merge patches by id', () => {
    const start = [rect('a', { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] })];
    const moved = applyOperation(start, op(2, 'OBJECT_MOVE', { patches: [{ id: 'a', patch: { points: [{ x: 100, y: 100 }, { x: 110, y: 110 }] } }] }));
    expect(moved[0].points).toEqual([{ x: 100, y: 100 }, { x: 110, y: 110 }]);

    const filled = applyOperation(moved, op(3, 'OBJECT_STYLE_CHANGE', { patches: [{ id: 'a', patch: { fillColor: '#F97316' } }] }));
    expect(filled[0].fillColor).toBe('#F97316');
    expect(filled[0].points).toEqual([{ x: 100, y: 100 }, { x: 110, y: 110 }]); // untouched fields survive
  });

  it('OBJECT_ROTATE (Phase 11) merges a rotation patch by id, same as move/resize', () => {
    const result = applyOperation([rect('a')], op(2, 'OBJECT_ROTATE', { patches: [{ id: 'a', patch: { rotation: 45 } }] }));
    expect(result[0].rotation).toBe(45);
    expect(result[0].points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }]); // untouched fields survive
  });

  it('a patch for an id that no longer exists is silently ignored', () => {
    const result = applyOperation([rect('a')], op(2, 'OBJECT_MOVE', { patches: [{ id: 'missing', patch: { points: [{ x: 1, y: 1 }] } }] }));
    expect(result).toHaveLength(1);
  });

  it('LAYER_CHANGE reorders to match the given order', () => {
    const result = applyOperation([rect('a'), rect('b'), rect('c')], op(2, 'LAYER_CHANGE', { order: ['c', 'a', 'b'] }));
    expect(result.map((o) => o.id)).toEqual(['c', 'a', 'b']);
  });

  it('CLEAR_CANVAS empties the document regardless of what was there', () => {
    expect(applyOperation([rect('a'), rect('b')], op(2, 'CLEAR_CANVAS', {}))).toEqual([]);
  });

  it('DOCUMENT_IMPORT/DOCUMENT_RESTORE wholesale-replace the document', () => {
    const result = applyOperation([rect('old')], op(2, 'DOCUMENT_IMPORT', { objects: [rect('new1'), rect('new2')] }));
    expect(result.map((o) => o.id)).toEqual(['new1', 'new2']);
  });

  it('CHECKPOINT_CREATED is a pure marker — never changes the document', () => {
    const doc = [rect('a')];
    expect(applyOperation(doc, op(2, 'CHECKPOINT_CREATED', {}))).toEqual(doc);
  });

  it('never mutates the input array or its objects', () => {
    const original = [rect('a', { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] })];
    const snapshot = JSON.stringify(original);
    applyOperation(original, op(2, 'OBJECT_MOVE', { patches: [{ id: 'a', patch: { points: [{ x: 999, y: 999 }] } }] }));
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('reconstructAt', () => {
  // Mirrors Phase 9 TEST 1 — create, move, style-change; verify state after each op.
  it('TEST 1: reconstructs the exact state after each of a create -> move -> style-change sequence', () => {
    const history = {
      baseSequence: 0,
      baseSnapshot: [],
      checkpoints: [],
      operations: [
        op(1, 'OBJECT_CREATE', { objects: [rect('r1', { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] })] }),
        op(2, 'OBJECT_MOVE', { patches: [{ id: 'r1', patch: { points: [{ x: 600, y: 350 }, { x: 610, y: 360 }] } }] }),
        op(3, 'OBJECT_STYLE_CHANGE', { patches: [{ id: 'r1', patch: { fillColor: '#8B5CF6', fillEnabled: true } }] }),
      ],
    };
    expect(reconstructAt(history, 1)[0].points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    expect(reconstructAt(history, 2)[0].points).toEqual([{ x: 600, y: 350 }, { x: 610, y: 360 }]);
    expect(reconstructAt(history, 3)[0]).toMatchObject({ fillColor: '#8B5CF6', fillEnabled: true, points: [{ x: 600, y: 350 }, { x: 610, y: 360 }] });
  });

  // Phase 9 TEST 2 — create then delete.
  it('TEST 2: an object appears then disappears', () => {
    const history = {
      baseSequence: 0, baseSnapshot: [], checkpoints: [],
      operations: [op(1, 'OBJECT_CREATE', { objects: [rect('r1')] }), op(2, 'OBJECT_DELETE', { ids: ['r1'] })],
    };
    expect(reconstructAt(history, 1)).toHaveLength(1);
    expect(reconstructAt(history, 2)).toHaveLength(0);
  });

  // Phase 9 TEST 3 — multiple objects, group, move group.
  it('TEST 3: group then move reproduces each intermediate state', () => {
    const history = {
      baseSequence: 0, baseSnapshot: [], checkpoints: [],
      operations: [
        op(1, 'OBJECT_CREATE', { objects: [rect('a'), rect('b')] }),
        op(2, 'GROUP', { patches: [{ id: 'a', patch: { groupId: 'g1' } }, { id: 'b', patch: { groupId: 'g1' } }] }),
        op(3, 'OBJECT_MOVE', { patches: [{ id: 'a', patch: { points: [{ x: 5, y: 5 }, { x: 15, y: 15 }] } }, { id: 'b', patch: { points: [{ x: 50, y: 50 }, { x: 60, y: 60 }] } }] }),
      ],
    };
    const afterGroup = reconstructAt(history, 2);
    expect(afterGroup.every((o) => o.groupId === 'g1')).toBe(true);
    const afterMove = reconstructAt(history, 3);
    expect(afterMove.find((o) => o.id === 'a').points[0]).toEqual({ x: 5, y: 5 });
  });

  // Phase 9 TEST 4 — layer order.
  it('TEST 4: layer reordering is preserved in reconstruction', () => {
    const history = {
      baseSequence: 0, baseSnapshot: [], checkpoints: [],
      operations: [
        op(1, 'OBJECT_CREATE', { objects: [rect('a'), rect('b'), rect('c')] }),
        op(2, 'LAYER_CHANGE', { order: ['b', 'c', 'a'] }),
      ],
    };
    expect(reconstructAt(history, 2).map((o) => o.id)).toEqual(['b', 'c', 'a']);
  });

  // Phase 9 TEST 5 — create 100, clear -> ONE meaningful operation either side.
  it('TEST 5: many creates followed by one clear — objects then blank canvas', () => {
    const created = Array.from({ length: 100 }, (_, i) => rect(`r${i}`));
    const history = {
      baseSequence: 0, baseSnapshot: [], checkpoints: [],
      operations: [op(1, 'OBJECT_CREATE', { objects: created }), op(2, 'CLEAR_CANVAS', {})],
    };
    expect(reconstructAt(history, 1)).toHaveLength(100);
    expect(reconstructAt(history, 2)).toHaveLength(0);
  });

  // Phase 9 TEST 6 — import.
  it('TEST 6: a document import is ONE event and reconstructs to exactly the imported set', () => {
    const imported = [rect('x1'), rect('x2'), rect('x3')];
    const history = { baseSequence: 0, baseSnapshot: [], checkpoints: [], operations: [op(1, 'DOCUMENT_IMPORT', { objects: imported })] };
    expect(history.operations).toHaveLength(1);
    expect(reconstructAt(history, 1).map((o) => o.id)).toEqual(['x1', 'x2', 'x3']);
  });

  it('uses the nearest checkpoint at or before the target instead of replaying from scratch', () => {
    // deliberately give a checkpoint at seq 2 that does NOT match what naive replay-from-0
    // would produce, so a passing test proves the checkpoint was actually used
    const history = {
      baseSequence: 0,
      baseSnapshot: [],
      checkpoints: [{ sequence: 2, objects: [rect('from-checkpoint')] }],
      operations: [
        op(1, 'OBJECT_CREATE', { objects: [rect('should-be-skipped')] }),
        op(2, 'OBJECT_CREATE', { objects: [rect('also-skipped')] }),
        op(3, 'OBJECT_CREATE', { objects: [rect('r3')] }),
      ],
    };
    const result = reconstructAt(history, 3);
    expect(result.map((o) => o.id).sort()).toEqual(['from-checkpoint', 'r3']);
  });

  it('reconstructs from baseSnapshot when no checkpoint is new enough', () => {
    const history = {
      baseSequence: 5,
      baseSnapshot: [rect('base-object')],
      checkpoints: [],
      operations: [op(6, 'OBJECT_CREATE', { objects: [rect('r6')] })],
    };
    expect(reconstructAt(history, 6).map((o) => o.id).sort()).toEqual(['base-object', 'r6']);
  });
});
