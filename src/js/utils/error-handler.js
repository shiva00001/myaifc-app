/**
 * utils/error-handler.js
 * ─────────────────────────────────────────────────────────────────
 * Centralised error handling and user-facing error presentation.
 *
 * WHY: Error handling is currently inconsistent:
 *   - Some paths show toast(), some show showAlert(), some are silent
 *   - Supabase error codes are checked in multiple places with copy-paste logic
 *   - Network errors vs validation errors vs DB errors are not distinguished
 *   - No structured error context makes debugging hard in production
 *
 * RISK LEVEL: Low — additive only. Existing error handling unchanged.
 * BACKWARD COMPATIBLE: Yes.
 *
 * IMPACT: Consistent user-facing error messages, structured error
 *   context for future monitoring, single retry/fallback logic.
 */

import { log } from './logger.js';
import { toast } from './helpers.js';
import * as Sentry from '@sentry/browser';

// ── Known Supabase error codes ────────────────────────────────────
export const SB_ERRORS = {
  DUPLICATE_KEY    : '23505',
  FOREIGN_KEY      : '23503',
  NOT_NULL         : '23502',
  CHECK_VIOLATION  : '23514',
  UNAUTHENTICATED  : 'PGRST301',
  FORBIDDEN        : 'PGRST302',
  NOT_FOUND        : 'PGRST116',
};

/**
 * Classify a Supabase error into a user-friendly message.
 * Preserves the original error for logging while showing a clean message.
 *
 * @param {object} error — Supabase error object { message, code, details }
 * @param {string} context — what operation was being performed (for logging)
 * @returns {string} user-friendly message
 */
export function classifySupabaseError(error, context = '') {
  if (!error) return 'An unknown error occurred.';

  log.error(`Supabase error [${context}]`, { code: error.code, message: error.message });

  // Report to Sentry with full context (production only)
  if (import.meta.env.PROD) {
    Sentry.withScope(scope => {
      scope.setTag('context', context);
      scope.setExtra('supabase_code', error.code);
      scope.setExtra('supabase_details', error.details);
      Sentry.captureException(new Error(error.message ?? 'Supabase error'));
    });
  }

  // Known codes → friendly messages
  switch (error.code) {
    case SB_ERRORS.DUPLICATE_KEY:
      return 'This record already exists. Please check the CN No. and try again.';
    case SB_ERRORS.FOREIGN_KEY:
      return 'This record references data that no longer exists.';
    case SB_ERRORS.NOT_NULL:
      return 'A required field is missing. Please fill all required fields.';
    case SB_ERRORS.CHECK_VIOLATION:
      return 'A field value is not allowed. Please check your input.';
    case SB_ERRORS.UNAUTHENTICATED:
      return 'Your session has expired. Please sign in again.';
    case SB_ERRORS.FORBIDDEN:
      return 'You do not have permission to perform this action.';
    case SB_ERRORS.NOT_FOUND:
      return 'The requested record was not found.';
  }

  // Column-specific errors (migration not run)
  if (error.message?.toLowerCase().includes('payment_side')) {
    return 'payment_side column missing — run the DB migration in Settings.';
  }

  // Network / timeout
  if (error.message?.toLowerCase().includes('fetch') ||
      error.message?.toLowerCase().includes('network')) {
    return 'Network error — check your internet connection and try again.';
  }

  // Generic fallback — show Supabase message but truncate if very long
  const msg = error.message || 'Database error';
  return msg.length > 120 ? msg.slice(0, 120) + '…' : msg;
}

/**
 * Handle an async operation with consistent error catching.
 * Shows a toast on failure; returns { ok: true, data } or { ok: false, error }.
 *
 * Example:
 *   const { ok, data } = await safeAsync(
 *     () => supabase.from('entries').insert(payload),
 *     'insertEntry'
 *   );
 *
 * @param {Function} fn — async function to execute
 * @param {string} context — label for logging
 * @param {object} [opts] — { silent: bool, onError: fn }
 */
export async function safeAsync(fn, context, opts = {}) {
  try {
    const result = await fn();
    // Supabase returns { data, error } — normalise both shapes
    if (result && result.error) {
      const msg = classifySupabaseError(result.error, context);
      if (!opts.silent) toast(msg, 'err');
      opts.onError?.(result.error);
      return { ok: false, error: result.error };
    }
    return { ok: true, data: result?.data ?? result };
  } catch (err) {
    log.error(`Unhandled exception in [${context}]`, err);
    const msg = err?.message || 'Unexpected error';
    if (!opts.silent) toast(msg.length > 100 ? msg.slice(0, 100) + '…' : msg, 'err');
    opts.onError?.(err);
    return { ok: false, error: err };
  }
}

/**
 * Global unhandled promise rejection catcher.
 * Call once in main.js to prevent silent failures.
 */
export function installGlobalErrorHandlers() {
  window.addEventListener('unhandledrejection', e => {
    log.error('Unhandled promise rejection', e.reason);
    if (import.meta.env.PROD) Sentry.captureException(e.reason);
  });

  window.addEventListener('error', e => {
    log.error('Uncaught error', { message: e.message, filename: e.filename, line: e.lineno });
    if (import.meta.env.PROD) Sentry.captureException(e.error ?? new Error(e.message));
  });
}
