import { h } from './dom.js';

function section(title, children) {
  return h('div', { class: 'space-y-1.5' }, [
    h('h3', { class: 'text-xs font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400' }, title),
    ...children,
  ]);
}

function steps(items) {
  return h('ol', { class: 'list-decimal space-y-0.5 pl-5 text-sm text-gray-700 dark:text-gray-300' }, items.map((t) => h('li', {}, t)));
}

function bullets(items) {
  return h('ul', { class: 'list-disc space-y-0.5 pl-5 text-sm text-gray-700 dark:text-gray-300' }, items.map((t) => h('li', {}, t)));
}

function shortcutRow(keys, label) {
  return h('div', { class: 'flex items-center justify-between gap-3 text-sm' }, [
    h('span', { class: 'text-gray-600 dark:text-gray-300' }, label),
    h('kbd', { class: 'shrink-0 rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300' }, keys),
  ]);
}

/**
 * Final polish phase — the Help/Instructions modal (top bar button). Only documents
 * features actually reachable in THIS UI (spec item 7: "do NOT document features that
 * aren't accessible") — no Layers panel, Command Palette, session-history timeline, etc.,
 * since those aren't wired into the vanilla UI yet.
 */
export function buildHelpModal() {
  let overlay = null;

  function close() {
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function open() {
    if (overlay) return;
    const panel = h('div', {
      class: 'flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900',
      onclick: (e) => e.stopPropagation(),
    }, [
      h('div', { class: 'flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-800' }, [
        h('h2', { class: 'text-base font-bold text-gray-900 dark:text-white' }, 'Help & Instructions'),
        h('button', {
          type: 'button', title: 'Close', 'aria-label': 'Close help', class: 'rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
          onclick: close,
        }, '✕'),
      ]),
      h('div', { class: 'flex-1 space-y-5 overflow-y-auto px-5 py-4' }, [
        section('Getting Started', [
          steps([
            'Choose a tool from the left toolbar (grouped into Tools, Shapes, and Content).',
            'Drag on the canvas to draw.',
            'Use Select to click an object, then drag a handle to resize it or the handle above it to rotate it.',
            'Scroll to zoom, hold Space and drag (or middle-click drag) to pan — or use the zoom controls at the bottom.',
          ]),
        ]),
        section('Draw a Rectangle / Square', [
          steps([
            'Select Rectangle from the toolbar.',
            'Drag to create it — hold Shift while dragging to constrain it to a square.',
            'Switch to Select and click the shape to select it.',
            'Its Properties panel opens (top-right) — choose a Fill Color.',
            'Choose a Stroke Color / Width independently of the fill.',
            'Click "No Fill" for a transparent shape.',
          ]),
        ]),
        section('Add Text to a Shape', [
          steps([
            'Select the Text tool.',
            'Click inside a Rectangle, Circle, or Sticky Note to add/edit its text (or double-click it while Select is active).',
            'Click empty canvas with Text active to create standalone text instead.',
            'Type your text, then click away (or press Ctrl+Enter) to save it.',
            'Use the Properties panel to change font, size, Bold/Italic/Underline, alignment, and color.',
            'Select the text or shape again any time to edit it further.',
          ]),
        ]),
        section('Change an Existing Shape’s Color', [
          steps([
            'Select the shape with the Select tool.',
            'Its Properties panel opens automatically (top-right).',
            'Change Fill or Stroke there — it applies immediately, for everyone in the room.',
          ]),
        ]),
        section('Drawing', [
          bullets([
            'Brush: freehand strokes — pick a color and stroke width from the toolbar.',
            'Eraser: removes strokes it passes over.',
            'Colors: the quick palette in the toolbar, or the custom color swatch, for any color.',
            'Stroke Width: the toolbar slider (also shown per-object in Properties).',
          ]),
        ]),
        section('Selection', [
          bullets([
            'Move: drag a selected object.',
            'Resize: drag one of its corner/edge handles.',
            'Rotate: drag the handle above a selected rectangle, line, or sticky note.',
            'Delete: press Delete or Backspace.',
            'Multi-select: Shift-click more objects, or drag a marquee over empty canvas.',
          ]),
        ]),
        section('Collaboration', [
          bullets([
            'Rooms: everyone with the same room link sees the same canvas, live.',
            'Remote cursors: collaborators’ cursors show their name and a stable color.',
            'Global Undo/Redo: Undo/Redo affects the room’s most recent action, not just your own — anyone can undo anyone’s last change.',
          ]),
        ]),
        section('Other Features', [
          bullets([
            'Connector: hover a shape to reveal anchor points, then drag from one shape to another to draw an arrow between them.',
            'Sticky Note / Frame: a colored note or an organizational container, from the toolbar.',
            'Mini-map: bottom-right — click or drag to navigate a large canvas.',
            'Export: JSON (re-importable) and PNG, from the top bar.',
            'Autosave: your canvas saves locally as you work, with a recovery prompt if you rejoin a room that lost its state.',
            'Dark Mode: toggle in the top bar.',
          ]),
        ]),
        section('Keyboard Shortcuts', [
          h('div', { class: 'grid grid-cols-2 gap-x-4 gap-y-1' }, [
            shortcutRow('V', 'Select'), shortcutRow('P', 'Brush'),
            shortcutRow('E', 'Eraser'), shortcutRow('R', 'Rectangle'),
            shortcutRow('C', 'Circle'), shortcutRow('L', 'Line'),
            shortcutRow('T', 'Text'), shortcutRow('S', 'Sticky Note'),
            shortcutRow('X', 'Connector'), shortcutRow('F', 'Frame'),
            shortcutRow('G', 'Laser Pointer'), shortcutRow('Del', 'Delete selection'),
            shortcutRow('Ctrl+Z', 'Undo'), shortcutRow('Ctrl+Shift+Z', 'Redo'),
            shortcutRow('Ctrl+A', 'Select All'), shortcutRow('Ctrl+C / V', 'Copy / Paste'),
            shortcutRow('Ctrl+D', 'Duplicate'), shortcutRow('Ctrl+G', 'Group'),
            shortcutRow('Ctrl+S', 'Export JSON'), shortcutRow('+ / −', 'Zoom in / out'),
            shortcutRow('0', 'Fit to content'), shortcutRow('Esc', 'Deselect / cancel'),
          ]),
        ]),
      ]),
    ]);

    overlay = h('div', {
      class: 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4',
      onclick: close,
    }, panel);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    document.body.appendChild(overlay);
    panel.setAttribute('tabindex', '-1');
    panel.focus();
  }

  return { open, close, destroy: close };
}
