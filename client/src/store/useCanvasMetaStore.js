import { create } from '../utils/store.js';

/** Lightweight mirror of engine state that the UI (zoom %, HUD) needs to read. Updated
 *  from CanvasEngine's CustomEvents, never written to by the engine's hot render path. */
export const useCanvasMetaStore = create((set) => ({
  objectCount: 0,
  zoomPercent: 100,
  fps: 60,
  lockCount: 0, // Phase 10 — mirrors engine.remoteLocks.size, for the Performance HUD
  setObjectCount: (objectCount) => set({ objectCount }),
  setZoomPercent: (zoomPercent) => set({ zoomPercent }),
  setFps: (fps) => set({ fps }),
  setLockCount: (lockCount) => set({ lockCount }),
}));
