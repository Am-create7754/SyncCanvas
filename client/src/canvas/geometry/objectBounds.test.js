import { describe, it, expect } from 'vitest';
import { boundsOfObjects, visualBoundsOfObjects, visualBoundsOfObjectList } from './objectBounds.js';

describe('boundsOfObjects', () => {
  it('returns null for an empty object map', () => {
    expect(boundsOfObjects(new Map())).toBeNull();
  });

  it('spans the points of every object, including negative coordinates', () => {
    const objects = new Map([
      ['a', { points: [{ x: -50, y: 10 }, { x: 20, y: 30 }] }],
      ['b', { points: [{ x: 100, y: -80 }] }],
    ]);
    expect(boundsOfObjects(objects)).toEqual({ minX: -50, minY: -80, maxX: 100, maxY: 30 });
  });
});

describe('visualBoundsOfObjects / visualBoundsOfObjectList (Phase 11 fix pass)', () => {
  it('matches boundsOfObjects when nothing is rotated', () => {
    const objects = new Map([['a', { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }]]);
    expect(visualBoundsOfObjects(objects)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('encloses a rotated object by its true visual extent, not its local box', () => {
    // a square rotated 45deg has a diagonal-aligned bbox ~1.414x wider than its local one
    const objects = new Map([['a', { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], rotation: 45 }]]);
    const bounds = visualBoundsOfObjects(objects);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(100 * Math.SQRT2, 3);
  });

  it('visualBoundsOfObjectList unions a rotated object with an unrotated one (multi-select box)', () => {
    const rotated = { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], rotation: 45 };
    const plain = { points: [{ x: 200, y: 200 }, { x: 210, y: 210 }] };
    const bounds = visualBoundsOfObjectList([rotated, plain]);
    // the rotated square's diagonal corners extend to ~ -20.7 / 120.7 around its own center (50,50)
    expect(bounds.minX).toBeLessThan(0);
    expect(bounds.maxX).toBe(210); // still bounded by the unrotated object's far edge
  });

  it('returns null for an empty list/map', () => {
    expect(visualBoundsOfObjectList([])).toBeNull();
    expect(visualBoundsOfObjects(new Map())).toBeNull();
  });
});
