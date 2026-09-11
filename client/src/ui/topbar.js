import { h, setChildren } from './dom.js';
import { usePresenceStore } from '../store/usePresenceStore.js';
import { useFollowStore } from '../store/useFollowStore.js';
import { useConnectionStore } from '../store/useConnectionStore.js';
import { useThemeStore } from '../store/useThemeStore.js';
import { useDocumentStore } from '../store/useDocumentStore.js';

function initials(name) {
  return (name ?? '?').trim().slice(0, 2).toUpperCase();
}

const STATUS_META = {
  connected: { label: 'Connected', dot: 'bg-emerald-500' },
  connecting: { label: 'Connecting…', dot: 'bg-amber-400 animate-pulse' },
  reconnecting: { label: 'Reconnecting…', dot: 'bg-amber-400 animate-pulse' },
  disconnected: { label: 'Offline', dot: 'bg-red-500' },
};

/** Presence avatars + a dropdown listing every collaborator with a Follow toggle
 *  (Priority A: online-user list with stable colors; reuses Phase 5 Follow User). */
function buildPresenceList(onFollow) {
  const avatars = h('div', { class: 'flex -space-x-2' });
  const countLabel = h('span', { class: 'hidden text-xs font-medium text-gray-500 sm:inline dark:text-gray-400' });
  const dropdown = h('div', {
    class: 'absolute right-0 top-full z-40 mt-2 hidden w-56 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-800 dark:bg-gray-900',
  });
  const toggleBtn = h('button', {
    type: 'button', class: 'flex items-center gap-2 rounded-full p-0.5 pr-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800',
    onclick: () => dropdown.classList.toggle('hidden'),
  }, [avatars, countLabel]);
  const root = h('div', { class: 'relative shrink-0' }, [toggleBtn, dropdown]);

  document.addEventListener('mousedown', (e) => {
    if (!root.contains(e.target)) dropdown.classList.add('hidden');
  });

  const render = () => {
    const { users, selfId } = usePresenceStore.getState();
    const { followingUserId } = useFollowStore.getState();
    const list = [...users.values()];

    setChildren(avatars, [
      ...list.slice(0, 6).map((u) => h('div', {
        title: u.id === selfId ? `${u.username} (you)` : u.username,
        class: 'flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold text-white shadow-sm sm:h-8 sm:w-8 sm:text-xs dark:border-gray-900',
        style: { backgroundColor: u.color },
      }, initials(u.username))),
      ...(list.length > 6 ? [h('div', {
        class: 'flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-gray-400 text-[11px] font-semibold text-white shadow-sm sm:h-8 sm:w-8 sm:text-xs dark:border-gray-900',
      }, `+${list.length - 6}`)] : []),
    ]);
    countLabel.textContent = `${list.length} online`;
    toggleBtn.setAttribute('aria-label', `Collaborators: ${list.length} online`);

    setChildren(dropdown, [
      h('div', { class: 'mb-1 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500' }, 'Collaborators'),
      ...list.map((u) => {
        const isSelf = u.id === selfId;
        const isFollowing = followingUserId === u.id;
        return h('div', { class: 'flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800' }, [
          h('span', { class: 'h-2.5 w-2.5 shrink-0 rounded-full', style: { backgroundColor: u.color } }),
          h('span', { class: 'min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200' }, `${u.username}${isSelf ? ' (you)' : ''}`),
          !isSelf && h('button', {
            type: 'button',
            title: isFollowing ? `Stop following ${u.username}` : `Follow ${u.username}'s viewport`,
            class: `flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold transition-colors ${
              isFollowing ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-200 dark:text-gray-500 dark:hover:bg-gray-700'
            }`,
            onclick: () => onFollow(u.id, u.username),
          }, isFollowing ? '◎ Following' : '◎ Follow'),
        ]);
      }),
    ]);
  };

  render();
  const unsub1 = usePresenceStore.subscribe(render);
  const unsub2 = useFollowStore.subscribe(render);
  return { el: root, destroy: () => { unsub1(); unsub2(); } };
}

function buildConnectionStatus() {
  const dot = h('span', { class: 'h-2 w-2 rounded-full' });
  const label = h('span', { class: 'hidden sm:inline' });
  const el = h('div', {
    role: 'status',
    class: 'flex shrink-0 items-center gap-1.5 rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 sm:px-3 dark:bg-gray-800 dark:text-gray-300',
  }, [dot, label]);

  const render = ({ status }) => {
    const meta = STATUS_META[status] ?? STATUS_META.disconnected;
    dot.className = `h-2 w-2 rounded-full ${meta.dot}`;
    label.textContent = meta.label;
    el.setAttribute('aria-label', `Connection status: ${meta.label}`);
  };
  render(useConnectionStore.getState());
  const unsub = useConnectionStore.subscribe(render);
  return { el, destroy: unsub };
}

