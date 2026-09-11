import { serializeDocument } from './documentFormat.js';
import { saveAutosave } from './storage.js';
import { useDocumentStore } from '../store/useDocumentStore.js';

const DEBOUNCE_MS = 800;
const SAVED_LABEL_MS = 2000;

/**
 * Vanilla JS replacement for the old `useAutosave` React hook (Phase 13A migration).
 * Debounced local autosave, triggered only on the engine's 'object-count-change' and
 * 'object-style-change' events — the two events that already, by construction, fire
 * exclusively for PERSISTENT changes (a finished stroke/shape, a deletion, a clear, a
 * style edit, an import, or an undo/redo of any of those). Cursor/laser/viewport
 * movement never dispatch either event, so this doesn't need its own filtering logic to
 * keep ephemeral traffic out of localStorage — it's excluded for free.
 * `getDocumentName` is a function (not a static string) so a rename mid-session is
 * always reflected in the next save without needing to re-bind this.
 * @returns {() => void} stop — call on room teardown
 */
export function startAutosave(engine, roomId, getDocumentName) {
  const setStatus = useDocumentStore.getState().setAutosaveStatus;
  let timer = null;
  let savedLabelTimer = null;

  const scheduleSave = () => {
    setStatus('saving');
    clearTimeout(timer);
    timer = setTimeout(() => {
      const doc = serializeDocument(engine.objects, { name: getDocumentName() });
      const wrote = saveAutosave(roomId, doc);
      setStatus(wrote ? 'saved' : 'unavailable');
      if (wrote) {
        clearTimeout(savedLabelTimer);
        savedLabelTimer = setTimeout(() => setStatus('idle'), SAVED_LABEL_MS);
      }
    }, DEBOUNCE_MS);
  };

  engine.addEventListener('object-count-change', scheduleSave);
  engine.addEventListener('object-style-change', scheduleSave);

  return () => {
    engine.removeEventListener('object-count-change', scheduleSave);
    engine.removeEventListener('object-style-change', scheduleSave);
    clearTimeout(timer);
    clearTimeout(savedLabelTimer);
  };
}
