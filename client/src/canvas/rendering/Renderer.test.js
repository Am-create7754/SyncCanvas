import { describe, it, expect } from 'vitest';
import { isSingleSelectionLockedByOther } from './Renderer.js';

describe('isSingleSelectionLockedByOther (Phase 10 fix pass regression — hides local resize handles)', () => {
  it('is false when nothing is selected', () => {
    expect(isSingleSelectionLockedByOther(new Set(), new Map(), new Set())).toBe(false);
  });

  it('is false when more than one object is selected', () => {
    const selected = new Set(['a', 'b']);
    const locks = new Map([['a', { userId: 'arpan' }]]);
    expect(isSingleSelectionLockedByOther(selected, locks, new Set())).toBe(false);
  });

  it('is false for a single selection that is not locked at all', () => {
    expect(isSingleSelectionLockedByOther(new Set(['a']), new Map(), new Set())).toBe(false);
  });

  it('is false when the single selection is locked by US (own lock shows the subtle local indicator instead)', () => {
    const locks = new Map([['a', { userId: 'amber' }]]);
    const myLockedIds = new Set(['a']);
    expect(isSingleSelectionLockedByOther(new Set(['a']), locks, myLockedIds)).toBe(false);
  });

  it('is true when the single selection is locked by someone else — this is what must hide local resize handles', () => {
    const locks = new Map([['a', { userId: 'arpan' }]]);
    expect(isSingleSelectionLockedByOther(new Set(['a']), locks, new Set())).toBe(true);
  });

  it('tolerates undefined maps (e.g. Replay Mode, where remoteLocks/myLockedIds are nulled out)', () => {
    expect(isSingleSelectionLockedByOther(new Set(['a']), undefined, undefined)).toBe(false);
  });
});
