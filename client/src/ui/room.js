import { h } from './dom.js';
import { mountCanvasEngine } from '../canvas/mountEngine.js';
import { RoomConnection } from '../collaboration/RoomConnection.js';
import { startAutosave } from '../document/autosave.js';
import { bindKeyboardShortcuts } from './keyboardShortcuts.js';
import { buildTopBar } from './topbar.js';
import { buildToolbar } from './toolbar.js';
import { mountMiniMap } from './minimap.js';
import { buildPropertiesPanel } from './propertiesPanel.js';
import { mountTextEditor } from './textEditor.js';
import { buildHelpModal } from './helpModal.js';
import { useToolStore } from '../store/useToolStore.js';
import { useThemeStore } from '../store/useThemeStore.js';
import { useCanvasSettingsStore } from '../store/useCanvasSettingsStore.js';
import { usePresenceStore } from '../store/usePresenceStore.js';
import { useFollowStore } from '../store/useFollowStore.js';
import { useViewportStore } from '../store/useViewportStore.js';
import { useDocumentStore } from '../store/useDocumentStore.js';
import { useToastStore } from '../store/useToastStore.js';
import { useCanvasMetaStore } from '../store/useCanvasMetaStore.js';
import { getOrCreateUserId, getSavedUsername, saveUsername } from '../utils/id.js';
import { serializeDocument, readDocumentFile, IMPORT_ERROR_MESSAGES } from '../document/documentFormat.js';
import { readAutosave, clearAutosave } from '../document/storage.js';
import { downloadBlob, slugifyFilename } from '../document/downloadFile.js';
import { exportCanvasAsPng } from '../document/exportPng.js';

const JOIN_ERROR_MESSAGES = {
  'invalid-room-id': 'That room link looks invalid.',
  'room-full': 'This room is full (max 40 people).',
  'internal-error': 'Server hiccup — please try again.',
};

/** A small blocking name-entry gate shown when this browser has no saved username yet —
 *  vanilla equivalent of NameGate.jsx. Resolves once a name is committed. */
function promptForName(root) {
  return new Promise((resolve) => {
    const input = h('input', {
      placeholder: 'e.g. Amber', maxlength: 24,
      class: 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100',
    });
    const form = h('form', { class: 'w-full max-w-xs space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900' }, [
      h('h2', { class: 'text-lg font-bold text-gray-900 dark:text-white' }, 'What should we call you?'),
      input,
      h('button', { type: 'submit', class: 'w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700' }, 'Continue'),
    ]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      saveUsername(name);
      root.replaceChildren();
      resolve(name);
    });
    root.replaceChildren(h('div', { class: 'flex h-full w-full items-center justify-center px-4' }, form));
    input.focus();
  });
}

/** Mounts the full Room view (canvas + collaboration) into `root`. Vanilla equivalent of
 *  Room.jsx — same responsibilities (wire engine <-> network <-> UI), just imperative
 *  DOM instead of JSX, and plain store subscriptions instead of hooks.
 * @returns {() => void} destroy — call on navigation away
 */
