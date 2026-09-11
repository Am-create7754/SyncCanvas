import { create } from '../utils/store.js';

const STORAGE_KEY = 'synccanvas:theme';

function applyThemeClass(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

function getInitialTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const initialTheme = getInitialTheme();
if (typeof document !== 'undefined') applyThemeClass(initialTheme);

/**
 * Theme is pure LOCAL USER STATE (per the Phase 5 state-category rules): it lives only
 * in this browser, is never sent to the server, and Follow Mode must never touch it —
 * following someone's viewport should not follow their color scheme.
 */
export const useThemeStore = create((set, get) => ({
  theme: initialTheme,
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyThemeClass(next);
    set({ theme: next });
  },
}));
