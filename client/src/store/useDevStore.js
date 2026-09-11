import { create } from '../utils/store.js';

/** Developer/R&D tooling state: Performance HUD visibility + the network latency
 *  simulator. Kept separate from app state so toggling dev tools never touches the
 *  collaboration path itself — only RoomConnection reads `simulatedLatencyMs` at the
 *  moment it sends something. */
export const useDevStore = create((set) => ({
  hudOpen: false,
  toggleHud: () => set((s) => ({ hudOpen: !s.hudOpen })),
  closeHud: () => set({ hudOpen: false }),

  simulatedLatencyMs: 0,
  setSimulatedLatency: (ms) => set({ simulatedLatencyMs: ms }),
}));
