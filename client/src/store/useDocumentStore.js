import { create } from '../utils/store.js';

/**
 * LOCAL state for document portability (Phase 7): the document's display name, autosave
 * status, the list of local snapshots, and a pending crash-recovery offer. None of this
 * is collaborative state — it's this browser's own view of "what can I export/recover",
 * distinct from the room's actual persistent objects (which live in CanvasEngine).
 */
export const useDocumentStore = create((set) => ({
  documentName: 'Untitled Canvas',
  autosaveStatus: 'idle', // 'idle' | 'saving' | 'saved' | 'unavailable'
  snapshots: [],
  pendingRecovery: null, // { document } | null — offered when a room joins empty but local autosave has content

  setDocumentName: (documentName) => set({ documentName }),
  setAutosaveStatus: (autosaveStatus) => set({ autosaveStatus }),
  setSnapshots: (snapshots) => set({ snapshots }),
  setPendingRecovery: (pendingRecovery) => set({ pendingRecovery }),
}));
