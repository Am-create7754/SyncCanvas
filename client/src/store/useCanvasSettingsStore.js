import { create } from '../utils/store.js';

export const GRID_SIZES = [8, 16, 32, 64];

/**
 * Phase 11 "smart canvas" preferences — grid visibility/size, snap-to-grid, smart guides,
 * ruler visibility. Every one of these is explicitly LOCAL/per-browser state (spec #33):
 * never synchronized between collaborators, never sent over the socket, never persisted
 * server-side. Amber seeing a grid has no bearing on what Arpan sees. Mirrors the same
 * "Zustand for local UI, engine.set* to bridge into the framework-agnostic CanvasEngine"
 * pattern useToolStore/useThemeStore already established.
 */
export const useCanvasSettingsStore = create((set) => ({
  gridEnabled: false, // spec default: OFF
  gridSize: 16, // spec default: ~16px
  snapToGridEnabled: false,
  smartGuidesEnabled: true,
  rulersEnabled: true,

  toggleGrid: () => set((s) => ({ gridEnabled: !s.gridEnabled })),
  setGridSize: (gridSize) => set({ gridSize }),
  toggleSnapToGrid: () => set((s) => ({ snapToGridEnabled: !s.snapToGridEnabled })),
  toggleSmartGuides: () => set((s) => ({ smartGuidesEnabled: !s.smartGuidesEnabled })),
  toggleRulers: () => set((s) => ({ rulersEnabled: !s.rulersEnabled })),
}));
