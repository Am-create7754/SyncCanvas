import { describe, it, expect } from 'vitest';
import { serializeDocument, validateDocument } from './documentFormat.js';

function makeObjectsMap() {
  return new Map([
    ['o1', { id: 'o1', type: 'rect', color: '#111827', width: 4, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], fillEnabled: true, fillColor: '#F97316', fillOpacity: 0.6 }],
  ]);
}

describe('serializeDocument', () => {
  it('produces a well-formed, currently-valid document', () => {
    const doc = serializeDocument(makeObjectsMap(), { name: 'My Drawing' });
    expect(validateDocument(doc)).toEqual({ ok: true, document: doc });
    expect(doc.metadata.name).toBe('My Drawing');
    expect(doc.objects).toHaveLength(1);
  });

  it('defaults the name to "Untitled Canvas" when none is given', () => {
    const doc = serializeDocument(new Map());
    expect(doc.metadata.name).toBe('Untitled Canvas');
  });

  it('never includes ephemeral or local-UI state — only what the objects map contains', () => {
    const doc = serializeDocument(makeObjectsMap(), { name: 'x' });
    const keys = Object.keys(doc);
    expect(keys.sort()).toEqual(['format', 'metadata', 'objects', 'version']);
  });
});

describe('validateDocument', () => {
  it('rejects a plain empty object', () => {
    expect(validateDocument({}).ok).toBe(false);
  });
  it('rejects null and non-object input', () => {
    expect(validateDocument(null).ok).toBe(false);
    expect(validateDocument('hello').ok).toBe(false);
    expect(validateDocument(42).ok).toBe(false);
  });
  it('rejects a document from a foreign format', () => {
    expect(validateDocument({ format: 'other-app', version: 1, objects: [] }).ok).toBe(false);
  });
  it('accepts a document with an empty objects array', () => {
    const doc = serializeDocument(new Map());
    expect(validateDocument(doc).ok).toBe(true);
  });
});
