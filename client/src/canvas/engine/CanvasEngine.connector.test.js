import { describe, it, expect, beforeEach } from 'vitest';
import { CanvasEngine } from './CanvasEngine.js';
import { computeAnchorPoint, computeConnectorPoints } from '../geometry/connector.js';

/**
 * Phase 12 regression tests for the connector-tool logic living in CanvasEngine — no real
 * <canvas> needed (mount() is never called), since every behavior under test here reads
 * and mutates `engine.objects`/`engine.dragState`/`engine.connectorDraft` directly, the
 * same "pure state, no DOM" style the rest of this project's engine-adjacent tests use.
 */

function rect(id, points, overrides = {}) {
  return { id, type: 'rect', color: '#111827', width: 4, points, createdAt: 1000, ...overrides };
}

let engine;
let rectA;
let rectB;

beforeEach(() => {
  engine = new CanvasEngine();
  rectA = rect('a', [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
  rectB = rect('b', [{ x: 300, y: 0 }, { x: 400, y: 100 }]);
  engine.objects.set(rectA.id, rectA);
  engine.objects.set(rectB.id, rectB);
});

describe('Phase 12: connector creation/preview (_finishConnectorDraft)', () => {
  it('creates a connector when released over a valid, different-shape anchor target', () => {
    engine.connectorDraft = { startObjectId: 'a', startAnchor: 'right', currentPoint: { x: 300, y: 50 } };
    engine.connectorHoverTarget = { objectId: 'b', anchor: 'left', point: computeAnchorPoint(rectB, 'left') };

    engine._finishConnectorDraft();

    const created = [...engine.objects.values()].filter((o) => o.type === 'connector');
    expect(created).toHaveLength(1);
    expect(created[0].start).toEqual({ objectId: 'a', anchor: 'right' });
    expect(created[0].end).toEqual({ objectId: 'b', anchor: 'left' });
    expect(created[0].points).toEqual(computeConnectorPoints(rectA, 'right', rectB, 'left', 'straight'));
    expect(engine.connectorDraft).toBeNull();
    expect(engine.connectorHoverTarget).toBeNull();
  });

  it('cancels (creates nothing) when released with no valid target', () => {
    engine.connectorDraft = { startObjectId: 'a', startAnchor: 'right', currentPoint: { x: 150, y: 150 } };
    engine.connectorHoverTarget = null;

    engine._finishConnectorDraft();

    expect([...engine.objects.values()].some((o) => o.type === 'connector')).toBe(false);
  });

  it('respects the current connectorRouting preference (elbow)', () => {
    engine.connectorRouting = 'elbow';
    engine.connectorDraft = { startObjectId: 'a', startAnchor: 'right', currentPoint: { x: 300, y: 50 } };
    engine.connectorHoverTarget = { objectId: 'b', anchor: 'left', point: computeAnchorPoint(rectB, 'left') };

    engine._finishConnectorDraft();

    const [connector] = [...engine.objects.values()].filter((o) => o.type === 'connector');
    expect(connector.routing).toBe('elbow');
    expect(connector.points).toEqual(computeConnectorPoints(rectA, 'right', rectB, 'left', 'elbow'));
  });

  it('Escape (_onKeyDown) cancels an in-progress draft without creating a connector', () => {
    engine.connectorDraft = { startObjectId: 'a', startAnchor: 'right', currentPoint: { x: 150, y: 150 } };
    engine.connectorHoverTarget = { objectId: 'b', anchor: 'left', point: computeAnchorPoint(rectB, 'left') };

    engine._onKeyDown({ code: 'Escape' });

    expect(engine.connectorDraft).toBeNull();
    expect(engine.connectorHoverTarget).toBeNull();
    expect([...engine.objects.values()].some((o) => o.type === 'connector')).toBe(false);
  });
});

describe('Phase 12: attached-connector recompute helpers', () => {
  let connector;

  beforeEach(() => {
    connector = {
      id: 'conn1', type: 'connector', color: '#111827', width: 2,
      points: computeConnectorPoints(rectA, 'right', rectB, 'left', 'straight'),
      start: { objectId: 'a', anchor: 'right' }, end: { objectId: 'b', anchor: 'left' },
      routing: 'straight', arrowEnd: true, createdAt: 1000,
    };
    engine.objects.set(connector.id, connector);
  });

  it('_connectorIdsAttachedTo finds a connector by either endpoint', () => {
    expect(engine._connectorIdsAttachedTo(['a'])).toEqual(['conn1']);
    expect(engine._connectorIdsAttachedTo(['b'])).toEqual(['conn1']);
    expect(engine._connectorIdsAttachedTo(['a', 'b'])).toEqual(['conn1']); // never duplicated
  });

  it('_connectorIdsAttachedTo returns nothing for an object with no attached connector', () => {
    engine.objects.set('c', rect('c', [{ x: 500, y: 500 }, { x: 600, y: 600 }]));
    expect(engine._connectorIdsAttachedTo(['c'])).toEqual([]);
  });

  it('_computeConnectorPointsFor recomputes from CURRENT endpoint geometry, not the connector\'s own stale points', () => {
    const movedRectA = { ...rectA, points: rectA.points.map((p) => ({ x: p.x + 50, y: p.y })) };
    engine.objects.set('a', movedRectA);

    const [result] = engine._computeConnectorPointsFor(['conn1']);
    expect(result.points).toEqual(computeConnectorPoints(movedRectA, 'right', rectB, 'left', 'straight'));
    expect(result.points).not.toEqual(connector.points); // actually moved, not a no-op
  });

  it('_applyConnectorPreview mutates the connector object directly (live drag preview)', () => {
    const movedRectA = { ...rectA, points: rectA.points.map((p) => ({ x: p.x + 50, y: p.y })) };
    engine.objects.set('a', movedRectA);

    engine._applyConnectorPreview(['conn1']);

    expect(engine.objects.get('conn1').points).toEqual(computeConnectorPoints(movedRectA, 'right', rectB, 'left', 'straight'));
  });

  it('_connectorPatchesFor returns commitBatchUpdate-shaped patches ({id, patch:{points}})', () => {
    const patches = engine._connectorPatchesFor(['conn1']);
    expect(patches).toEqual([{ id: 'conn1', patch: { points: connector.points } }]);
  });

  it('a dangling endpoint (deleted shape) is skipped defensively rather than throwing', () => {
    engine.objects.delete('b');
    expect(() => engine._computeConnectorPointsFor(['conn1'])).not.toThrow();
    expect(engine._computeConnectorPointsFor(['conn1'])).toEqual([]);
  });
});

describe('Phase 12: attached movement is bundled into ONE commit', () => {
  let connector;

  beforeEach(() => {
    connector = {
      id: 'conn1', type: 'connector', color: '#111827', width: 2,
      points: computeConnectorPoints(rectA, 'right', rectB, 'left', 'straight'),
      start: { objectId: 'a', anchor: 'right' }, end: { objectId: 'b', anchor: 'left' },
      routing: 'straight', createdAt: 1000,
    };
    engine.objects.set(connector.id, connector);
  });

  it('setObjectGeometry (inspector move) recomputes the attached connector in the same call', () => {
    engine.setObjectGeometry('a', { x: 50, y: 0 }); // shift rectA right by 50

    const movedA = engine.objects.get('a');
    expect(movedA.points[0]).toEqual({ x: 50, y: 0 });
    expect(engine.objects.get('conn1').points).toEqual(computeConnectorPoints(movedA, 'right', rectB, 'left', 'straight'));
  });

  it('alignSelection recomputes every connector attached to any aligned object, in one batch', () => {
    engine.selectedObjectIds = new Set(['a', 'b']);
    engine.alignSelection('top');

    const a = engine.objects.get('a');
    const b = engine.objects.get('b');
    expect(engine.objects.get('conn1').points).toEqual(computeConnectorPoints(a, 'right', b, 'left', 'straight'));
  });

  it('rotateSelectionBy recomputes an attached connector\'s route (rotation moves anchor points too)', () => {
    // Only rect/line/sticky are rotatable — rectA qualifies.
    engine.selectedObjectIds = new Set(['a']);
    engine.rotateSelectionBy(90);

    const a = engine.objects.get('a');
    expect(a.rotation).toBe(90);
    expect(engine.objects.get('conn1').points).toEqual(computeConnectorPoints(a, 'right', rectB, 'left', 'straight'));
  });
});

describe('Phase 12: cascade-delete (commitDeleteObjects)', () => {
  it('deleting a connected shape also deletes any connector attached to it, in one call', () => {
    const connector = {
      id: 'conn1', type: 'connector', color: '#111827', width: 2,
      points: computeConnectorPoints(rectA, 'right', rectB, 'left', 'straight'),
      start: { objectId: 'a', anchor: 'right' }, end: { objectId: 'b', anchor: 'left' },
      routing: 'straight', createdAt: 1000,
    };
    engine.objects.set(connector.id, connector);
    engine.selectedObjectIds = new Set(['a']);

    engine.deleteSelection();

    expect(engine.objects.has('a')).toBe(false);
    expect(engine.objects.has('conn1')).toBe(false);
    expect(engine.objects.has('b')).toBe(true); // untouched — not selected, not attached-away
  });

  it('deleting an unrelated object never touches an unrelated connector', () => {
    const connector = {
      id: 'conn1', type: 'connector', color: '#111827', width: 2,
      points: computeConnectorPoints(rectA, 'right', rectB, 'left', 'straight'),
      start: { objectId: 'a', anchor: 'right' }, end: { objectId: 'b', anchor: 'left' },
      routing: 'straight', createdAt: 1000,
    };
    engine.objects.set(connector.id, connector);
    engine.objects.set('c', rect('c', [{ x: 500, y: 500 }, { x: 600, y: 600 }]));
    engine.selectedObjectIds = new Set(['c']);

    engine.deleteSelection();

    expect(engine.objects.has('c')).toBe(false);
    expect(engine.objects.has('conn1')).toBe(true);
  });
});

describe('Phase 12: connector/sticky/frame attribute edits (BATCH_UPDATE-only fields)', () => {
  it('editSelectedConnector recomputes points when routing changes, in the same patch', () => {
    const connector = {
      id: 'conn1', type: 'connector', color: '#111827', width: 2,
      points: computeConnectorPoints(rectA, 'right', rectB, 'left', 'straight'),
      start: { objectId: 'a', anchor: 'right' }, end: { objectId: 'b', anchor: 'left' },
      routing: 'straight', createdAt: 1000,
    };
    engine.objects.set(connector.id, connector);
    engine.selectedObjectIds = new Set(['conn1']);

    engine.editSelectedConnector({ routing: 'elbow' });

    const updated = engine.objects.get('conn1');
    expect(updated.routing).toBe('elbow');
    expect(updated.points).toEqual(computeConnectorPoints(rectA, 'right', rectB, 'left', 'elbow'));
  });

  it('toggleConnectorRouting flips straight <-> elbow', () => {
    const connector = {
      id: 'conn1', type: 'connector', color: '#111827', width: 2,
      points: computeConnectorPoints(rectA, 'right', rectB, 'left', 'straight'),
      start: { objectId: 'a', anchor: 'right' }, end: { objectId: 'b', anchor: 'left' },
      routing: 'straight', createdAt: 1000,
    };
    engine.objects.set(connector.id, connector);
    engine.selectedObjectIds = new Set(['conn1']);

    engine.toggleConnectorRouting();
    expect(engine.objects.get('conn1').routing).toBe('elbow');

    engine.toggleConnectorRouting();
    expect(engine.objects.get('conn1').routing).toBe('straight');
  });

  it('editSelectedStickyText only ever applies to a selected sticky note', () => {
    const sticky = { id: 's1', type: 'sticky', color: '#111827', width: 2, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], fillEnabled: true, fillColor: '#FEF3C7', createdAt: 1000 };
    engine.objects.set(sticky.id, sticky);
    engine.selectedObjectIds = new Set(['s1']);

    engine.editSelectedStickyText('Meeting notes');
    expect(engine.objects.get('s1').text).toBe('Meeting notes');

    engine.selectedObjectIds = new Set(['a']); // a plain rect — no-op, never crashes
    expect(() => engine.editSelectedStickyText('nope')).not.toThrow();
    expect(engine.objects.get('a').text).toBeUndefined();
  });

  it('editSelectedFrameTitle only ever applies to a selected frame', () => {
    const frame = { id: 'f1', type: 'frame', color: '#111827', width: 2, points: [{ x: 0, y: 0 }, { x: 200, y: 200 }], createdAt: 1000 };
    engine.objects.set(frame.id, frame);
    engine.selectedObjectIds = new Set(['f1']);

    engine.editSelectedFrameTitle('Onboarding flow');
    expect(engine.objects.get('f1').title).toBe('Onboarding flow');
  });
});

describe('Phase 12: sticky note fill defaults (_fillFieldsForNewShape)', () => {
  it('forces fillEnabled + yellow default when no fill was chosen', () => {
    engine.tool = 'sticky';
    engine.fillEnabled = false;
    const fields = engine._fillFieldsForNewShape();
    expect(fields).toEqual({ fillEnabled: true, fillColor: '#FEF3C7', fillOpacity: 1 });
  });

  it('respects an explicitly-chosen fill color instead of overriding it', () => {
    engine.tool = 'sticky';
    engine.fillEnabled = true;
    engine.fillColor = '#BFDBFE';
    const fields = engine._fillFieldsForNewShape();
    expect(fields.fillColor).toBe('#BFDBFE');
  });
});
