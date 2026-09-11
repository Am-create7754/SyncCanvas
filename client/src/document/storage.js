import { validateDocument } from './documentFormat.js';
import { logger } from '../utils/logger.js';

const AUTOSAVE_PREFIX = 'synccanvas:autosave:';
const SNAPSHOTS_KEY = 'synccanvas:snapshots';
const MAX_SNAPSHOTS = 8;

/**
 * All localStorage access for documents funnels through here, wrapped in try/catch —
 * quota-exceeded, disabled storage (private browsing), and hand-edited/corrupt JSON are
 * all real conditions a browser can hand back, and none of them should ever crash the
 * app or block collaboration. Every function degrades to "do nothing, report failure".
 */

function safeRead(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn(`localStorage read failed for ${key}`, err);
    return null;
  }
}

function safeWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    logger.warn(`localStorage write failed for ${key}`, err);
    return false;
  }
}

// ---- autosave (room-scoped — see docs/ENGINEERING_DECISIONS.md "why room-scoped autosave") ----

export function saveAutosave(roomId, document_) {
  return safeWrite(AUTOSAVE_PREFIX + roomId, document_);
}

/** Returns the autosaved document for this room only if it's still valid — a hand-edited
 *  or version-stale blob is treated as if it didn't exist, never partially trusted. */
export function readAutosave(roomId) {
  const raw = safeRead(AUTOSAVE_PREFIX + roomId);
  if (!raw) return null;
  const result = validateDocument(raw);
  return result.ok ? result.document : null;
}

export function clearAutosave(roomId) {
  try {
    localStorage.removeItem(AUTOSAVE_PREFIX + roomId);
  } catch {
    // nothing meaningful to do if even removal fails
  }
}

// ---- manual snapshots (global to the browser, not room-scoped) ----

export function listSnapshots() {
  const raw = safeRead(SNAPSHOTS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((s) => s && typeof s.id === 'string' && validateDocument(s.document).ok);
}

export function saveSnapshot(name, document_) {
  const snapshots = listSnapshots();
  const entry = {
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: (name || '').trim().slice(0, 60) || `Snapshot — ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
    createdAt: Date.now(),
    document: document_,
  };
  const next = [entry, ...snapshots].slice(0, MAX_SNAPSHOTS);
  const wrote = safeWrite(SNAPSHOTS_KEY, next);
  return wrote ? entry : null;
}

export function deleteSnapshot(id) {
  const next = listSnapshots().filter((s) => s.id !== id);
  return safeWrite(SNAPSHOTS_KEY, next);
}

export function getSnapshot(id) {
  return listSnapshots().find((s) => s.id === id) ?? null;
}
