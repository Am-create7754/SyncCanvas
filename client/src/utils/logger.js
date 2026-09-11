const DEBUG = import.meta.env.DEV;

/** Thin console wrapper so debug noise is automatically stripped from production builds
 *  without scattering `if (import.meta.env.DEV)` checks through the app. */
export const logger = {
  debug: (...args) => { if (DEBUG) console.log('[debug]', ...args); },
  warn: (...args) => console.warn('[warn]', ...args),
  error: (...args) => console.error('[error]', ...args),
};
