import { describe, it, expect } from 'vitest';
import { getResizeHandles, hitTestHandles, resizePoints, RESIZABLE_TYPES } from './resizeHandles.js';

describe('RESIZABLE_TYPES', () => {
  it('includes rect/circle/line and excludes freehand strokes', () => {
    expect(RESIZABLE_TYPES.has('rect')).toBe(true);
    expect(RESIZABLE_TYPES.has('circle')).toBe(true);
    expect(RESIZABLE_TYPES.has('line')).toBe(true);
    expect(RESIZABLE_TYPES.has('path')).toBe(false);
    expect(RESIZABLE_TYPES.has('eraser')).toBe(false);
  });
});

describe('getResizeHandles', () => {
  it('returns 8 bbox handles for a rect', () => {
    const handles = getResizeHandles({ type: 'rect', points: [{ x: 0, y: 0 }, { x: 100, y: 50 }] });
    expect(handles).toHaveLength(8);
    const nw = handles.find((h) => h.id === 'nw');
    const se = handles.find((h) => h.id === 'se');
    expect(nw).toMatchObject({ x: 0, y: 0, cursor: 'nwse-resize' });
    expect(se).toMatchObject({ x: 100, y: 50, cursor: 'nwse-resize' });
  });

  it('returns 8 bbox handles for a circle, same as rect (bbox-based)', () => {
    const handles = getResizeHandles({ type: 'circle', points: [{ x: 0, y: 0 }, { x: 40, y: 40 }] });
    expect(handles).toHaveLength(8);
  });

  it('returns exactly 2 endpoint handles for a line', () => {
    const handles = getResizeHandles({ type: 'line', points: [{ x: 5, y: 5 }, { x: 50, y: 60 }] });
    expect(handles).toEqual([
      { id: 'start', x: 5, y: 5, cursor: 'pointer' },
      { id: 'end', x: 50, y: 60, cursor: 'pointer' },
    ]);
  });

  it('returns [] for a non-resizable type', () => {
    expect(getResizeHandles({ type: 'path', points: [{ x: 0, y: 0 }] })).toEqual([]);
  });
});

describe('hitTestHandles', () => {
  it('finds a handle within tolerance', () => {
    const handles = getResizeHandles({ type: 'rect', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] });
    expect(hitTestHandles(handles, { x: 2, y: 1 }, 5)?.id).toBe('nw');
  });
  it('returns null when nothing is close enough', () => {
    const handles = getResizeHandles({ type: 'rect', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] });
    expect(hitTestHandles(handles, { x: 500, y: 500 }, 5)).toBeNull();
  });
});

describe('resizePoints', () => {
  it('dragging the se handle moves only the bottom-right corner', () => {
    const result = resizePoints('rect', [{ x: 0, y: 0 }, { x: 100, y: 100 }], 'se', { x: 150, y: 130 });
    expect(result).toEqual([{ x: 0, y: 0 }, { x: 150, y: 130 }]);
  });

  it('dragging the nw handle moves only the top-left corner', () => {
    const result = resizePoints('rect', [{ x: 0, y: 0 }, { x: 100, y: 100 }], 'nw', { x: -20, y: -10 });
    expect(result).toEqual([{ x: -20, y: -10 }, { x: 100, y: 100 }]);
  });

  it('dragging a side handle (e) only moves that one axis', () => {
    const result = resizePoints('rect', [{ x: 0, y: 0 }, { x: 100, y: 100 }], 'e', { x: 200, y: 999 });
    expect(result).toEqual([{ x: 0, y: 0 }, { x: 200, y: 100 }]);
  });

  it('enforces a minimum size instead of collapsing to zero or flipping', () => {
    const result = resizePoints('rect', [{ x: 0, y: 0 }, { x: 100, y: 100 }], 'se', { x: 0, y: 0 });
    expect(result[1].x).toBeGreaterThan(result[0].x);
    expect(result[1].y).toBeGreaterThan(result[0].y);
  });

  it('moves the dragged endpoint of a line directly, leaving the other untouched', () => {
    const result = resizePoints('line', [{ x: 0, y: 0 }, { x: 50, y: 50 }], 'start', { x: -20, y: -20 });
    expect(result).toEqual([{ x: -20, y: -20 }, { x: 50, y: 50 }]);
  });

  it('is correct regardless of zoom, since it operates purely in world coordinates', () => {
    // resizePoints has no notion of screen/zoom at all -- same math at any scale
    const a = resizePoints('rect', [{ x: 0, y: 0 }, { x: 100, y: 100 }], 'se', { x: 300, y: 300 });
    const b = resizePoints('rect', [{ x: 0, y: 0 }, { x: 100, y: 100 }], 'se', { x: 300, y: 300 });
    expect(a).toEqual(b);
  });
});
