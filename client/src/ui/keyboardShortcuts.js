import { useToolStore } from '../store/useToolStore.js';
import { useDevStore } from '../store/useDevStore.js';

const TOOL_KEYS = {
  p: 'path', e: 'eraser', l: 'line', r: 'rect', c: 'circle', v: 'select', g: 'laser',
  x: 'connector', s: 'sticky', f: 'frame', t: 'text',
};

/**
 * Vanilla JS replacement for the old `useKeyboardShortcuts` React hook (Phase 13A
 * migration) — identical behavior, just a plain bind/unbind pair instead of a React
 * effect. Global keyboard shortcuts: tool switching, undo/redo, zoom, the editor
 * commands (select all/copy/paste/duplicate/delete/group/ungroup), and dismissing dev
 * overlays. Ignored while focus is inside a text input/textarea/contenteditable so
 * typing a room/username/document name never triggers a shortcut — the one deliberate
 * exception is Escape, which should still close an open overlay even from inside a field.
 * @returns {() => void} unbind
 */
export function bindKeyboardShortcuts({
  engine, onUndo, onRedo, onZoomIn, onZoomOut, onFitToScreen, onEscape, onExportJson,
  onSaveSnapshot, onOpenCommandPalette, onToggleHistory,
}) {
  const handler = (e) => {
    const target = e.target;
    const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      onOpenCommandPalette?.();
      return;
    }
    if (e.key === 'Escape') {
      useDevStore.getState().closeHud();
      onEscape?.();
      return;
    }

    if (e.shiftKey && e.key.toLowerCase() === 'r' && !mod) {
      e.preventDefault();
      onToggleHistory?.();
      return;
    }

    if (isTyping) return;

    const editingBlocked = engine.isReplaying?.();

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (editingBlocked) return;
      if (e.shiftKey) onRedo?.();
      else onUndo?.();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      if (!editingBlocked) onRedo?.();
      return;
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (e.shiftKey) onSaveSnapshot?.();
      else onExportJson?.();
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      if (editingBlocked) return;
      useToolStore.getState().setTool('select');
      engine.selectAll();
      return;
    }
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      if (!editingBlocked) engine.copySelectionToClipboard();
      return;
    }
    if (mod && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      if (editingBlocked) return;
      useToolStore.getState().setTool('select');
      engine.pasteFromClipboard();
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      if (editingBlocked) return;
      useToolStore.getState().setTool('select');
      engine.duplicateSelection();
      return;
    }
    if (mod && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      if (editingBlocked) return;
      if (e.shiftKey) engine.ungroupSelection();
      else engine.groupSelection();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!editingBlocked && engine.selectedObjectIds.size > 0) {
        e.preventDefault();
        engine.deleteSelection();
      }
      return;
    }
    if (e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd') { onZoomIn?.(); return; }
    if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') { onZoomOut?.(); return; }
    if (e.key === '0' || (e.shiftKey && e.key === '!')) { onFitToScreen?.(); return; }

    const tool = TOOL_KEYS[e.key.toLowerCase()];
    if (tool) useToolStore.getState().setTool(tool);
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
