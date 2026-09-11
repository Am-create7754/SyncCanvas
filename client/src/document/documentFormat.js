import { LIMITS, validateDocument as sharedValidateDocument } from '@synccanvas/shared';

/**
 * The one canonical SyncCanvas document shape — used identically by JSON export, JSON
 * import, autosave, and snapshots, so there is exactly one serialization format instead
 * of three slightly-different ones. Only PERSISTENT collaborative state goes in here:
 * no cursors, no laser, no presence, no theme, no selected tool — see docs/ARCHITECTURE
 * for the state-category rules this follows.
 */

/** Builds a document from the engine's live object map. Read-only — never mutates.
 *  `history` (Phase 9, optional — "Export With History") is passed through verbatim from
 *  the fetched RoomHistory.serialize() shape; omitting it entirely (the default, "Export
 *  Drawing Only") keeps the file exactly the Phase 7 shape, so old files stay valid and
 *  new drawing-only exports stay just as small as they always were. */
export function serializeDocument(objectsMap, { name, history } = {}) {
  const now = new Date().toISOString();
  const doc = {
    format: LIMITS.DOCUMENT_FORMAT,
    version: LIMITS.DOCUMENT_VERSION,
    metadata: {
      name: (name || 'Untitled Canvas').slice(0, LIMITS.MAX_DOCUMENT_NAME_LEN),
      createdAt: now,
      updatedAt: now,
    },
    objects: [...objectsMap.values()],
  };
  if (history) {
    doc.history = {
      operations: history.operations,
      checkpoints: history.namedCheckpoints?.map((cp) => ({ name: cp.name, objects: cp.objects })) ?? [],
    };
  }
  return doc;
}

/**
 * Validates a raw value (typically `JSON.parse` output from an untrusted file) against
 * the document schema. Never throws — always returns a result object so callers can show
 * a specific error message instead of a generic "something went wrong".
 * @returns {{ok: true, document: object} | {ok: false, error: string}}
 */
export function validateDocument(raw) {
  const result = sharedValidateDocument(raw);
  if (!result.ok) return result;
  return { ok: true, document: raw };
}

export const IMPORT_ERROR_MESSAGES = {
  'not-an-object': 'That file isn’t a SyncCanvas document.',
  'wrong-format': 'That file isn’t a SyncCanvas document.',
  'unsupported-version': 'This document was made by an incompatible version of SyncCanvas.',
  'invalid-metadata': 'The document’s metadata is invalid.',
  'invalid-objects': 'The document’s drawing data is invalid.',
  'too-many-objects': 'That document has too many objects to import.',
  'invalid-object': 'The document contains invalid drawing data.',
  // The drawing itself still imports even when this is the failure — see
  // handleImportFile's history warning toast, separate from this hard-rejection path.
  'invalid-history': 'The document’s history data is invalid.',
  'parse-error': 'That file isn’t valid JSON.',
  'too-large': 'That file is too large to import.',
};

/** A conservative cap on raw file bytes before we even attempt to parse — keeps a huge
 *  or hostile file from freezing the tab on JSON.parse. */
export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024; // 25MB

/**
 * Reads and validates a File as a SyncCanvas document. Never partially applies anything —
 * the caller only gets a document once it's fully validated, or an error otherwise.
 * @returns {Promise<{ok: true, document: object} | {ok: false, error: string}>}
 */
export async function readDocumentFile(file) {
  if (file.size > MAX_IMPORT_FILE_BYTES) return { ok: false, error: 'too-large' };
  let text;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: 'parse-error' };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'parse-error' };
  }
  const result = validateDocument(raw);
  if (!result.ok && result.error === 'invalid-history') {
    // The drawing itself can still be perfectly valid even when its optional Phase 9
    // history companion isn't — never let a corrupt/foreign history block reject an
    // otherwise-good file. Strip it and retry, mirroring how the server treats it too
    // (handlers.js's IMPORT_DOCUMENT: bad history just means history isn't imported).
    const withoutHistory = { ...raw };
    delete withoutHistory.history;
    return validateDocument(withoutHistory);
  }
  return result;
}
