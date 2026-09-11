import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CanvasEngine } from './CanvasEngine.js';

/**
 * Final polish phase — regression tests for the Text tool / text-capable-shape editing
 * logic living in CanvasEngine. No real <canvas> needed (mount() is never called): every
 * behavior under test reads/mutates `engine.objects`/`engine.selectedObjectIds` directly
 * or listens for the `request-text-edit` CustomEvent the engine dispatches for the UI
 * layer to handle (see ui/textEditor.js), the same "pure state, no DOM" style the rest of
 * this project's engine-adjacent tests use.
 */

function rect(id, points, overrides = {}) {
  return { id, type: 'rect', color: '#111827', width: 4, points, createdAt: 1000, ...overrides };
}

let engine;

beforeEach(() => {
  engine = new CanvasEngine();
});

describe('Final polish: createTextObject', () => {
  it('creates nothing for empty or whitespace-only text — never litters the room with a blank object', () => {
    expect(engine.createTextObject({ x: 100, y: 100 }, '')).toBeNull();
    expect(engine.createTextObject({ x: 100, y: 100 }, '   ')).toBeNull();
    expect(engine.objects.size).toBe(0);
  });

  it('creates a text object centered on the given point, stamped with current text defaults', () => {
    engine.textFontSize = 24;
    engine.textFontFamily = 'Georgia';
    engine.textBold = true;
    engine.textItalic = true;
    engine.textUnderline = true;
    engine.textAlign = 'center';
    engine.textColor = '#2563EB';

    const created = engine.createTextObject({ x: 100, y: 100 }, 'Hello world');

    expect(created).not.toBeNull();
    expect(created.type).toBe('text');
    expect(created.text).toBe('Hello world');
    expect(created.fontSize).toBe(24);
    expect(created.fontFamily).toBe('Georgia');
    expect(created.bold).toBe(true);
    expect(created.italic).toBe(true);
    expect(created.underline).toBe(true);
    expect(created.textAlign).toBe('center');
    expect(created.textColor).toBe('#2563EB');
    // Centered on the click point.
    const [a, b] = created.points;
    expect((a.x + b.x) / 2).toBeCloseTo(100);
    expect((a.y + b.y) / 2).toBeCloseTo(100);
    expect(engine.objects.has(created.id)).toBe(true);
  });

  it('selects the newly-created text object', () => {
    const created = engine.createTextObject({ x: 0, y: 0 }, 'A note');
    expect([...engine.selectedObjectIds]).toEqual([created.id]);
  });
});

describe('Final polish: editSelectedText', () => {
  it('edits text content on a standalone text object', () => {
    const created = engine.createTextObject({ x: 0, y: 0 }, 'Original');
    engine.editSelectedText({ text: 'Updated' });
    expect(engine.objects.get(created.id).text).toBe('Updated');
  });

  it('edits text content and formatting on a rect (shape-embedded text)', () => {
    const r = rect('r1', [{ x: 0, y: 0 }, { x: 200, y: 100 }]);
    engine.objects.set(r.id, r);
    engine.selectedObjectIds = new Set(['r1']);

    engine.editSelectedText({ text: 'Backend API' });
    expect(engine.objects.get('r1').text).toBe('Backend API');

    engine.editSelectedText({ bold: true, fontSize: 20 });
    expect(engine.objects.get('r1')).toMatchObject({ bold: true, fontSize: 20, text: 'Backend API' });
  });

  it('is a no-op for a type that cannot carry text (e.g. a line)', () => {
    const line = { id: 'l1', type: 'line', color: '#000', width: 2, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], createdAt: 1000 };
    engine.objects.set(line.id, line);
    engine.selectedObjectIds = new Set(['l1']);
    expect(() => engine.editSelectedText({ text: 'nope' })).not.toThrow();
    expect(engine.objects.get('l1').text).toBeUndefined();
  });

  it('is a no-op when nothing is selected', () => {
    expect(() => engine.editSelectedText({ text: 'nope' })).not.toThrow();
  });
});

describe('Final polish: text-tool pointerdown routing (_handleTextPointerDown)', () => {
  it('dispatches request-text-edit with isNew:true for a click on empty canvas', () => {
    const handler = vi.fn();
    engine.addEventListener('request-text-edit', handler);
    engine._handleTextPointerDown({ x: 50, y: 50 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toMatchObject({ id: null, isNew: true, point: { x: 50, y: 50 } });
  });

  it('dispatches request-text-edit with isNew:false and selects the shape when clicking an existing text-capable object', () => {
    const r = rect('r1', [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    engine.objects.set(r.id, r);
    const handler = vi.fn();
    engine.addEventListener('request-text-edit', handler);

    engine._handleTextPointerDown({ x: 50, y: 50 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ id: 'r1', isNew: false });
    expect([...engine.selectedObjectIds]).toEqual(['r1']);
  });

  it('does nothing when clicking an object that cannot carry text (e.g. a line)', () => {
    const line = { id: 'l1', type: 'line', color: '#000', width: 2, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], createdAt: 1000 };
    engine.objects.set(line.id, line);
    const handler = vi.fn();
    engine.addEventListener('request-text-edit', handler);

    engine._handleTextPointerDown({ x: 50, y: 50 });

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('Final polish: TEXT_CAPABLE_TYPES / RESIZABLE_TYPES / hitTest integration', () => {
  it('a text object is selectable, resizable, and movable like any other bbox shape', async () => {
    const { RESIZABLE_TYPES } = await import('../geometry/resizeHandles.js');
    expect(RESIZABLE_TYPES.has('text')).toBe(true);
  });

  it('a text object is hit-testable via its bounding box', async () => {
    const { hitTestObject } = await import('../geometry/hitTest.js');
    const textObj = { id: 't1', type: 'text', color: '#000', width: 1, points: [{ x: 0, y: 0 }, { x: 100, y: 40 }], text: 'Hi' };
    expect(hitTestObject(textObj, { x: 50, y: 20 }, 0)).toBe(true);
    expect(hitTestObject(textObj, { x: 500, y: 500 }, 0)).toBe(false);
  });
});
