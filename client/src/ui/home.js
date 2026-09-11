import { h } from './dom.js';
import { generateRoomCode } from '../utils/roomCode.js';
import { getSavedUsername, saveUsername } from '../utils/id.js';
import { useThemeStore } from '../store/useThemeStore.js';

/** Builds the landing page (name entry + create/join room) — vanilla equivalent of the
 *  old Home.jsx. `navigate(path)` is the router's push function (see main.js). */
export function renderHome(root, navigate) {
  const nameInput = h('input', {
    id: 'username', value: getSavedUsername(), placeholder: 'e.g. Amber', maxlength: 24,
    class: 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-indigo-500/20',
  });
  const joinInput = h('input', {
    placeholder: 'Room code', maxlength: 10,
    class: 'w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm uppercase tracking-widest focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-indigo-500/20',
  });

  const commitName = () => {
    const trimmed = nameInput.value.trim();
    if (trimmed) saveUsername(trimmed);
  };

  const themeBtn = h('button', {
    type: 'button', class: 'absolute right-4 top-4 rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
    onclick: () => useThemeStore.getState().toggleTheme(),
  }, useThemeStore.getState().theme === 'dark' ? '☀️ Light' : '🌙 Dark');

  const joinForm = h('form', { class: 'flex gap-2' }, [
    joinInput,
    h('button', {
      type: 'submit',
      class: 'flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800',
    }, 'Join'),
  ]);
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    commitName();
    const code = joinInput.value.trim().toUpperCase();
    if (code) navigate(`/room/${code}`);
  });

  const createBtn = h('button', {
    type: 'button',
    class: 'w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700',
    onclick: () => { commitName(); navigate(`/room/${generateRoomCode()}`); },
  }, 'Create Room');

  const card = h('div', { class: 'w-full max-w-sm' }, [
    h('div', { class: 'mb-8 text-center' }, [
      h('div', { class: 'mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-2xl text-white shadow-lg shadow-indigo-200 dark:shadow-indigo-950' }, '✎'),
      h('h1', { class: 'text-2xl font-bold tracking-tight text-gray-900 dark:text-white' }, 'SyncCanvas'),
      h('p', { class: 'mt-1 text-sm text-gray-500 dark:text-gray-400' }, 'Real-time collaborative drawing'),
    ]),
    h('div', { class: 'space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900' }, [
      h('div', {}, [
        h('label', { for: 'username', class: 'mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400' }, 'Your name'),
        nameInput,
      ]),
      createBtn,
      h('div', { class: 'flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500' }, [
        h('div', { class: 'h-px flex-1 bg-gray-200 dark:bg-gray-800' }),
        'or join existing',
        h('div', { class: 'h-px flex-1 bg-gray-200 dark:bg-gray-800' }),
      ]),
      joinForm,
    ]),
  ]);

  root.replaceChildren(h('div', {
    class: 'relative flex h-full w-full items-center justify-center bg-gradient-to-b from-white to-gray-50 px-4 dark:from-gray-950 dark:to-gray-900',
  }, [themeBtn, card]));

  return () => {}; // nothing to tear down
}
