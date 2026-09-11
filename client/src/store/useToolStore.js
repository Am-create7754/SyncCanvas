import { create } from '../utils/store.js';

/** Quick color palette (final polish phase item 5) — a useful set of common colors,
 *  reused identically for stroke, fill, AND text color pickers (one palette, three
 *  purposes) so "which colors are quickly available" never has to be learned three times.
 *  Custom colors are always additionally available via each picker's native `<input
 *  type="color">`. */
export const QUICK_COLORS = [
  { name: 'Black', hex: '#111827' },
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Red', hex: '#EF4444' },
  { name: 'Orange', hex: '#F97316' },
  { name: 'Yellow', hex: '#EAB308' },
  { name: 'Green', hex: '#22C55E' },
  { name: 'Blue', hex: '#3B82F6' },
  { name: 'Purple', hex: '#A855F7' },
  { name: 'Pink', hex: '#EC4899' },
  { name: 'Gray', hex: '#6B7280' },
];
export const DEFAULT_COLORS = QUICK_COLORS.map((c) => c.hex);
export const FILL_COLORS = DEFAULT_COLORS; // same quick palette, reused for the fill picker too

const PREFS_KEY = 'synccanvas:toolPrefs';
/** Which fields are LOCAL, worth remembering across sessions (QoL: "remember local UI
 *  preferences where appropriate") — deliberately excludes `tool` itself, so every room
 *  visit starts from a predictable, neutral tool rather than wherever you left off. */
const PERSISTED_KEYS = [
  'color', 'strokeWidth', 'fillEnabled', 'fillColor', 'fillOpacity',
  'textFontSize', 'textFontFamily', 'textBold', 'textItalic', 'textUnderline', 'textAlign', 'textColor',
];

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePrefs(state) {
  try {
    const prefs = {};
    for (const key of PERSISTED_KEYS) prefs[key] = state[key];
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable (private browsing, quota) — preferences just won't persist.
  }
}

const savedPrefs = loadPrefs();

/**
 * Tool selection, stroke style, fill style, and text-formatting defaults are all LOCAL
 * STATE (per the Phase 5/6 state-category rules) — they're this browser's defaults for
 * the *next* object it creates. None of it is sent anywhere by itself; it only becomes
 * shared/persistent state at the moment it's baked into an actual object (see
 * CanvasEngine's pointerdown handler / createTextObject).
 */
export const useToolStore = create((set) => ({
  tool: 'path',
  color: DEFAULT_COLORS[0],
  strokeWidth: 4,
  fillEnabled: false,
  fillColor: FILL_COLORS[0],
  fillOpacity: 1,

  // ---- Final polish phase: "next text object" formatting defaults ----
  textFontSize: 16,
  textFontFamily: 'sans-serif',
  textBold: false,
  textItalic: false,
  textUnderline: false,
  textAlign: 'left',
  textColor: '#1F2937',

  ...savedPrefs,

  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setStrokeWidth: (strokeWidth) => set({ strokeWidth }),
  setFillEnabled: (fillEnabled) => set({ fillEnabled }),
  setFillColor: (fillColor) => set({ fillColor }),
  setFillOpacity: (fillOpacity) => set({ fillOpacity }),

  setTextFontSize: (textFontSize) => set({ textFontSize }),
  setTextFontFamily: (textFontFamily) => set({ textFontFamily }),
  setTextBold: (textBold) => set({ textBold }),
  setTextItalic: (textItalic) => set({ textItalic }),
  setTextUnderline: (textUnderline) => set({ textUnderline }),
  setTextAlign: (textAlign) => set({ textAlign }),
  setTextColor: (textColor) => set({ textColor }),
}));

useToolStore.subscribe(savePrefs);
