import { create } from '../utils/store.js';
import { ReconstructionCache } from '../history/timeline.js';

/**
 * Phase 9 — the room's persistent operation log (fetched from the server via GET_HISTORY)
 * plus all the LOCAL, per-viewer Replay/Timeline UI state layered on top of it. The log
 * itself is shared/collaborative in origin, but nothing in here is ever written back to
 * the server except through the explicit RESTORE_VERSION/CREATE_CHECKPOINT requests —
 * this store is a read-side cache, never a second source of truth for the document.
 *
 * `isReplaying` (Time Travel is active — CanvasEngine.historicalPreview is set) is a
 * DIFFERENT thing from `panelOpen` (the Timeline panel is visible) — you can have the
 * panel open while still viewing the live canvas (e.g. just glancing at the Activity
 * Feed), and entering replay always implies the panel is open but not vice versa.
 */
export const useHistoryStore = create((set, get) => ({
  // ---- fetched log (refreshed on panel-open and on "Return to Live") ----
  loaded: false,
  operations: [],
  baseSequence: 0,
  baseSnapshot: [],
  namedCheckpoints: [],
  latestSequence: 0,
  _cache: null,

  // ---- local UI state ----
  panelOpen: false,
  isReplaying: false,
  currentSequence: 0,
  isPlaying: false,
  speed: 1,
  liveChangesCount: 0,
  checkpointDialogOpen: false,
  restoreConfirmOpen: false,

  setHistory: (history) => set({
    loaded: true,
    operations: history.operations,
    baseSequence: history.baseSequence,
    baseSnapshot: history.baseSnapshot,
    namedCheckpoints: history.namedCheckpoints,
    latestSequence: history.latestSequence,
    currentSequence: history.latestSequence,
    _cache: new ReconstructionCache(history, 40),
  }),

  addCheckpoint: (checkpoint) => set((s) => (
    s.namedCheckpoints.some((c) => c.id === checkpoint.id) ? s : { namedCheckpoints: [...s.namedCheckpoints, checkpoint] }
  )),

  /** @returns {object[]} the document reconstructed at `sequence`, using the bounded cache. */
  reconstructAt: (sequence) => {
    const { _cache } = get();
    return _cache ? _cache.get(sequence) : [];
  },

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false, isPlaying: false }),

  enterReplay: (sequence) => set({ isReplaying: true, panelOpen: true, currentSequence: sequence, liveChangesCount: 0 }),
  exitReplay: () => set({ isReplaying: false, isPlaying: false, liveChangesCount: 0 }),

  setCurrentSequence: (sequence) => set({ currentSequence: sequence }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setSpeed: (speed) => set({ speed }),

  /** Called by RoomConnection.onLiveChange whenever a persistent live-document event
   *  arrives while replaying — never while just live (no point counting what you're
   *  already looking at). */
  noteLiveChange: () => { if (get().isReplaying) set((s) => ({ liveChangesCount: s.liveChangesCount + 1 })); },

  openCheckpointDialog: () => set({ panelOpen: true, checkpointDialogOpen: true }),
  closeCheckpointDialog: () => set({ checkpointDialogOpen: false }),
  openRestoreConfirm: () => set({ restoreConfirmOpen: true }),
  closeRestoreConfirm: () => set({ restoreConfirmOpen: false }),
}));
