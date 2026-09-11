import { describe, it, expect } from 'vitest';
import { computeMoveSnap, computeMeasurements, snapToGridValue, snapPointToGrid, computeResizeSnap } from './snapping.js';

const bounds = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });

describe('snapToGridValue / snapPointToGrid', () => {
  it('rounds to the nearest multiple of gridSize', () => {
    expect(snapToGridValue(17, 16)).toBe(16);
    expect(snapToGridValue(25, 16)).toBe(32);
    expect(snapToGridValue(-5, 16)).toBeCloseTo(0); // -0 vs 0 — numerically identical, toBeCloseTo avoids Object.is's -0/0 distinction
  });
  it('snapPointToGrid applies to both axes independently', () => {
    expect(snapPointToGrid({ x: 17, y: 25 }, 16)).toEqual({ x: 16, y: 32 });
  });
});

describe('computeMoveSnap — smart guides', () => {
  it('snaps left edges together within threshold', () => {
    // dragged rect is 3 world units right of a candidate's left edge — well within threshold
    const dragged = bounds(103, 0, 203, 50);
    const candidates = [{ id: 'b', bounds: bounds(100, 200, 200, 250) }];
    const result = computeMoveSnap(dragged, candidates, { threshold: 8, smartGuidesEnabled: true, snapToGridEnabled: false, gridSize: 16 });
    expect(result.dx).toBeCloseTo(-3);
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0].axis).toBe('v');
    expect(result.guides[0].position).toBeCloseTo(100);
  });

  it('snaps centers together', () => {
    // dragged center (150,25) vs candidate center (150+2, ...) -> small delta within threshold
    const dragged = bounds(102, 0, 202, 50); // center x = 152
    const candidates = [{ id: 'b', bounds: bounds(50, 200, 250, 250) }]; // center x = 150
    const result = computeMoveSnap(dragged, candidates, { threshold: 8, smartGuidesEnabled: true, snapToGridEnabled: false, gridSize: 16 });
    expect(result.dx).toBeCloseTo(-2);
  });

  it('does not snap when nothing is within threshold', () => {
    const dragged = bounds(500, 500, 600, 550);
    const candidates = [{ id: 'b', bounds: bounds(0, 0, 100, 50) }];
    const result = computeMoveSnap(dragged, candidates, { threshold: 8, smartGuidesEnabled: true, snapToGridEnabled: false, gridSize: 16 });
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.guides).toHaveLength(0);
  });

  it('picks the single closest candidate deterministically when several are in range', () => {
    const dragged = bounds(105, 0, 205, 50);
    const candidates = [
      { id: 'far', bounds: bounds(110, 200, 210, 250) }, // delta 5
      { id: 'near', bounds: bounds(103, 300, 203, 350) }, // delta 2 — should win
    ];
    const result = computeMoveSnap(dragged, candidates, { threshold: 8, smartGuidesEnabled: true, snapToGridEnabled: false, gridSize: 16 });
    expect(result.dx).toBeCloseTo(-2);
  });

  it('falls back to grid snapping on an axis with no smart-guide match, when enabled', () => {
    const dragged = bounds(101, 0, 201, 50); // minX=101, nearest 16-multiple is 96
    const result = computeMoveSnap(dragged, [], { threshold: 8, smartGuidesEnabled: true, snapToGridEnabled: true, gridSize: 16 });
    expect(result.dx).toBeCloseTo(-5); // 101 -> 96
  });

  it('smart guides take priority over grid when both would apply', () => {
    const dragged = bounds(103, 0, 203, 50); // close to grid (96) AND close to a candidate at 100
    const candidates = [{ id: 'b', bounds: bounds(100, 200, 200, 250) }];
    const result = computeMoveSnap(dragged, candidates, { threshold: 8, smartGuidesEnabled: true, snapToGridEnabled: true, gridSize: 16 });
    expect(result.dx).toBeCloseTo(-3); // snapped to the guide (100), not the grid (96)
  });

  it('smart guides disabled entirely skips guide computation even within threshold', () => {
    const dragged = bounds(101, 0, 201, 50);
    const candidates = [{ id: 'b', bounds: bounds(100, 200, 200, 250) }];
    const result = computeMoveSnap(dragged, candidates, { threshold: 8, smartGuidesEnabled: false, snapToGridEnabled: false, gridSize: 16 });
    expect(result.dx).toBe(0);
    expect(result.guides).toHaveLength(0);
  });
});

