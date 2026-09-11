const DEBUG = process.env.DEBUG_SYNCCANVAS === 'true';

export const logger = {
  info: (...args) => console.log('[info]', ...args),
  warn: (...args) => console.warn('[warn]', ...args),
  error: (...args) => console.error('[error]', ...args),
  debug: (...args) => {
    if (DEBUG) console.log('[debug]', ...args);
  },
};
