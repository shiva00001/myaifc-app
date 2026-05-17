/**
 * utils/logger.js
 * ─────────────────────────────────────────────────────────────────
 * Centralised logger with environment-aware log levels.
 *
 * WHY: console.* calls are scattered across the codebase.
 *   In production builds Terser drops them via pure_funcs, but in
 *   dev they create noise and have no structured context.
 *   A logger also lets us add remote error reporting (Sentry etc.)
 *   in a single place later without touching every call site.
 *
 * RISK LEVEL: None — purely additive, no existing code changed.
 * BACKWARD COMPATIBLE: Yes. Existing console.* calls still work.
 *
 * Usage:
 *   import { log } from '../utils/logger.js';
 *   log.info('Sync complete', { count: 42 });
 *   log.warn('Column missing', { col: 'payment_side' });
 *   log.error('Insert failed', err);
 */

const IS_DEV = import.meta.env?.DEV ?? true;

// Log levels: 0=silent, 1=error, 2=warn, 3=info, 4=debug
const LEVEL = IS_DEV ? 4 : 1;

function _fmt(tag, msg, data) {
  const ts = new Date().toTimeString().slice(0, 8);
  return data !== undefined
    ? [`[AIFC ${ts}] ${tag} ${msg}`, data]
    : [`[AIFC ${ts}] ${tag} ${msg}`];
}

export const log = {
  debug : (msg, data) => LEVEL >= 4 && console.debug(..._fmt('🔍', msg, data)),
  info  : (msg, data) => LEVEL >= 3 && console.info( ..._fmt('ℹ️', msg, data)),
  warn  : (msg, data) => LEVEL >= 2 && console.warn( ..._fmt('⚠️', msg, data)),
  error : (msg, data) => LEVEL >= 1 && console.error(..._fmt('❌', msg, data)),

  /**
   * Time a promise and log duration.
   * Example: const result = await log.time('syncFromSupabase', fetchFn());
   */
  async time(label, promise) {
    const t0 = performance.now();
    try {
      const result = await promise;
      const ms = (performance.now() - t0).toFixed(1);
      log.debug(`${label} completed in ${ms}ms`);
      return result;
    } catch (err) {
      const ms = (performance.now() - t0).toFixed(1);
      log.error(`${label} failed after ${ms}ms`, err);
      throw err;
    }
  },
};
