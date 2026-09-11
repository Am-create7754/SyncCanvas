import { describe, it, expect } from 'vitest';
import {
  normalizeRotation, getObjectCenter, rotateAround, toLocalPoint, angleFromCenter,
  snapRotation, getRotationHandlePosition, visualBoundsOfObject, ROTATABLE_TYPES,
} from './rotation.js';

describe('normalizeRotation', () => {
  it('leaves an in-range value alone', () => {
    expect(normalizeRotation(45)).toBe(45);
    expect(normalizeRotation(0)).toBe(0);
  });
  it('wraps values >= 360', () => {
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(370)).toBe(10);
    expect(normalizeRotation(720 + 30)).toBe(30);
  });
  it('wraps negative values into [0, 360)', () => {
    expect(normalizeRotation(-10)).toBe(350);
    expect(normalizeRotation(-370)).toBe(350);
  });
});

describe('getObjectCenter', () => {
  it('returns the bbox center of the object\'s points', () => {
    const obj = { points: [{ x: 0, y: 0 }, { x: 100, y: 50 }] };
    expect(getObjectCenter(obj)).toEqual({ x: 50, y: 25 });
  });
});

describe('rotateAround / toLocalPoint round-trip', () => {
  it('rotating 90 degrees then -90 degrees returns the original point', () => {
    const center = { x: 10, y: 10 };
    const point = { x: 20, y: 10 };
    const rotated = rotateAround(point, center, 90);
    const back = toLocalPoint(rotated, center, 90);
    expect(back.x).toBeCloseTo(point.x, 9);
    expect(back.y).toBeCloseTo(point.y, 9);
  });

  it('a 0-degree rotation is the identity', () => {
    const p = { x: 5, y: 7 };
    expect(rotateAround(p, { x: 0, y: 0 }, 0)).toEqual({ x: 5, y: 7 });
  });

  it('rotating a point 90deg clockwise around the origin matches the canvas convention (+y down)', () => {
    const rotated = rotateAround({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(rotated.x).toBeCloseTo(0, 9);
    expect(rotated.y).toBeCloseTo(10, 9);
  });

  it('toLocalPoint inverse-rotates a world point back into local space', () => {
    const center = { x: 0, y: 0 };
    const worldPoint = rotateAround({ x: 10, y: 0 }, center, 90); // now at (0,10)
    const local = toLocalPoint(worldPoint, center, 90);
    expect(local.x).toBeCloseTo(10, 9);
    expect(local.y).toBeCloseTo(0, 9);
  });
});

describe('angleFromCenter', () => {
  it('0 degrees points along +x', () => {
    expect(angleFromCenter({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0, 9);
  });
  it('90 degrees points along +y (clockwise/down)', () => {
    expect(angleFromCenter({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(90, 9);
  });
});

describe('snapRotation', () => {
  it('snaps to the nearest 15-degree increment by default', () => {
    expect(snapRotation(7)).toBe(0);
    expect(snapRotation(8)).toBe(15);
    expect(snapRotation(44)).toBe(45);
    expect(snapRotation(46)).toBe(45);
  });
  it('normalizes after snapping near the wraparound', () => {
    expect(snapRotation(358)).toBe(0);
  });
  it('supports a custom increment', () => {
    expect(snapRotation(40, 45)).toBe(45);
  });
});

describe('getRotationHandlePosition', () => {
  it('sits above the bbox center when rotation is 0', () => {
    const obj = { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], rotation: 0 };
    const handle = getRotationHandlePosition(obj, 1);
    expect(handle.x).toBeCloseTo(50, 6);
    expect(handle.y).toBeLessThan(0); // above the top edge
  });

  it('rotates along with the object at 180 degrees (handle moves below the object)', () => {
    const obj = { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], rotation: 180 };
    const handle = getRotationHandlePosition(obj, 1);
    expect(handle.x).toBeCloseTo(50, 6);
    expect(handle.y).toBeGreaterThan(100); // now below the bottom edge
  });
});

describe('visualBoundsOfObject', () => {
  it('matches the local bounds when rotation is 0', () => {
    const obj = { points: [{ x: 0, y: 0 }, { x: 100, y: 50 }], rotation: 0 };
    expect(visualBoundsOfObject(obj)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
  });

  it('expands to cover the rotated corners at 45 degrees', () => {
    const obj = { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], rotation: 45 };
    const bounds = visualBoundsOfObject(obj);
    // A square rotated 45deg around its own center has a diagonal-aligned bbox ~1.414x wider
    expect(bounds.maxX - bounds.minX).toBeCloseTo(100 * Math.SQRT2, 3);
    expect(bounds.maxY - bounds.minY).toBeCloseTo(100 * Math.SQRT2, 3);
  });

  it('a 90-degree rotation on a non-square rect swaps its effective width/height', () => {
    const obj = { points: [{ x: 0, y: 0 }, { x: 200, y: 50 }], rotation: 90 };
    const bounds = visualBoundsOfObject(obj);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(50, 6);
    expect(bounds.maxY - bounds.minY).toBeCloseTo(200, 6);
  });
});

describe('ROTATABLE_TYPES', () => {
  it('includes rect and line, excludes circle (spec: rotation-symmetric, not meaningful)', () => {
    expect(ROTATABLE_TYPES.has('rect')).toBe(true);
    expect(ROTATABLE_TYPES.has('line')).toBe(true);
    expect(ROTATABLE_TYPES.has('circle')).toBe(false);
  });
});
