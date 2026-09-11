import { create } from '../utils/store.js';

/**
 * Phase 10: the one piece of lock-related state that genuinely needs top-level React
 * reactivity rather than living on the engine (see CanvasEngine.remoteLocks/myLockedIds,
 * which cover everything rendering-related — presence-style ephemeral state kept the
 * same way remoteCursors/remoteSelections already are). An incoming "X wants to edit Y"
 * control request is a transient overlay notification, not a canvas concern.
 */
export const useLockStore = create((set) => ({
  /** @type {{objectId:string, requesterId:string, requesterName:string}|null} */
  incomingRequest: null,
  setIncomingRequest: (request) => set({ incomingRequest: request }),
  clearIncomingRequest: () => set({ incomingRequest: null }),
}));
