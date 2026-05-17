/**
 * utils/rate-limiter.js
 * ─────────────────────────────────────────────────────────────────
 * Client-side rate limiting for Supabase writes and sync operations.
 *
 * WHY: The offline queue flush can trigger dozens of Supabase writes
 *   in rapid succession when coming back online. Supabase has rate
 *   limits and excessive writes can cause 429 errors. Also, the sync
 *   function can be called repeatedly during reconnect events.
 *
 * RISK LEVEL: Low — only adds throttling on top of existing operations.
 * BACKWARD COMPATIBLE: Yes — all operations still complete, just throttled.
 *
 * IMPACT: Prevents 429 rate-limit errors, smoother reconnect sync,
 *   better UX during bulk operations.
 */

/**
 * Throttle: only allow fn to be called once per `ms` milliseconds.
 * Returns the last call's result for calls within the throttle window.
 *
 * @param {Function} fn
 * @param {number} ms
 */
export function throttle(fn, ms) {
  let lastCall = 0;
  let lastResult;
  return async function (...args) {
    const now = Date.now();
    if (now - lastCall >= ms) {
      lastCall = now;
      lastResult = await fn.apply(this, args);
    }
    return lastResult;
  };
}

/**
 * Sequential batch processor — processes an array of items with
 * a delay between each to avoid rate limiting.
 *
 * @param {Array} items — items to process
 * @param {Function} fn — async function(item) => result
 * @param {object} opts — { delayMs: number, onProgress: fn }
 * @returns {{ ok: number, fail: number, errors: Array }}
 */
export async function batchProcess(items, fn, { delayMs = 50, onProgress } = {}) {
  let ok = 0, fail = 0;
  const errors = [];

  for (let i = 0; i < items.length; i++) {
    try {
      await fn(items[i]);
      ok++;
    } catch (err) {
      fail++;
      errors.push({ item: items[i], error: err });
    }
    onProgress?.(i + 1, items.length);
    // Yield to event loop + add delay between requests
    if (i < items.length - 1 && delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  return { ok, fail, errors };
}

/**
 * Retry with exponential backoff.
 * Useful for transient network errors or 429 rate limit responses.
 *
 * @param {Function} fn — async function to retry
 * @param {object} opts — { maxRetries, baseDelayMs, maxDelayMs }
 */
export async function withRetry(fn, { maxRetries = 3, baseDelayMs = 300, maxDelayMs = 5000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries) break;
      // Exponential backoff: 300ms, 600ms, 1200ms, capped at maxDelayMs
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
