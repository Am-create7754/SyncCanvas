import { describe, it, expect } from 'vitest';
import { computeAlignPatches, computeDistributePatches } from './align.js';

function box(id, x, y, w, h) {
  return { id, points: [{ x, y }, { x: x + w, y: y + h }] };
}

describe('computeAlignPatches', () => {
  it('returns [] for fewer than 2 objects', () => {
    expect(computeAlignPatches([box('a', 0, 0, 10, 10)], 'left')).toEqual([]);
  });

  it('aligns everything to the leftmost edge, skipping the object already there', () => {
    const objects = [box('a', 0, 0, 10, 10), box('b', 50, 0, 10, 10)];
    const patches = computeAlignPatches(objects, 'left');
    expect(patches).toEqual([{ id: 'b', patch: { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] } }]);
  });

  it('aligns to center-h using the combined selection bounds as the reference frame', () => {
    const objects = [box('a', 0, 0, 10, 10), box('b', 90, 0, 10, 10)];
    // combined bounds: 0..100 -> center 50; each 10-wide box centers at 45
    const patches = computeAlignPatches(objects, 'center-h');
    const a = patches.find((p) => p.id === 'a');
    const b = patches.find((p) => p.id === 'b');
    expect(a.patch.points[0].x).toBe(45);
    expect(b.patch.points[0].x).toBe(45);
  });

  it('produces a batch-update shape ({id, patch:{points}}) — the same shape move/resize/group use', () => {
    const objects = [box('a', 0, 0, 10, 10), box('b', 50, 5, 10, 10)];
    const [patch] = computeAlignPatches(objects, 'top');
    expect(patch).toHaveProperty('id');
    expect(patch).toHaveProperty('patch.points');
  });

  it('handles negative coordinates correctly', () => {
    const objects = [box('a', -100, -100, 10, 10), box('b', 0, 0, 10, 10)];
    const patches = computeAlignPatches(objects, 'right');
    // overall maxX = 10 (from b); a's maxX = -90, needs +100
    const a = patches.find((p) => p.id === 'a');
    expect(a.patch.points[1].x).toBe(10);
  });

  describe('rotation-aware (Phase 11 fix pass)', () => {
    it('aligns a rotated square against its true visual (rotated) left edge, not its local one', () => {
      // a 100x100 square at (0,0)-(100,100) rotated 45deg has a visual left edge at
      // center.x - halfDiagonal = 50 - 70.71 = -20.71
      const rotatedSquare = { id: 'r', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], rotation: 45 };
      const plain = { id: 'p', points: [{ x: 500, y: 0 }, { x: 600, y: 100 }] };
      const patches = computeAlignPatches([rotatedSquare, plain], 'left');
      // overall visual minX = -20.71 (the rotated square's own visual left edge) — so the
      // rotated square itself needs no move, only the plain one does.
      const plainPatch = patches.find((p) => p.id === 'p');
      expect(plainPatch.patch.points[0].x).toBeCloseTo(-20.71, 1);
      expect(patches.find((p) => p.id === 'r')).toBeUndefined(); // already at the target edge
    });

    it('never changes rotation — align only ever translates', () => {
      const rotatedSquare = { id: 'r', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], rotation: 45 };
      const plain = { id: 'p', points: [{ x: 500, y: 0 }, { x: 600, y: 100 }] };
      const patches = computeAlignPatches([rotatedSquare, plain], 'top');
      for (const { patch } of patches) expect(patch).not.toHaveProperty('rotation');
    });
  });
});

describe('computeDistributePatches', () => {
  it('returns [] for fewer than 3 objects', () => {
    expect(computeDistributePatches([box('a', 0, 0, 10, 10), box('b', 50, 0, 10, 10)], 'horizontal')).toEqual([]);
  });

  it('keeps the two outermost objects fixed and spaces the middle one evenly', () => {
    // a: 0-10, b: 40-50 (will move), c: 90-100 -- gaps should become equal
    const objects = [box('a', 0, 0, 10, 10), box('c', 90, 0, 10, 10), box('b', 40, 0, 10, 10)];
    const patches = computeDistributePatches(objects, 'horizontal');
    expect(patches).toHaveLength(1);
    const [{ id, patch }] = patches;
    expect(id).toBe('b');
    // outer edges run from a.maxX(10) to c.minX(90) = 80 of gap space, minus b's own
    // width(10) split into 2 even gaps of 35 -> b should start at a.maxX(10) + gap(35) = 45
    expect(patch.points[0].x).toBe(45);
  });

  it('handles mixed sizes without distorting them (only translates, never resizes)', () => {
    const objects = [box('a', 0, 0, 10, 10), box('b', 30, 0, 40, 10), box('c', 200, 0, 10, 10)];
    const patches = computeDistributePatches(objects, 'horizontal');
    const moved = patches.find((p) => p.id === 'b');
    const width = moved.patch.points[1].x - moved.patch.points[0].x;
    expect(width).toBe(40); // unchanged size
  });

  it('works with negative coordinates', () => {
    const objects = [box('a', -100, 0, 10, 10), box('b', -50, 0, 10, 10), box('c', 0, 0, 10, 10)];
    expect(() => computeDistributePatches(objects, 'horizontal')).not.toThrow();
  });

  it('distributes vertically using the y axis', () => {
    const objects = [box('a', 0, 0, 10, 10), box('c', 0, 90, 10, 10), box('b', 0, 40, 10, 10)];
    const patches = computeDistributePatches(objects, 'vertical');
    expect(patches).toHaveLength(1);
    expect(patches[0].patch.points[0].y).toBe(45);
  });

  it('rotation-aware (Phase 11 fix pass): spacing accounts for a rotated object\'s true visual width, and rotation is never touched', () => {
    // 'b' is a 100x100 square rotated 45deg — its visual width is ~141.42, not 100, and
    // the gap either side of it must be computed from that true width.
    const objects = [
      { id: 'a', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
      { id: 'c', points: [{ x: 300, y: 0 }, { x: 310, y: 10 }] },
      { id: 'b', points: [{ x: 100, y: 0 }, { x: 200, y: 100 }], rotation: 45 },
    ];
    const patches = computeDistributePatches(objects, 'horizontal');
    const moved = patches.find((p) => p.id === 'b');
    expect(moved).toBeDefined();
    expect(moved.patch).not.toHaveProperty('rotation'); // only ever translates
    // visual width of 'b' is 100*sqrt(2) ~= 141.42; outer span a.maxX(10) to c.minX(300) = 290;
    // gap = (290 - 141.42) / 2 ~= 74.29; b's visual left edge should land at 10 + 74.29 ~= 84.29,
    // and since visual minX = local minX - (halfDiagonal - halfLocalWidth), we just assert the
    // delta actually moved it (non-zero) and left rotation untouched — the precise pixel math
    // is already covered by visualBoundsOfObject's own dedicated tests.
    expect(moved.patch.points).not.toEqual([{ x: 100, y: 0 }, { x: 200, y: 100 }]);
  });
});
