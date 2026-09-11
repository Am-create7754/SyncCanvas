import { describe, it, expect, beforeEach } from 'vitest';
import { serializeDocument } from './documentFormat.js';
import { saveAutosave, readAutosave, clearAutosave, listSnapshots, saveSnapshot, deleteSnapshot, getSnapshot } from './storage.js';

function makeDoc(name = 'Test') {
  return serializeDocument(new Map([['o1', { id: 'o1', type: 'path', color: '#000', width: 4, points: [{ x: 0, y: 0 }] }]]), { name });
}

describe('autosave storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a document for a given room', () => {
    const doc = makeDoc();
    expect(saveAutosave('ROOM1', doc)).toBe(true);
    expect(readAutosave('ROOM1')).toEqual(doc);
  });

  it('keeps different rooms in separate slots', () => {
    saveAutosave('ROOM1', makeDoc('A'));
    saveAutosave('ROOM2', makeDoc('B'));
    expect(readAutosave('ROOM1').metadata.name).toBe('A');
    expect(readAutosave('ROOM2').metadata.name).toBe('B');
  });

  it('returns null when nothing has been saved for that room', () => {
    expect(readAutosave('NEVER-SAVED')).toBeNull();
  });

  it('safely ignores corrupted stored JSON instead of throwing', () => {
    localStorage.setItem('synccanvas:autosave:ROOM1', 'not valid json{{{');
    expect(() => readAutosave('ROOM1')).not.toThrow();
    expect(readAutosave('ROOM1')).toBeNull();
  });

  it('safely ignores a stored document that fails schema validation', () => {
    localStorage.setItem('synccanvas:autosave:ROOM1', JSON.stringify({ format: 'wrong', version: 1, objects: [] }));
    expect(readAutosave('ROOM1')).toBeNull();
  });

  it('clearAutosave removes only that room’s entry', () => {
    saveAutosave('ROOM1', makeDoc());
    saveAutosave('ROOM2', makeDoc());
    clearAutosave('ROOM1');
    expect(readAutosave('ROOM1')).toBeNull();
    expect(readAutosave('ROOM2')).not.toBeNull();
  });
});

describe('snapshot storage', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty', () => {
    expect(listSnapshots()).toEqual([]);
  });

  it('saves and lists a snapshot, newest first', () => {
    saveSnapshot('First', makeDoc('First'));
    saveSnapshot('Second', makeDoc('Second'));
    const list = listSnapshots();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('Second');
  });

  it('generates a timestamp-based name when none is given', () => {
    const entry = saveSnapshot('', makeDoc());
    expect(entry.name).toMatch(/Snapshot/);
  });

  it('deletes a snapshot by id', () => {
    const entry = saveSnapshot('ToDelete', makeDoc());
    expect(getSnapshot(entry.id)).not.toBeNull();
    deleteSnapshot(entry.id);
    expect(getSnapshot(entry.id)).toBeNull();
  });

  it('caps the snapshot count instead of growing storage unbounded', () => {
    for (let i = 0; i < 12; i++) saveSnapshot(`Snap ${i}`, makeDoc());
    expect(listSnapshots().length).toBeLessThanOrEqual(8);
  });
});
