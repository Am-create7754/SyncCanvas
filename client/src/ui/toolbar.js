import { h } from './dom.js';
import { TOOL_DEFS } from '../canvas/tools/toolDefs.js';
import { useToolStore, DEFAULT_COLORS, FILL_COLORS } from '../store/useToolStore.js';
import { FILLABLE_TYPES } from '@synccanvas/shared';

const TOOL_LABELS = {
  select: '⟲', path: '✎', eraser: '⌫', line: '╱', rect: '▭', circle: '◯',
  connector: '⤳', sticky: '▤', frame: '⬚', laser: '⊙',
};

/** The drawing tool palette + stroke color/width (Priority A: brush/eraser/colors/stroke
 *  width; Priority B: rect/circle/line/connector/sticky/frame — the engine already
 *  handles every one of these uniformly, so exposing the full TOOL_DEFS list costs
 *  nothing extra and keeps every advanced tool actually usable, not just "not deleted"). */
export function buildToolbar({ onUndo, onRedo, onClear }) {
  const toolButtons = new Map();
  const toolsWrap = h('div', { class: 'flex flex-col items-center gap-1' });
  for (const def of TOOL_DEFS) {
    const btn = h('button', {
      type: 'button', title: `${def.label} (${def.shortcut})`, 'aria-label': def.label,
      class: 'flex h-10 w-10 items-center justify-center rounded-lg text-lg transition-colors text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
      onclick: () => useToolStore.getState().setTool(def.id),
    }, TOOL_LABELS[def.id] ?? def.label[0]);
    toolButtons.set(def.id, btn);
    toolsWrap.append(btn);
  }

  const colorButtons = DEFAULT_COLORS.map((c) => h('button', {
    type: 'button', 'aria-label': `Color ${c}`,
    class: 'h-6 w-6 rounded-full border border-gray-300 transition-transform hover:scale-110 dark:border-gray-700',
    style: { backgroundColor: c },
    onclick: () => useToolStore.getState().setColor(c),
  }));
  const customColor = h('input', { type: 'color', value: useToolStore.getState().color, 'aria-label': 'Custom color', class: 'h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0' });
  customColor.addEventListener('input', () => useToolStore.getState().setColor(customColor.value));

  const widthLabel = h('span', { class: 'text-[10px] font-medium text-gray-500 dark:text-gray-400' }, `${useToolStore.getState().strokeWidth}px`);
  const widthSlider = h('input', {
    type: 'range', min: 1, max: 40, value: useToolStore.getState().strokeWidth, 'aria-label': 'Stroke width',
    class: 'h-24 w-2 accent-indigo-600', style: { writingMode: 'vertical-lr', direction: 'rtl' },
  });
  widthSlider.addEventListener('input', () => useToolStore.getState().setStrokeWidth(Number(widthSlider.value)));

  // ---- Fill panel (Priority B: fill colors for rect/circle/sticky/frame) ----
  const fillToggle = h('button', {
    type: 'button', title: 'Toggle fill',
    class: 'rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
    onclick: () => useToolStore.getState().setFillEnabled(!useToolStore.getState().fillEnabled),
  }, 'Fill');
  const fillSwatches = FILL_COLORS.map((c) => h('button', {
    type: 'button', 'aria-label': `Fill color ${c}`,
    class: 'h-5 w-5 rounded-full border border-gray-300 transition-transform hover:scale-110 dark:border-gray-700',
    style: { backgroundColor: c },
    onclick: () => { useToolStore.getState().setFillColor(c); useToolStore.getState().setFillEnabled(true); },
  }));
  const fillWrap = h('div', { class: 'flex flex-col items-center gap-1 border-t border-gray-200 pt-2 dark:border-gray-800' }, [
    fillToggle,
    h('div', { class: 'flex flex-wrap justify-center gap-1', style: { width: '64px' } }, fillSwatches),
  ]);

  const undoBtn = h('button', { type: 'button', title: 'Undo', class: 'flex h-10 w-10 items-center justify-center rounded-lg text-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800', onclick: onUndo }, '↶');
  const redoBtn = h('button', { type: 'button', title: 'Redo', class: 'flex h-10 w-10 items-center justify-center rounded-lg text-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800', onclick: onRedo }, '↷');
  const clearBtn = h('button', { type: 'button', title: 'Clear canvas', class: 'flex h-10 w-10 items-center justify-center rounded-lg text-lg text-gray-400 hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-500/10', onclick: onClear }, '🗑');

  const el = h('div', {
    class: 'flex h-full w-16 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-gray-200 bg-white/90 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90',
  }, [
    toolsWrap,
    h('div', { class: 'my-1 h-px w-8 bg-gray-200 dark:bg-gray-800' }),
    h('div', { class: 'flex flex-wrap justify-center gap-1.5', style: { width: '64px' } }, [...colorButtons, customColor]),
    h('div', { class: 'my-1 h-px w-8 bg-gray-200 dark:bg-gray-800' }),
    h('label', { class: 'flex flex-col items-center gap-1' }, [widthLabel, widthSlider]),
    fillWrap,
    h('div', { class: 'flex-1' }),
    undoBtn, redoBtn, clearBtn,
  ]);

  const render = ({ tool, color, strokeWidth, fillEnabled }) => {
    for (const [id, btn] of toolButtons) {
      const active = id === tool;
      btn.className = `flex h-10 w-10 items-center justify-center rounded-lg text-lg transition-colors ${
        active ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
      }`;
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
