import { describe, it, expect } from 'vitest';
import { hitTestObject, hitTestScene } from './hitTest.js';

const rect = { id: 'r1', type: 'rect', points: [{ x: 0, y: 0 }, { x: 100, y: 50 }], width: 2 };
const circle = { id: 'c1', type: 'circle', points: [{ x: 200, y: 200 }, { x: 300, y: 300 }], width: 2 };
const line = { id: 'l1', type: 'line', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], width: 4 };

describe('hitTestObject', () => {
  it('treats a rect as selectable anywhere inside its bounding box, not just the outline', () => {
    expect(hitTestObject(rect, { x: 50, y: 25 }, 5)).toBe(true);
  });
  it('rejects a point clearly outside the rect', () => {
    expect(hitTestObject(rect, { x: 500, y: 500 }, 5)).toBe(false);
  });
  it('accepts a point inside the circle ellipse', () => {
    expect(hitTestObject(circle, { x: 250, y: 250 }, 5)).toBe(true);
  });
  it('rejects a point outside the circle ellipse but inside its bounding box corner', () => {
    expect(hitTestObject(circle, { x: 201, y: 201 }, 0)).toBe(false);
  });
  it('accepts a point near a line segment within tolerance', () => {
    expect(hitTestObject(line, { x: 50, y: 1 }, 5)).toBe(true);
  });
  it('rejects a point far from the line', () => {
    expect(hitTestObject(line, { x: 50, y: 50 }, 5)).toBe(false);
  });
});

describe('hitTestScene', () => {
  it('returns the topmost (last-drawn) object when several overlap', () => {
    const map = new Map([
      ['r1', rect],
      ['r2', { ...rect, id: 'r2' }],
    ]);
    expect(hitTestScene(map, { x: 50, y: 25 }, 5)).toBe('r2');
  });
  it('returns null when nothing is under the point', () => {
    const map = new Map([['r1', rect]]);
    expect(hitTestScene(map, { x: 9999, y: 9999 }, 5)).toBeNull();
  });
});
