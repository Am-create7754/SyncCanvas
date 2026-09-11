import { describe, it, expect } from 'vitest';
import { screenToWorld, worldToScreen, zoomAround, clampScale } from './viewport.js';

describe('screenToWorld / worldToScreen', () => {
  it('round-trips a point through an arbitrary viewport', () => {
    const viewport = { x: 40, y: -20, scale: 2.5 };
    const original = { x: 123, y: 456 };
    const world = screenToWorld(original, viewport);
    const back = worldToScreen(world, viewport);
    expect(back.x).toBeCloseTo(original.x);
    expect(back.y).toBeCloseTo(original.y);
  });
});

describe('zoomAround', () => {
  it('keeps the anchor point fixed in world space across a zoom change', () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    const anchor = { x: 200, y: 150 };
    const worldBefore = screenToWorld(anchor, viewport);

    const next = zoomAround(viewport, anchor, 2);
    const worldAfter = screenToWorld(anchor, next);

    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
  });

  it('clamps scale to the allowed range', () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    const next = zoomAround(viewport, { x: 0, y: 0 }, 999);
    expect(next.scale).toBe(clampScale(999));
    expect(next.scale).toBeLessThan(999);
  });
});
