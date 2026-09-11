import { describe, it, expect } from 'vitest';
import { SpatialHash } from './spatialHash.js';

describe('SpatialHash', () => {
  it('finds an object whose bounds overlap the query area', () => {
    const hash = new SpatialHash(100);
    hash.insert('a', { minX: 10, minY: 10, maxX: 50, maxY: 50 });
    const result = hash.queryBounds({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
    expect(result.has('a')).toBe(true);
  });

  it('does not return an object far outside the query area', () => {
    const hash = new SpatialHash(100);
    hash.insert('a', { minX: 10, minY: 10, maxX: 50, maxY: 50 });
    const result = hash.queryBounds({ minX: 10000, minY: 10000, maxX: 10050, maxY: 10050 });
    expect(result.has('a')).toBe(false);
  });

  it('an object spanning multiple cells is found from a query into any of them', () => {
    const hash = new SpatialHash(100);
    hash.insert('wide', { minX: 0, minY: 0, maxX: 250, maxY: 10 }); // spans cells 0,1,2 on x
    expect(hash.queryBounds({ minX: 220, minY: 0, maxX: 230, maxY: 10 }).has('wide')).toBe(true);
  });

  it('margin expands the query area', () => {
    const hash = new SpatialHash(100);
    hash.insert('a', { minX: 300, minY: 300, maxX: 320, maxY: 320 });
    expect(hash.queryBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 0).has('a')).toBe(false);
    expect(hash.queryBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000).has('a')).toBe(true);
  });

  it('rebuild replaces the index from an objects Map, optionally skipping one id', () => {
    const hash = new SpatialHash(100);
    const objects = new Map([
      ['a', { id: 'a', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }],
      ['b', { id: 'b', points: [{ x: 500, y: 500 }, { x: 510, y: 510 }] }],
    ]);
    hash.rebuild(objects, 'b');
    const result = hash.queryBounds({ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 });
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(false); // skipped
  });

  it('clear empties the index', () => {
    const hash = new SpatialHash(100);
    hash.insert('a', { minX: 0, minY: 0, maxX: 10, maxY: 10 });
    hash.clear();
    expect(hash.queryBounds({ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 }).size).toBe(0);
  });
});
