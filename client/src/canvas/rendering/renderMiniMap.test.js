import { describe, it, expect, vi } from 'vitest';
import { render } from './renderMiniMap.js';

/** A minimal fake CanvasRenderingContext2D — every drawing call is a no-op so `render` can
 *  run against it without a real <canvas>, matching the project's "pure logic, no DOM"
 *  testing style used everywhere else (see canvas/geometry/*.test.js). */
function makeCtx() {
  const ctx = {
    setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(), arc: vi.fn(),
  };
  return ctx;
}

function makeEngine(objects) {
  const objectsMap = new Map(objects.map((o) => [o.id, o]));
  return {
    viewport: { x: 0, y: 0, scale: 1 },
    cssWidth: 200,
    cssHeight: 150,
    getDisplayObjects: () => objectsMap,
  };
}

describe('MiniMap render (Phase 9 degenerate-object regression + Phase 11 rotation)', () => {
  it('does not throw for a rect with 0 points', () => {
    const engine = makeEngine([{ id: 'a', type: 'rect', color: '#000', points: [] }]);
    expect(() => render(makeCtx(), 1, engine, { current: null }, false)).not.toThrow();
  });

  it('does not throw for a rect with exactly 1 point (draw-start, before draw-update arrives)', () => {
    const engine = makeEngine([{ id: 'a', type: 'rect', color: '#000', points: [{ x: 5, y: 5 }] }]);
    expect(() => render(makeCtx(), 1, engine, { current: null }, false)).not.toThrow();
  });

  it('does not throw for a circle with 1 point either', () => {
    const engine = makeEngine([{ id: 'a', type: 'circle', color: '#000', points: [{ x: 5, y: 5 }] }]);
    expect(() => render(makeCtx(), 1, engine, { current: null }, false)).not.toThrow();
  });

  it('renders a well-formed rect via fillRect/strokeRect without throwing', () => {
    const engine = makeEngine([{ id: 'a', type: 'rect', color: '#000', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }]);
    const ctx = makeCtx();
    expect(() => render(ctx, 1, engine, { current: null }, false)).not.toThrow();
    expect(ctx.strokeRect).toHaveBeenCalled();
  });

  it('applies a translate/rotate/translate transform for a rotated rect, and none for an unrotated one', () => {
    const rotated = makeEngine([{ id: 'a', type: 'rect', color: '#000', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], rotation: 45 }]);
    const ctxRotated = makeCtx();
    render(ctxRotated, 1, rotated, { current: null }, false);
    expect(ctxRotated.rotate).toHaveBeenCalledTimes(1);

    const plain = makeEngine([{ id: 'a', type: 'rect', color: '#000', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }]);
    const ctxPlain = makeCtx();
    render(ctxPlain, 1, plain, { current: null }, false);
    expect(ctxPlain.rotate).not.toHaveBeenCalled();
  });

  it('an eraser stroke and an empty document are both skipped safely', () => {
    const engine = makeEngine([{ id: 'a', type: 'eraser', color: '#000', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }]);
    expect(() => render(makeCtx(), 1, engine, { current: null }, false)).not.toThrow();
    expect(() => render(makeCtx(), 1, makeEngine([]), { current: null }, false)).not.toThrow();
  });

  describe('Phase 12: diagramming objects', () => {
    it('renders a sticky note as a small rect via strokeRect, same as rect/circle — not the generic polyline fallback', () => {
      const engine = makeEngine([{ id: 'a', type: 'sticky', color: '#000', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }]);
      const ctx = makeCtx();
      render(ctx, 1, engine, { current: null }, false);
      expect(ctx.strokeRect).toHaveBeenCalled();
      expect(ctx.moveTo).not.toHaveBeenCalled();
    });

    it('renders a frame as a small rect via strokeRect too', () => {
      const engine = makeEngine([{ id: 'a', type: 'frame', color: '#000', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }]);
      const ctx = makeCtx();
      render(ctx, 1, engine, { current: null }, false);
      expect(ctx.strokeRect).toHaveBeenCalled();
      expect(ctx.moveTo).not.toHaveBeenCalled();
    });

    it('applies rotation transform for a rotated sticky note (sticky IS rotatable, unlike frame)', () => {
      const engine = makeEngine([{ id: 'a', type: 'sticky', color: '#000', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], rotation: 30 }]);
      const ctx = makeCtx();
      render(ctx, 1, engine, { current: null }, false);
      expect(ctx.rotate).toHaveBeenCalledTimes(1);
    });

    it('renders a connector via the generic polyline path (moveTo/lineTo/stroke), not the rect branch', () => {
      const engine = makeEngine([{ id: 'a', type: 'connector', color: '#000', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }] }]);
      const ctx = makeCtx();
      render(ctx, 1, engine, { current: null }, false);
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.lineTo).toHaveBeenCalled();
      // strokeRect IS called once regardless — for the current-viewport rectangle drawn at
      // the end of every render — so a connector taking the rect branch too would show up
      // as a SECOND call, not zero.
      expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
    });

    it('does not throw for a degenerate (0- or 1-point) sticky/frame/connector', () => {
      const engine = makeEngine([
        { id: 'a', type: 'sticky', color: '#000', points: [] },
        { id: 'b', type: 'frame', color: '#000', points: [{ x: 5, y: 5 }] },
        { id: 'c', type: 'connector', color: '#000', points: [{ x: 5, y: 5 }] },
      ]);
      expect(() => render(makeCtx(), 1, engine, { current: null }, false)).not.toThrow();
    });
  });
});
