import { create } from '../utils/store.js';

/** Connection lifecycle, kept out of the presence/canvas stores since it changes for
 *  reasons unrelated to room content and drives its own UI (status pill, toasts). */
export const useConnectionStore = create((set) => ({
  status: 'connecting', // 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  latencyMs: null,
  opsSent: 0,
  opsReceived: 0,
  rejectedCount: 0, // Phase 10 — server-rejected updates (stale revision / lock conflict) this session
  setStatus: (status) => set({ status }),
  setLatency: (latencyMs) => set({ latencyMs }),
  incrementSent: () => set((s) => ({ opsSent: s.opsSent + 1 })),
  incrementReceived: () => set((s) => ({ opsReceived: s.opsReceived + 1 })),
  incrementRejected: () => set((s) => ({ rejectedCount: s.rejectedCount + 1 })),
}));
