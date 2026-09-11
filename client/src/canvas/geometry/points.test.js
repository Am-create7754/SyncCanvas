import { describe, it, expect } from 'vitest';
import { distance, shouldAcceptPoint, boundsOfPoints } from './points.js';

describe('distance', () => {
  it('computes euclidean distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('shouldAcceptPoint', () => {
  it('always accepts the first point of a stroke', () => {
    expect(shouldAcceptPoint(null, { x: 0, y: 0 }, 10)).toBe(true);
  });

  it('rejects points closer than the minimum distance', () => {
    expect(shouldAcceptPoint({ x: 0, y: 0 }, { x: 1, y: 1 }, 10)).toBe(false);
  });

  it('accepts points at or beyond the minimum distance', () => {
    expect(shouldAcceptPoint({ x: 0, y: 0 }, { x: 10, y: 0 }, 10)).toBe(true);
  });
});

describe('boundsOfPoints', () => {
  it('returns the axis-aligned bounding box', () => {
    const points = [{ x: 5, y: 5 }, { x: -2, y: 10 }, { x: 8, y: -3 }];
    expect(boundsOfPoints(points)).toEqual({ minX: -2, minY: -3, maxX: 8, maxY: 10 });
  });
});
