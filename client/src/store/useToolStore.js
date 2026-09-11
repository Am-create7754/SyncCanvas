import { create } from '../utils/store.js';

export const DEFAULT_COLORS = ['#111827', '#EF4444', '#F59E0B', '#22C55E', '#3B82F6', '#A855F7', '#FFFFFF'];
export const FILL_COLORS = ['#F97316', '#EF4444', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#EC4899'];

/**
 * Tool selection, stroke style, and fill style are all LOCAL STATE (per the Phase 5/6
 * state-category rules) — they're this browser's defaults for the *next* shape it draws.
 * None of it is sent anywhere by itself; it only becomes shared/persistent state at the
 * moment it's baked into an actual object (see CanvasEngine's pointerdown handler).
 */
export const useToolStore = create((set) => ({
  tool: 'path',
  color: DEFAULT_COLORS[0],
  strokeWidth: 4,
  fillEnabled: false,
  fillColor: FILL_COLORS[0],
  fillOpacity: 1,
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setStrokeWidth: (strokeWidth) => set({ strokeWidth }),
  setFillEnabled: (fillEnabled) => set({ fillEnabled }),
  setFillColor: (fillColor) => set({ fillColor }),
  setFillOpacity: (fillOpacity) => set({ fillOpacity }),
}));
