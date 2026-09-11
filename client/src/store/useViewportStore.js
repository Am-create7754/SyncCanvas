import { create } from '../utils/store.js';

/** Last-known viewport per collaborator (userId -> {x,y,scale}), populated from incoming
 *  viewport-update broadcasts. Purely a cache for "snap to their view the instant I click
 *  Follow" — never persisted, never sent anywhere itself. */
export const useViewportStore = create((set) => ({
  viewports: new Map(),
  setViewport: (userId, viewport) => set((s) => ({ viewports: new Map(s.viewports).set(userId, viewport) })),
  clearViewport: (userId) => set((s) => {
    const next = new Map(s.viewports);
    next.delete(userId);
    return { viewports: next };
  }),
}));