describe('computeResizeSnap (Phase 11 fix pass — resize smart guides)', () => {
  it('snaps a moving right edge to a nearby candidate edge, regardless of which kind of edge it is', () => {
    // dragged right edge (maxX) at 103, a candidate's LEFT edge sits at 100 — different
    // "kind" than the move-only same-kind rule, which is exactly what resize should allow.
    const tentative = { minX: 0, minY: 0, maxX: 103, maxY: 50 };
    const candidates = [{ id: 'b', bounds: { minX: 100, minY: 0, maxX: 200, maxY: 50 } }];
    const result = computeResizeSnap(tentative, { x: 'maxX', y: null }, candidates, { threshold: 8, smartGuidesEnabled: true, snapToGridEnabled: false, gridSize: 16 });
    expect(result.dx).toBeCloseTo(-3);
    expect(result.dy).toBe(0);
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0].axis).toBe('v');
  });

  it('only touches the axis the handle actually moves', () => {
    const tentative = { minX: 0, minY: 0, maxX: 103, maxY: 103 };
    const candidates = [{ id: 'b', bounds: { minX: 100, minY: 1000, maxX: 200, maxY: 1050 } }];
    // 'n' handle only moves minY — an X-axis-only candidate match must never leak into dx
    const result = computeResizeSnap(tentative, { x: null, y: 'minY' }, candidates, { threshold: 8, smartGuidesEnabled: true, snapToGridEnabled: false, gridSize: 16 });
    expect(result.dx).toBe(0);
  });

  it('falls back to grid snapping when no smart-guide match is in range', () => {
    const tentative = { minX: 0, minY: 0, maxX: 101, maxY: 50 };
    const result = computeResizeSnap(tentative, { x: 'maxX', y: null }, [], { threshold: 8, smartGuidesEnabled: true, snapToGridEnabled: true, gridSize: 16 });
    expect(result.dx).toBeCloseTo(-5); // 101 -> 96
  });

  it('smart guide wins over grid when both would apply', () => {
    const tentative = { minX: 0, minY: 0, maxX: 103, maxY: 50 };
    const candidates = [{ id: 'b', bounds: { minX: 100, minY: 0, maxX: 200, maxY: 50 } }];
    const result = computeResizeSnap(tentative, { x: 'maxX', y: null }, candidates, { threshold: 8, smartGuidesEnabled: true, snapToGridEnabled: true, gridSize: 16 });
    expect(result.dx).toBeCloseTo(-3); // snapped to the guide (100), not the grid (96)
  });

  it('returns a zero correction when nothing is in range and grid is off', () => {
    const tentative = { minX: 0, minY: 0, maxX: 500, maxY: 50 };
    const result = computeResizeSnap(tentative, { x: 'maxX', y: 'maxY' }, [], { threshold: 8, smartGuidesEnabled: true, snapToGridEnabled: false, gridSize: 16 });
    expect(result).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});

describe('computeMeasurements', () => {
  it('reports the horizontal gap between two vertically-overlapping objects', () => {
    const dragged = bounds(0, 0, 100, 100);
    const candidates = [{ id: 'b', bounds: bounds(148, 20, 248, 80) }];
    const m = computeMeasurements(dragged, candidates);
    expect(m).toHaveLength(1);
    expect(m[0].axis).toBe('x');
    expect(m[0].distance).toBeCloseTo(48);
  });

  it('reports nothing when objects overlap (no real gap) or are too far apart', () => {
    const dragged = bounds(0, 0, 100, 100);
    const overlapping = [{ id: 'b', bounds: bounds(50, 50, 150, 150) }];
    expect(computeMeasurements(dragged, overlapping)).toHaveLength(0);

    const farAway = [{ id: 'c', bounds: bounds(10000, 0, 10100, 100) }];
    expect(computeMeasurements(dragged, farAway)).toHaveLength(0);
  });

  it('reports both x and y measurements when relevant neighbors exist on each axis', () => {
    const dragged = bounds(0, 0, 100, 100);
    const candidates = [
      { id: 'right', bounds: bounds(140, 0, 240, 100) }, // horizontal neighbor
      { id: 'below', bounds: bounds(0, 130, 100, 230) }, // vertical neighbor
    ];
    const m = computeMeasurements(dragged, candidates);
    expect(m.map((x) => x.axis).sort()).toEqual(['x', 'y']);
  });
});
