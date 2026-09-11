import { describe, it, expect, beforeEach } from 'vitest';
import { CanvasEngine } from './CanvasEngine.js';

/**
 * Final polish phase — regression test for the Shift-to-constrain QoL affordance in
 * _onPointerMove's shape-preview branch (rect/circle drawing). No real <canvas>/mount()
 * needed: engine.canvas only needs getBoundingClientRect for _screenPoint, and the
 * activeStrokeId guard short-circuits the cssWidth-dependent _isInsideCanvas check — the
 * same "pure state, no DOM" style CanvasEngine.text.test.js already uses.
 */

let engine;

beforeEach(() => {
  engine = new CanvasEngine();
  engine.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  engine.viewport = { scale: 1, x: 0, y: 0 };
  engine.activeStrokeId = 'preview-id';
  engine.shapeStart = { x: 0, y: 0 };
});

function moveTo(x, y, shiftKey) {
  engine._onPointerMove({ clientX: x, clientY: y, shiftKey });
}

describe('Final polish: Shift-constrains rect/circle to square/perfect-circle', () => {
  it('rect: an unequal drag becomes a square when Shift is held (larger axis wins)', () => {
    engine.tool = 'rect';
    engine.previewObject = { id: 'preview-id', type: 'rect', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] };

    moveTo(150, 50, true);

    const [a, b] = engine.previewObject.points;
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    expect(w).toBe(h);
    expect(w).toBe(150);
  });

  it('circle: same constrain behavior applies', () => {
    engine.tool = 'circle';
    engine.previewObject = { id: 'preview-id', type: 'circle', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] };

    moveTo(40, 200, true);

    const [a, b] = engine.previewObject.points;
    expect(Math.abs(b.x - a.x)).toBe(Math.abs(b.y - a.y));
    expect(Math.abs(b.y - a.y)).toBe(200);
  });

  it('preserves the drag direction (sign) in each axis, not just magnitude', () => {
    engine.tool = 'rect';
    engine.previewObject = { id: 'preview-id', type: 'rect', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] };

    moveTo(-30, -120, true);

    const [, b] = engine.previewObject.points;
    expect(b.x).toBe(-120);
    expect(b.y).toBe(-120);
  });

  it('without Shift, the drag stays unconstrained', () => {
    engine.tool = 'rect';
    engine.previewObject = { id: 'preview-id', type: 'rect', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] };

    moveTo(150, 50, false);

    const [a, b] = engine.previewObject.points;
    expect(Math.abs(b.x - a.x)).toBe(150);
    expect(Math.abs(b.y - a.y)).toBe(50);
  });

  it('does not constrain other shape tools (e.g. line)', () => {
    engine.tool = 'line';
    engine.previewObject = { id: 'preview-id', type: 'line', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] };

    moveTo(150, 50, true);

    const [a, b] = engine.previewObject.points;
    expect(Math.abs(b.x - a.x)).toBe(150);
    expect(Math.abs(b.y - a.y)).toBe(50);
  });
});