export async function renderRoom(root, roomId, navigate) {
  const destroyFns = [];
  const push = useToastStore.getState().push;

  let username = getSavedUsername();
  if (!username) username = await promptForName(root);

  // ---- layout skeleton ----
  const canvas = h('canvas', { class: 'canvas-surface block h-full w-full touch-none' });
  const canvasContainer = h('div', { class: 'relative h-full flex-1 overflow-hidden' }, [canvas]);
  const surfaceArea = h('div', { class: 'relative flex flex-1 overflow-hidden' });
  const el = h('div', { class: 'flex h-full w-full flex-col' }, [surfaceArea]);
  root.replaceChildren(el);

  // ---- engine + network ----
  const { engine, destroy: destroyEngine } = mountCanvasEngine(canvas, canvasContainer);
  destroyFns.push(destroyEngine);

  const connection = new RoomConnection(engine, { roomId, username, userId: getOrCreateUserId() });
  // Fires asynchronously (never before this function's synchronous body finishes — the
  // socket handshake can't resolve same-tick), so it's always safe for it to wholesale-
  // replace `el`'s children even though the topbar/toolbar/canvas haven't been built yet
  // at the point this callback is merely being REGISTERED, below.
  connection.onJoinError = (error) => {
    el.replaceChildren(h('div', { class: 'flex h-full flex-col items-center justify-center gap-3 text-center' }, [
      h('p', { class: 'text-lg font-semibold text-gray-800 dark:text-gray-100' }, JOIN_ERROR_MESSAGES[error] ?? 'Could not join room.'),
      h('button', {
        type: 'button', class: 'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700',
        onclick: () => navigate('/'),
      }, 'Back to home'),
    ]));
  };
  connection.onJoined = (res) => {
    if (res.objects.length === 0) {
      const recovered = readAutosave(roomId);
      if (recovered && recovered.objects.length > 0) {
        push('A local backup of this canvas was found.');
        // Kept minimal (Priority A/B triage) — a one-click restore instead of a full
        // banner-with-dismiss UI; declining just means the backup ages out naturally.
        setTimeout(() => {
          if (confirm('A locally-saved version of this canvas was found. Restore it for everyone in this room?')) {
            connection.requestImportDocument(recovered.objects);
            push('Local canvas restored');
          } else {
            clearAutosave(roomId);
          }
        }, 300);
      }
    }
  };
  connection.connect();
  if (import.meta.env.DEV) window.__conn = connection;
  destroyFns.push(() => connection.disconnect());
  destroyFns.push(() => {
    useFollowStore.getState().stopFollowing();
    useDocumentStore.setState({ documentName: 'Untitled Canvas' });
  });

  // ---- bridge LOCAL stores into the framework-agnostic engine (same pattern the old
  // Room.jsx's useEffects used, just as direct subscriptions instead of effects) ----
  const bridge = (store, apply) => { apply(store.getState()); return store.subscribe(apply); };
  destroyFns.push(bridge(useToolStore, (s) => {
    engine.setTool(s.tool); engine.setColor(s.color); engine.setStrokeWidth(s.strokeWidth);
    engine.setFillEnabled(s.fillEnabled); engine.setFillColor(s.fillColor); engine.setFillOpacity(s.fillOpacity);
    engine.setTextFontSize(s.textFontSize); engine.setTextFontFamily(s.textFontFamily);
    engine.setTextBold(s.textBold); engine.setTextItalic(s.textItalic); engine.setTextUnderline(s.textUnderline);
    engine.setTextAlign(s.textAlign); engine.setTextColor(s.textColor);
  }));
  destroyFns.push(bridge(useThemeStore, (s) => engine.setDarkMode(s.theme === 'dark')));
  destroyFns.push(bridge(useCanvasSettingsStore, (s) => {
    engine.setGridEnabled(s.gridEnabled); engine.setGridSize(s.gridSize);
    engine.setSnapToGridEnabled(s.snapToGridEnabled); engine.setSmartGuidesEnabled(s.smartGuidesEnabled);
    engine.setRulersEnabled(s.rulersEnabled);
  }));
  destroyFns.push(bridge(usePresenceStore, (s) => {
    const self = s.selfId && s.users.get(s.selfId);
    if (self) engine.setSelfColor(self.color);
  }));

  // ---- autosave + keyboard shortcuts ----
  destroyFns.push(startAutosave(engine, roomId, () => useDocumentStore.getState().documentName));

  const handleExportJson = () => {
    const doc = serializeDocument(engine.objects, { name: useDocumentStore.getState().documentName });
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${slugifyFilename(useDocumentStore.getState().documentName)}.synccanvas.json`);
    push('Exported SyncCanvas file');
  };
  const handleExportPng = async () => {
    const result = await exportCanvasAsPng(engine.objects, { background: useThemeStore.getState().theme === 'dark' ? 'dark' : 'white' });
    if (!result) { push('Nothing to export yet — draw something first', 'error'); return; }
    downloadBlob(result.blob, `${slugifyFilename(useDocumentStore.getState().documentName)}.png`);
    push(result.scaledDown ? 'Exported PNG (scaled down — drawing is very large)' : 'Exported PNG');
  };
  const handleImportFile = async (file) => {
    const result = await readDocumentFile(file);
    if (!result.ok) { push(IMPORT_ERROR_MESSAGES[result.error] ?? 'Could not import that file.', 'error'); return; }
    if (engine.objects.size > 0 && !confirm('Importing this file will replace the current canvas for everyone in this room. Continue?')) return;
    connection.requestImportDocument(result.document.objects, result.document.history);
    if (result.document.metadata?.name) useDocumentStore.getState().setDocumentName(result.document.metadata.name);
  };
  const handleClear = () => {
    if (engine.objects.size > 0 && !confirm('Clear the canvas for everyone in this room?')) return;
    connection.requestClear();
    push('Canvas cleared');
  };
  const handleFollow = (userId, name) => {
    const { followingUserId, startFollowing, stopFollowing } = useFollowStore.getState();
    if (followingUserId === userId) { stopFollowing(); return; }
    startFollowing(userId, name);
    const cached = useViewportStore.getState().viewports.get(userId);
    if (cached) engine.applyRemoteViewport(cached);
  };

  // ---- chrome: topbar / toolbar / zoom / minimap / properties / text editor / help ----
  const helpModal = buildHelpModal();
  destroyFns.push(helpModal.destroy);

  const topBar = buildTopBar({
    roomId, onFollow: handleFollow,
    onUndo: () => connection.requestUndo(), onRedo: () => connection.requestRedo(),
    onExportJson: handleExportJson, onImportFile: handleImportFile, onExportPng: handleExportPng,
    onOpenHelp: () => helpModal.open(),
  });
  destroyFns.push(topBar.destroy);

  const toolbar = buildToolbar({
    onUndo: () => connection.requestUndo(), onRedo: () => connection.requestRedo(), onClear: handleClear,
  });
  destroyFns.push(toolbar.destroy);

  const zoomControls = h('div', { class: 'pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center' }, [
    h('div', { class: 'pointer-events-auto flex items-center gap-1 rounded-full border border-gray-200 bg-white/95 px-2 py-1.5 shadow-md backdrop-blur dark:border-gray-800 dark:bg-gray-900/95' }, [
      h('button', { type: 'button', title: 'Zoom out', class: 'flex h-7 w-7 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800', onclick: () => engine.zoomBy(0.8) }, '–'),
      h('span', { class: 'w-12 text-center text-xs font-semibold text-gray-600 dark:text-gray-300', id: 'zoom-pct' }, '100%'),
      h('button', { type: 'button', title: 'Zoom in', class: 'flex h-7 w-7 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800', onclick: () => engine.zoomBy(1.2) }, '+'),
      h('button', { type: 'button', title: 'Fit to content', class: 'ml-1 rounded-full px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800', onclick: () => engine.fitToScreen() }, 'Fit'),
      h('button', { type: 'button', title: 'Reset view', class: 'rounded-full px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800', onclick: () => engine.resetView() }, '100%'),
    ]),
  ]);
  const zoomLabel = zoomControls.querySelector('#zoom-pct');
  destroyFns.push(bridge(useCanvasMetaStore, (s) => { zoomLabel.textContent = `${s.zoomPercent}%`; }));

  const objectCountHint = h('div', {
    class: 'pointer-events-none absolute inset-0 z-0 flex items-center justify-center text-sm text-gray-300 dark:text-gray-700',
  }, 'Start drawing — changes appear live for everyone in this room.');
  destroyFns.push(bridge(useCanvasMetaStore, (s) => { objectCountHint.style.display = s.objectCount > 0 ? 'none' : 'flex'; }));

  const propertiesPanel = buildPropertiesPanel(engine);
  destroyFns.push(propertiesPanel.destroy);

  surfaceArea.append(toolbar.el, canvasContainer, objectCountHint, zoomControls, propertiesPanel.el);
  el.prepend(topBar.el);

  destroyFns.push(mountMiniMap(surfaceArea, engine));
  destroyFns.push(mountTextEditor(canvasContainer, engine));

  const unbindShortcuts = bindKeyboardShortcuts({
    engine,
    onUndo: () => connection.requestUndo(),
    onRedo: () => connection.requestRedo(),
    onZoomIn: () => engine.zoomBy(1.2),
    onZoomOut: () => engine.zoomBy(0.8),
    onFitToScreen: () => engine.fitToScreen(),
    onEscape: () => engine.deselect(),
    onExportJson: handleExportJson,
    onSaveSnapshot: () => {},
    onOpenCommandPalette: () => {},
    onToggleHistory: () => {},
  });
  destroyFns.push(unbindShortcuts);

  return () => destroyFns.forEach((fn) => fn());
}
