import { describe, it, expect } from 'vitest';
import { cloneObjectsForPaste } from './clipboard.js';

function makeObject(overrides = {}) {
  return {
    id: 'orig1', type: 'rect', userId: 'creator-1', color: '#111827', width: 4,
    points: [{ x: 0, y: 0 }, { x: 50, y: 50 }], createdAt: 1000, ...overrides,
  };
}

describe('cloneObjectsForPaste', () => {
  it('gives every clone a brand new id, never reusing the original', () => {
    const [clone] = cloneObjectsForPaste([makeObject()]);
    expect(clone.id).not.toBe('orig1');
    expect(typeof clone.id).toBe('string');
    expect(clone.id.length).toBeGreaterThan(0);
  });

  it('offsets points by the given amount so the paste is visibly distinguishable', () => {
    const [clone] = cloneObjectsForPaste([makeObject()], 20);
    expect(clone.points).toEqual([{ x: 20, y: 20 }, { x: 70, y: 70 }]);
  });

  it('strips the original creator (userId) — the server re-attributes it to the paster', () => {
    const [clone] = cloneObjectsForPaste([makeObject()]);
    expect(clone).not.toHaveProperty('userId');
  });

  it('preserves style fields (color/width/fill*) unchanged', () => {
    const [clone] = cloneObjectsForPaste([makeObject({ fillEnabled: true, fillColor: '#F97316', fillOpacity: 0.6 })]);
    expect(clone).toMatchObject({ color: '#111827', width: 4, fillEnabled: true, fillColor: '#F97316', fillOpacity: 0.6 });
  });

  it('every clone in one call gets a distinct id', () => {
    const clones = cloneObjectsForPaste([makeObject({ id: 'a' }), makeObject({ id: 'b' })]);
    expect(clones[0].id).not.toBe(clones[1].id);
  });

  it('leaves an ungrouped object without a groupId on the clone', () => {
    const [clone] = cloneObjectsForPaste([makeObject()]);
    expect(clone).not.toHaveProperty('groupId');
  });

  it('gives a copied group a NEW shared groupId, independent of the original group', () => {
    const objects = [makeObject({ id: 'a', groupId: 'orig-group' }), makeObject({ id: 'b', groupId: 'orig-group' })];
    const clones = cloneObjectsForPaste(objects);
    expect(clones[0].groupId).toBeTruthy();
    expect(clones[0].groupId).toBe(clones[1].groupId);
    expect(clones[0].groupId).not.toBe('orig-group');
  });

  it('does not mutate the source objects', () => {
    const original = makeObject();
    const originalPointsSnapshot = JSON.stringify(original.points);
    cloneObjectsForPaste([original]);
    expect(JSON.stringify(original.points)).toBe(originalPointsSnapshot);
  });

  describe('Phase 12: connector endpoint remapping', () => {
    function makeConnector(overrides = {}) {
      return {
        id: 'conn1', type: 'connector', color: '#111827', width: 2,
        points: [{ x: 50, y: 25 }, { x: 300, y: 25 }],
        start: { objectId: 'a', anchor: 'right' }, end: { objectId: 'b', anchor: 'left' },
        routing: 'straight', arrowEnd: true, createdAt: 1000, ...overrides,
      };
    }

    it('remaps both endpoints to the FRESH ids their connected shapes get, when both are copied', () => {
      const objects = [makeObject({ id: 'a' }), makeObject({ id: 'b' }), makeConnector()];
      const clones = cloneObjectsForPaste(objects);
      const [shapeA, shapeB, connector] = clones;
      expect(connector.start.objectId).toBe(shapeA.id);
      expect(connector.end.objectId).toBe(shapeB.id);
      expect(connector.start.anchor).toBe('right');
      expect(connector.end.anchor).toBe('left');
    });

    it('drops the connector entirely if only ONE endpoint was copied — never pastes a dangling reference', () => {
      const objects = [makeObject({ id: 'a' }), makeConnector()]; // 'b' not included
      const clones = cloneObjectsForPaste(objects);
      expect(clones).toHaveLength(1);
      expect(clones[0].type).toBe('rect');
    });

    it('drops the connector if NEITHER endpoint was copied', () => {
      const clones = cloneObjectsForPaste([makeConnector()]);
      expect(clones).toHaveLength(0);
    });

    it('still offsets a kept connector\'s own points like any other object', () => {
      const objects = [makeObject({ id: 'a' }), makeObject({ id: 'b' }), makeConnector()];
      const clones = cloneObjectsForPaste(objects, 20);
      const connector = clones.find((c) => c.type === 'connector');
      expect(connector.points).toEqual([{ x: 70, y: 45 }, { x: 320, y: 45 }]);
    });
  });
});
