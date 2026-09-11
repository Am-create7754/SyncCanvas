import { create } from '../utils/store.js';

let nextId = 0;

export const useToastStore = create((set) => ({
  toasts: [],
  push: (message, tone = 'default') => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2600);
  },
}));
