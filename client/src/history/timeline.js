import { reconstructAt } from '@synccanvas/shared';

/** Longest visual pause replay will ever sit on one gap between operations (Phase 9 #17)
 *  — a 44-minute real gap between 10:01 and 10:45 becomes at most this many ms, scaled by
 *  playback speed like every other step. */
export const MAX_IDLE_MS = 1500;

/**
 * Computes the delay (ms, BEFORE scaling by playback speed) to wait before showing each
 * operation, derived from the actual recorded timestamps — not a fixed frame rate — with
 * long idle gaps capped so replay never appears to "hang" (#17).
 * @param {Array<{timestamp:number}>} operations
 * @returns {number[]} parallel array of delays
 */
export function computeStepDelays(operations) {
  const delays = [];
  for (let i = 0; i < operations.length; i++) {
    if (i === 0) { delays.push(0); continue; }
    const raw = operations[i].timestamp - operations[i - 1].timestamp;
    delays.push(Math.max(0, Math.min(raw, MAX_IDLE_MS)));
  }
  return delays;
}

/**
 * A small bounded LRU-ish cache over `reconstructAt` (Phase 9 #21/#47) — scrubbing back
 * and forth over the same handful of sequences (dragging the playhead, hovering activity
 * items) becomes O(1) instead of re-walking the operation log every tick. Never grows
 * unbounded, and is trivially invalidated whenever the underlying log changes (e.g. a new
 * live operation arrives).
 */
export class ReconstructionCache {
  constructor(history, maxEntries = 40) {
    this.history = history;
    this.maxEntries = maxEntries;
    this.cache = new Map();
  }

  get(sequence) {
    if (this.cache.has(sequence)) {
      const value = this.cache.get(sequence);
      this.cache.delete(sequence);
      this.cache.set(sequence, value); // touch: keep it "recently used"
      return value;
    }
    const result = reconstructAt(this.history, sequence);
    this.cache.set(sequence, result);
    if (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value);
    return result;
  }
}
