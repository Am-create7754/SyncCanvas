import { describe, it, expect } from 'vitest';
import { describeOperation, markerFor, isMajorOperation } from './describeOperation.js';

function op(overrides) {
  return { id: 'op1', sequence: 1, timestamp: 1000, userId: 'u1', username: 'Amber', forward: {}, summary: {}, ...overrides };
}

describe('describeOperation', () => {
  it('never leaks raw event names or ids — always a readable sentence naming the user', () => {
    const sentence = describeOperation(op({ type: 'OBJECT_STYLE_CHANGE', forward: { patches: [{ id: 'abc123', patch: { color: '#fff' } }] } }));
    expect(sentence).not.toMatch(/OBJECT_UPDATE/);
    expect(sentence).not.toMatch(/abc123/);
    expect(sentence.startsWith('Amber')).toBe(true);
  });

  it('describes object creation by shape type', () => {
    expect(describeOperation(op({ type: 'OBJECT_CREATE', forward: { objects: [{ type: 'rect' }] } }))).toBe('Amber created a rectangle');
    expect(describeOperation(op({ type: 'OBJECT_CREATE', forward: { objects: [{ type: 'circle' }] } }))).toBe('Amber created a circle');
  });

  it('describes multi-object creation with a count', () => {
    expect(describeOperation(op({ type: 'OBJECT_CREATE', forward: { objects: [{ type: 'rect' }, { type: 'circle' }] } }))).toBe('Amber created 2 objects');
  });

  it('describes strokes distinctly from shapes', () => {
    expect(describeOperation(op({ type: 'STROKE_CREATE' }))).toBe('Amber drew a stroke');
  });

  it('describes deletion with a count', () => {
    expect(describeOperation(op({ type: 'OBJECT_DELETE', forward: { ids: ['a', 'b', 'c'] } }))).toBe('Amber deleted 3 objects');
  });

  it('describes move/resize/group/ungroup/align/distribute/layer changes in plain language', () => {
    expect(describeOperation(op({ type: 'OBJECT_MOVE', forward: { patches: [{}, {}, {}] } }))).toBe('Amber moved 3 objects');
    expect(describeOperation(op({ type: 'OBJECT_RESIZE' }))).toBe('Amber resized an object');
    expect(describeOperation(op({ type: 'GROUP', forward: { patches: [{}, {}] } }))).toBe('Amber grouped 2 objects');
    expect(describeOperation(op({ type: 'UNGROUP' }))).toBe('Amber ungrouped objects');
    expect(describeOperation(op({ type: 'ALIGN' }))).toBe('Amber aligned objects');
    expect(describeOperation(op({ type: 'DISTRIBUTE' }))).toBe('Amber distributed objects');
    expect(describeOperation(op({ type: 'LAYER_CHANGE' }))).toBe('Amber changed layer order');
  });

  it('describes a style change with the specific field that changed', () => {
    expect(describeOperation(op({ type: 'OBJECT_STYLE_CHANGE', forward: { patches: [{ id: 'a', patch: { fillColor: '#F97316' } }] } }))).toBe('Amber changed fill');
    expect(describeOperation(op({ type: 'OBJECT_STYLE_CHANGE', forward: { patches: [{ id: 'a', patch: { color: '#000' } }] } }))).toBe('Amber changed stroke color');
    expect(describeOperation(op({ type: 'OBJECT_STYLE_CHANGE', forward: { patches: [{ id: 'a', patch: { width: 8 } }] } }))).toBe('Amber changed stroke width');
  });

  it('describes clear/import/restore/checkpoint document-level operations', () => {
    expect(describeOperation(op({ type: 'CLEAR_CANVAS', summary: { count: 42 } }))).toBe('Amber cleared the canvas (42 objects)');
    expect(describeOperation(op({ type: 'DOCUMENT_IMPORT' }))).toBe('Amber imported a document');
    expect(describeOperation(op({ type: 'DOCUMENT_RESTORE' }))).toBe('Amber restored a previous version');
    expect(describeOperation(op({ type: 'CHECKPOINT_CREATED', summary: { name: 'Initial layout' } }))).toBe('Amber created checkpoint "Initial layout"');
  });

  it('falls back to "Someone" when no username is available', () => {
    expect(describeOperation(op({ type: 'DOCUMENT_IMPORT', username: '' }))).toBe('Someone imported a document');
  });
});

describe('markerFor / isMajorOperation', () => {
  it('gives every operation type some marker glyph', () => {
    expect(markerFor(op({ type: 'OBJECT_CREATE' }))).toBeTruthy();
    expect(markerFor(op({ type: 'unknown-type' }))).toBeTruthy();
  });

  it('only flags document-level operations as "major" (timeline-marker-worthy)', () => {
    expect(isMajorOperation(op({ type: 'CLEAR_CANVAS' }))).toBe(true);
    expect(isMajorOperation(op({ type: 'DOCUMENT_IMPORT' }))).toBe(true);
    expect(isMajorOperation(op({ type: 'DOCUMENT_RESTORE' }))).toBe(true);
    expect(isMajorOperation(op({ type: 'CHECKPOINT_CREATED' }))).toBe(true);
    expect(isMajorOperation(op({ type: 'OBJECT_MOVE' }))).toBe(false);
    expect(isMajorOperation(op({ type: 'STROKE_CREATE' }))).toBe(false);
  });
});
