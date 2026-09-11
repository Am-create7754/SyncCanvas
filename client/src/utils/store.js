/**
 * Phase 13A (vanilla JS migration): a minimal drop-in replacement for zustand's core
 * store API. Every file under `store/` was originally written against zustand's
 * `create((set, get) => ({...}))` and needs ZERO other changes to run on this instead —
 * same initializer signature, same `set(partial | updaterFn)` shallow-merge semantics,
 * same `getState()`/`subscribe(listener)` surface. This is deliberately NOT a UI
 * framework — just a plain observable object, the same pattern you'd hand-write for any
 * vanilla pub/sub state container.
 */
export function create(initializer) {
  let state;
  const listeners = new Set();

  const setState = (partial) => {
    const partialState = typeof partial === 'function' ? partial(state) : partial;
    if (partialState == null) return;
    state = { ...state, ...partialState };
    for (const listener of listeners) listener(state);
  };

  const getState = () => state;

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  state = initializer(setState, getState);
  return { getState, setState, subscribe };
}
