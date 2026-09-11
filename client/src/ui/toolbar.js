import { h } from './dom.js';
import { TOOL_DEFS, TOOL_GROUPS } from '../canvas/tools/toolDefs.js';
import { useToolStore, DEFAULT_COLORS, FILL_COLORS } from '../store/useToolStore.js';
import { FILLABLE_TYPES } from '@synccanvas/shared';

const TOOL_ICONS = {
  select: '⟲', path: '✎', eraser: '⌫', line: '╱', rect: '▭', circle: '◯',
  connector: '⤳', sticky: '▤', frame: '⬚', laser: '⊙', text: 'T',
};
const TOOL_DEFS_BY_ID = new Map(TOOL_DEFS.map((d) => [d.id, d]));

/**
 * Final polish phase: a moderately wider, GROUPED toolbar (TOOLS / SHAPES / CONTENT /
 * OTHER — see toolDefs.js's TOOL_GROUPS) with icon + short label per tool, instead of a
 * thin column of unlabeled icons — plus the existing "next object" quick color palette /
 * stroke width / fill controls underneath. Active tool is visually obvious (solid
 * indigo fill); every button carries a tooltip via `title`.
 */
export function buildToolbar({ onUndo, onRedo, onClear }) {
  const toolButtons = new Map();
  const groupsWrap = h('div', { class: 'flex w-full flex-col gap-3 px-2' });
  for (const group of TOOL_GROUPS) {
    const rows = group.tools.map((id) => {
      const def = TOOL_DEFS_BY_ID.get(id);
      if (!def) return null;
      const btn = h('button', {
        type: 'button', title: `${def.label} (${def.shortcut})`, 'aria-label': def.label,
        class: 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
        onclick: () => useToolStore.getState().setTool(def.id),
      }, [
        h('span', { class: 'flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none' }, TOOL_ICONS[def.id] ?? def.label[0]),
        h('span', { class: 'truncate font-medium' }, def.label),
      ]);
      toolButtons.set(def.id, btn);
      return btn;
    }).filter(Boolean);
    groupsWrap.append(h('div', { class: 'flex flex-col gap-0.5' }, [
      h('div', { class: 'px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500' }, group.name),
      ...rows,
    ]));
  }

  const colorButtons = DEFAULT_COLORS.map((c) => h('button', {
    type: 'button', 'aria-label': `Color ${c}`, title: `Stroke color ${c}`,
    class: 'h-6 w-6 rounded-full border border-gray-300 transition-transform hover:scale-110 dark:border-gray-700',
    style: { backgroundColor: c },
    onclick: () => useToolStore.getState().setColor(c),
  }));
  const customColor = h('input', { type: 'color', value: useToolStore.getState().color, title: 'Custom stroke color', 'aria-label': 'Custom color', class: 'h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0' });
  customColor.addEventListener('input', () => useToolStore.getState().setColor(customColor.value));

  const widthLabel = h('span', { class: 'text-[10px] font-medium text-gray-500 dark:text-gray-400' }, `${useToolStore.getState().strokeWidth}px`);
  const widthSlider = h('input', {
    type: 'range', min: 1, max: 40, value: useToolStore.getState().strokeWidth, title: 'Stroke width', 'aria-label': 'Stroke width',
    class: 'w-32 accent-indigo-600',
  });
  widthSlider.addEventListener('input', () => useToolStore.getState().setStrokeWidth(Number(widthSlider.value)));

  // ---- Fill panel (next-shape default fill — rect/circle/sticky/frame) ----
  const fillToggle = h('button', {
    type: 'button', title: 'Toggle fill for the next shape',
    class: 'rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
    onclick: () => useToolStore.getState().setFillEnabled(!useToolStore.getState().fillEnabled),
  }, 'Fill');
  const fillSwatches = FILL_COLORS.map((c) => h('button', {
    type: 'button', 'aria-label': `Fill color ${c}`, title: `Fill color ${c}`,
    class: 'h-5 w-5 rounded-full border border-gray-300 transition-transform hover:scale-110 dark:border-gray-700',
    style: { backgroundColor: c },
    onclick: () => { useToolStore.getState().setFillColor(c); useToolStore.getState().setFillEnabled(true); },
  }));
  const fillWrap = h('div', { class: 'flex w-full flex-col items-center gap-1 border-t border-gray-200 px-2 pt-2 dark:border-gray-800' }, [
    fillToggle,
    h('div', { class: 'flex flex-wrap justify-center gap-1' }, fillSwatches),
  ]);

  const undoBtn = h('button', { type: 'button', title: 'Undo (Ctrl+Z)', class: 'flex h-9 w-9 items-center justify-center rounded-lg text-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800', onclick: onUndo }, '↶');
  const redoBtn = h('button', { type: 'button', title: 'Redo (Ctrl+Shift+Z)', class: 'flex h-9 w-9 items-center justify-center rounded-lg text-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800', onclick: onRedo }, '↷');
  const clearBtn = h('button', { type: 'button', title: 'Clear canvas', class: 'flex h-9 w-9 items-center justify-center rounded-lg text-lg text-gray-400 hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-500/10', onclick: onClear }, '🗑');

  const el = h('div', {
    class: 'flex h-full w-44 shrink-0 flex-col gap-2 overflow-y-auto border-r border-gray-200 bg-white/90 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90',
  }, [
    groupsWrap,
    h('div', { class: 'mx-2 my-1 h-px bg-gray-200 dark:bg-gray-800' }),
    h('div', { class: 'flex w-full flex-col items-center gap-1.5 px-2' }, [
      h('div', { class: 'flex flex-wrap justify-center gap-1.5' }, [...colorButtons, customColor]),
    ]),
    h('label', { class: 'flex w-full flex-col items-center gap-1 px-2' }, [widthLabel, widthSlider]),
    fillWrap,
    h('div', { class: 'flex-1' }),
    h('div', { class: 'flex items-center justify-center gap-1' }, [undoBtn, redoBtn, clearBtn]),
  ]);

  const render = ({ tool, color, strokeWidth, fillEnabled }) => {
    for (const [id, btn] of toolButtons) {
      const active = id === tool;
      btn.className = `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
        active ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
      }`;
      btn.setAttribute('aria-pressed', String(active));
    }
    colorButtons.forEach((btn, i) => {
      btn.style.outline = DEFAULT_COLORS[i] === color ? '2px solid #6366F1' : 'none';
      btn.style.outlineOffset = '1px';
    });
    widthLabel.textContent = `${strokeWidth}px`;
    fillToggle.className = `rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${fillEnabled ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`;
    fillWrap.style.display = FILLABLE_TYPES.has(useToolStore.getState().tool) ? '' : 'none';
  };
  render(useToolStore.getState());
  const unsub = useToolStore.subscribe(render);

  return { el, setUndoRedoEnabled: (u, r) => { undoBtn.disabled = !u; redoBtn.disabled = !r; }, destroy: unsub };
}
