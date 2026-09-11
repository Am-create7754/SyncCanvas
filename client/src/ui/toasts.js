import { h } from './dom.js';
import { useToastStore } from '../store/useToastStore.js';

const TONE_CLASS = {
  default: 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900',
  error: 'bg-red-600 text-white',
};

/** Mounts the toast stack (Priority A: error handling / user feedback) into `root` and
 *  keeps it in sync with useToastStore — every `push(message, tone)` call anywhere in
 *  the app (network errors, lock conflicts, export results, ...) shows up here. */
export function mountToastStack(root) {
  const container = h('div', { class: 'pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2' });
  root.append(container);

  const render = (state) => {
    container.replaceChildren(...state.toasts.map((t) => h('div', {
      class: `pointer-events-auto max-w-sm rounded-lg px-4 py-2 text-sm font-medium shadow-lg ${TONE_CLASS[t.tone] ?? TONE_CLASS.default}`,
    }, t.message)));
  };

  render(useToastStore.getState());
  return useToastStore.subscribe(render);
}