function buildAutosaveIndicator() {
  const el = h('span', { class: 'hidden shrink-0 text-xs text-gray-400 sm:inline dark:text-gray-500' });
  const LABELS = { saving: 'Saving…', saved: 'Saved locally ✓', unavailable: 'Autosave unavailable', idle: '' };
  const render = ({ autosaveStatus }) => { el.textContent = LABELS[autosaveStatus] ?? ''; };
  render(useDocumentStore.getState());
  const unsub = useDocumentStore.subscribe(render);
  return { el, destroy: unsub };
}

function buildDocumentNameField() {
  const input = h('input', {
    value: useDocumentStore.getState().documentName, maxlength: 60, 'aria-label': 'Document name',
    class: 'w-28 shrink-0 truncate rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-gray-700 hover:border-gray-200 focus:border-indigo-400 focus:outline-none sm:w-40 dark:text-gray-200 dark:hover:border-gray-700',
  });
  input.addEventListener('change', () => useDocumentStore.getState().setDocumentName(input.value.trim() || 'Untitled Canvas'));
  const unsub = useDocumentStore.subscribe(({ documentName }) => {
    if (document.activeElement !== input) input.value = documentName;
  });
  return { el: input, destroy: unsub };
}

/**
 * Builds the top bar (Priority A: online-user list/colors, reconnect status, undo/redo;
 * Priority B: dark mode, JSON save/load via the file menu, document name) — vanilla
 * equivalent of TopBar.jsx + the components it composed.
 * @returns {{el:HTMLElement, destroy:Function}}
 */
export function buildTopBar({ roomId, onFollow, onUndo, onRedo, onExportJson, onImportFile, onExportPng, onOpenHelp }) {
  const presence = buildPresenceList(onFollow);
  const connection = buildConnectionStatus();
  const autosave = buildAutosaveIndicator();
  const docName = buildDocumentNameField();

  const themeBtn = h('button', {
    type: 'button', class: 'rounded-lg px-2.5 py-1.5 text-sm font-semibold text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
    title: 'Toggle dark mode',
    onclick: () => useThemeStore.getState().toggleTheme(),
  }, useThemeStore.getState().theme === 'dark' ? '☀️' : '🌙');
  const unsubTheme = useThemeStore.subscribe(({ theme }) => { themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙'; });

  const undoBtn = h('button', {
    type: 'button', title: 'Undo (Ctrl+Z)', class: 'rounded-lg px-2.5 py-1.5 text-sm font-semibold text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800',
    onclick: onUndo,
  }, '↶');
  const redoBtn = h('button', {
    type: 'button', title: 'Redo (Ctrl+Shift+Z)', class: 'rounded-lg px-2.5 py-1.5 text-sm font-semibold text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800',
    onclick: onRedo,
  }, '↷');

  const importInput = h('input', { type: 'file', accept: '.json', class: 'hidden' });
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (file) onImportFile(file);
    importInput.value = '';
  });

  const fileMenuBtn = h('button', {
    type: 'button', class: 'rounded-lg px-2.5 py-1.5 text-sm font-semibold text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800', title: 'Export SyncCanvas file',
    onclick: onExportJson,
  }, '↓ Export');
  const pngBtn = h('button', {
    type: 'button', class: 'hidden rounded-lg px-2.5 py-1.5 text-sm font-semibold text-gray-500 hover:bg-gray-100 sm:inline-block dark:text-gray-400 dark:hover:bg-gray-800', title: 'Export PNG',
    onclick: onExportPng,
  }, '🖼');
  const importBtn = h('button', {
    type: 'button', class: 'rounded-lg px-2.5 py-1.5 text-sm font-semibold text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800', title: 'Import SyncCanvas file',
    onclick: () => importInput.click(),
  }, '↑ Import');
  const helpBtn = h('button', {
    type: 'button', class: 'flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800', title: 'Help / Instructions',
    'aria-label': 'Help and instructions', onclick: onOpenHelp,
  }, '?');

  const el = h('header', {
    class: 'flex min-h-14 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-gray-200 bg-white px-3 py-2 sm:h-14 sm:flex-nowrap sm:py-0 sm:px-4 dark:border-gray-800 dark:bg-gray-900',
  }, [
    h('div', { class: 'flex min-w-0 items-center gap-2 sm:gap-3' }, [
      h('span', { class: 'shrink-0 text-base font-bold tracking-tight text-gray-900 dark:text-white' }, 'SyncCanvas'),
      h('span', { class: 'hidden shrink-0 rounded-md bg-gray-100 px-2 py-1 font-mono text-xs font-semibold text-gray-500 sm:inline-block dark:bg-gray-800 dark:text-gray-400' }, `Room: ${roomId}`),
      docName.el,
      autosave.el,
      connection.el,
    ]),
    h('div', { class: 'flex shrink-0 items-center gap-1 sm:gap-2' }, [
      presence.el, importInput, importBtn, fileMenuBtn, pngBtn, undoBtn, redoBtn, themeBtn, helpBtn,
    ]),
  ]);

  return {
    el,
    setUndoRedoEnabled: (u, r) => { undoBtn.disabled = !u; redoBtn.disabled = !r; },
    destroy: () => { presence.destroy(); connection.destroy(); autosave.destroy(); docName.destroy(); unsubTheme(); },
  };
}
