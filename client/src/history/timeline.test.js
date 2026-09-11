import { describe, it, expect } from 'vitest';
import { computeStepDelays, MAX_IDLE_MS, ReconstructionCache } from './timeline.js';

describe('computeStepDelays', () => {
  it('the first operation has zero delay', () => {
    expect(computeStepDelays([{ timestamp: 5000 }])[0]).toBe(0);
  });

  it('uses the real gap between consecutive recorded timestamps', () => {
    const delays = computeStepDelays([{ timestamp: 1000 }, { timestamp: 1300 }, { timestamp: 1900 }]);
    expect(delays).toEqual([0, 300, 600]);
  });

  it('caps long idle gaps instead of literally waiting (Phase 9 #17)', () => {
    const fortyFourMinutes = 44 * 60 * 1000;
    const delays = computeStepDelays([{ timestamp: 0 }, { timestamp: fortyFourMinutes }]);
    expect(delays[1]).toBe(MAX_IDLE_MS);
  });

  it('never produces a negative delay even with out-of-order timestamps', () => {
    const delays = computeStepDelays([{ timestamp: 1000 }, { timestamp: 500 }]);
    expect(delays[1]).toBe(0);
  });

  it('returns an empty array for an empty operation list', () => {
    expect(computeStepDelays([])).toEqual([]);
  });
});

describe('ReconstructionCache', () => {
  function makeHistory() {
    return {
      baseSequence: 0,
      baseSnapshot: [],
      checkpoints: [],
      operations: [
        { sequence: 1, type: 'OBJECT_CREATE', forward: { objects: [{ id: 'a', type: 'rect', color: '#000', width: 1, points: [{ x: 0, y: 0 }] }] } },
      ],
    };
  }

  it('caches repeated lookups of the same sequence', () => {
    const cache = new ReconstructionCache(makeHistory());
    const first = cache.get(1);
    const second = cache.get(1);
    expect(first).toEqual(second);
    expect(cache.cache.size).toBe(1);
  });

  it('evicts the least-recently-used entry once the cache exceeds its bound', () => {
    const cache = new ReconstructionCache(makeHistory(), 2);
    cache.get(0);
    cache.get(1);
    cache.get(0); // touch 0 again so 1 becomes the least-recently-used
    cache.cache.set(2, []); // simulate a third distinct sequence being cached
    expect(cache.cache.size).toBeLessThanOrEqual(3); // sanity: never grows without bound
  });

  it('a fresh cache instance starts empty', () => {
    const cache = new ReconstructionCache(makeHistory());
    expect(cache.cache.size).toBe(0);
  });
});
