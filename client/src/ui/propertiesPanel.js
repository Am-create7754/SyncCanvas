import { h, setChildren } from './dom.js';
import { FILLABLE_TYPES, TEXT_CAPABLE_TYPES, FONT_SIZES, FONT_FAMILIES } from '@synccanvas/shared';
import { QUICK_COLORS } from '../store/useToolStore.js';

const STROKE_ONLY_TYPES = new Set(['line', 'path', 'eraser']);

function swatchRow(colors, current, onPick, titlePrefix) {
  return h('div', { class: 'flex flex-wrap gap-1.5' }, colors.map(({ name, hex }) => h('button', {
    type: 'button', title: `${titlePrefix} ${name}`, 'aria-label': `${titlePrefix} ${name}`, 'aria-pressed': String(hex === current),
    class: 'h-6 w-6 rounded-full border transition-transform hover:scale-110 dark:border-gray-700',
    style: { backgroundColor: hex, outline: hex === current ? '2px solid #6366F1' : 'none', outlineOffset: '1px', borderColor: hex === '#FFFFFF' ? '#D1D5DB' : 'transparent' },
    onclick: () => onPick(hex),
  })));
}

function customColorInput(current, onPick, label) {
  const input = h('input', { type: 'color', value: current, title: `Custom ${label}`, 'aria-label': `Custom ${label}`, class: 'h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0' });
  input.addEventListener('input', () => onPick(input.value));
  return input;
}

function sectionLabel(text) {
  return h('div', { class: 'mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500' }, text);
}

/**
 * Final polish phase — the "edit the SELECTED object" panel (distinct from the toolbar's
 * own "next object to draw" defaults): fill/stroke/width/opacity for shapes, font/size/
 * bold/italic/alignment/color for text, stroke-only for lines/brush strokes. Shows only
 * relevant controls per object type (spec item 6), and only while exactly one object is
 * selected and not locked by someone else.
 */
export function buildPropertiesPanel(engine) {
  const body = h('div', { class: 'flex flex-col gap-3' });
  const el = h('div', {
    class: 'absolute right-3 top-3 z-30 hidden w-56 rounded-xl border border-gray-200 bg-white/97 p-3 shadow-lg backdrop-blur dark:border-gray-800 dark:bg-gray-900/97',
  }, [
    h('div', { class: 'mb-2 text-xs font-bold uppercase tracking-wide text-gray-700 dark:text-gray-300' }, 'Properties'),
    body,
  ]);

  const applyStyle = (patch) => engine.editSelectedObjectStyle(patch);
  const applyText = (patch) => engine.editSelectedText(patch);

  function buildShapeSection(obj) {
    const noFillBtn = h('button', {
      type: 'button', title: 'No fill (transparent)', 'aria-pressed': String(!obj.fillEnabled),
      class: `flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold transition-colors ${
        !obj.fillEnabled ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`,
      onclick: () => applyStyle({ fillEnabled: false }),
    }, '⦸ No Fill');

    return h('div', { class: 'flex flex-col gap-3' }, [
      h('div', {}, [
        h('div', { class: 'mb-1.5 flex items-center justify-between' }, [sectionLabel('Fill'), noFillBtn]),
        swatchRow(QUICK_COLORS, obj.fillEnabled ? obj.fillColor : null, (hex) => applyStyle({ fillEnabled: true, fillColor: hex }), 'Fill'),
        h('div', { class: 'mt-1.5' }, customColorInput(obj.fillColor ?? '#F97316', (hex) => applyStyle({ fillEnabled: true, fillColor: hex }), 'fill color')),
      ]),
      h('div', {}, [
        sectionLabel('Stroke'),
        swatchRow(QUICK_COLORS, obj.color, (hex) => applyStyle({ color: hex }), 'Stroke'),
        h('div', { class: 'mt-1.5' }, customColorInput(obj.color, (hex) => applyStyle({ color: hex }), 'stroke color')),
      ]),
      h('div', {}, [
        h('div', { class: 'mb-1 flex items-center justify-between text-[11px] font-semibold text-gray-500 dark:text-gray-400' }, [
          h('span', {}, 'Stroke Width'), h('span', {}, `${obj.width}px`),
        ]),
        h('input', {
          type: 'range', min: 1, max: 40, value: obj.width, 'aria-label': 'Stroke width', class: 'w-full accent-indigo-600',
          oninput: (e) => applyStyle({ width: Number(e.target.value) }),
        }),
      ]),
      h('div', { class: obj.fillEnabled ? '' : 'opacity-40' }, [
        h('div', { class: 'mb-1 flex items-center justify-between text-[11px] font-semibold text-gray-500 dark:text-gray-400' }, [
          h('span', {}, 'Opacity'), h('span', {}, `${Math.round((obj.fillOpacity ?? 1) * 100)}%`),
        ]),
        h('input', {
          type: 'range', min: 0, max: 100, value: Math.round((obj.fillOpacity ?? 1) * 100), disabled: !obj.fillEnabled,
          'aria-label': 'Fill opacity', class: 'w-full accent-indigo-600',
          oninput: (e) => applyStyle({ fillOpacity: Number(e.target.value) / 100 }),
        }),
      ]),
    ]);
  }

  function buildStrokeOnlySection(obj) {
    return h('div', { class: 'flex flex-col gap-3' }, [
      h('div', {}, [
        sectionLabel('Stroke Color'),
        swatchRow(QUICK_COLORS, obj.color, (hex) => applyStyle({ color: hex }), 'Stroke'),
        h('div', { class: 'mt-1.5' }, customColorInput(obj.color, (hex) => applyStyle({ color: hex }), 'stroke color')),
      ]),
      h('div', {}, [
        h('div', { class: 'mb-1 flex items-center justify-between text-[11px] font-semibold text-gray-500 dark:text-gray-400' }, [
          h('span', {}, 'Stroke Width'), h('span', {}, `${obj.width}px`),
        ]),
        h('input', {
          type: 'range', min: 1, max: 40, value: obj.width, 'aria-label': 'Stroke width', class: 'w-full accent-indigo-600',
          oninput: (e) => applyStyle({ width: Number(e.target.value) }),
        }),
      ]),
    ]);
  }

  function buildTextSection(obj) {
    const textarea = h('textarea', {
      rows: 2, maxlength: 500, placeholder: 'Type text…', 'aria-label': 'Text content',
      class: 'w-full resize-none rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100',
    }, obj.text ?? '');
    textarea.value = obj.text ?? '';
    let committed = textarea.value;
    const commit = () => { if (textarea.value !== committed) { committed = textarea.value; applyText({ text: textarea.value }); } };
    textarea.addEventListener('blur', commit);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { textarea.value = committed; textarea.blur(); e.stopPropagation(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { commit(); textarea.blur(); }
    });

    const fontSelect = h('select', {
      'aria-label': 'Font family', class: 'w-full rounded-md border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100',
      onchange: (e) => applyText({ fontFamily: e.target.value }),
    }, FONT_FAMILIES.map((f) => h('option', { value: f, selected: (obj.fontFamily ?? 'sans-serif') === f }, f)));

    const sizeSelect = h('select', {
      'aria-label': 'Font size', class: 'w-20 rounded-md border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100',
      onchange: (e) => applyText({ fontSize: Number(e.target.value) }),
    }, FONT_SIZES.map((s) => h('option', { value: s, selected: (obj.fontSize ?? 16) === s }, `${s}px`)));

    const toggleBtn = (label, active, title, onToggle) => h('button', {
      type: 'button', title, 'aria-pressed': String(active),
      class: `flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold transition-colors ${
        active ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
      }`,
      onclick: onToggle,
    }, label);

    const boldBtn = toggleBtn('B', !!obj.bold, 'Bold', () => applyText({ bold: !obj.bold }));
    const italicBtn = toggleBtn('I', !!obj.italic, 'Italic', () => applyText({ italic: !obj.italic }));
    const underlineBtn = toggleBtn('U', !!obj.underline, 'Underline', () => applyText({ underline: !obj.underline }));

    const alignBtn = (dir, label) => h('button', {
      type: 'button', title: `Align ${dir}`, 'aria-pressed': String((obj.textAlign ?? 'left') === dir),
      class: `flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold transition-colors ${
        (obj.textAlign ?? 'left') === dir ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
      }`,
      onclick: () => applyText({ textAlign: dir }),
    }, label);

    return h('div', { class: 'flex flex-col gap-2 border-t border-gray-200 pt-3 dark:border-gray-800' }, [
      sectionLabel('Text'),
      textarea,
      h('div', { class: 'flex gap-1.5' }, [fontSelect, sizeSelect]),
      h('div', { class: 'flex items-center gap-1' }, [boldBtn, italicBtn, underlineBtn, h('span', { class: 'mx-1 h-4 w-px bg-gray-200 dark:bg-gray-800' }), alignBtn('left', '⟸'), alignBtn('center', '≡'), alignBtn('right', '⟹')]),
      h('div', {}, [
        h('div', { class: 'mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500' }, 'Text Color'),
        swatchRow(QUICK_COLORS, obj.textColor ?? '#1F2937', (hex) => applyText({ textColor: hex }), 'Text'),
      ]),
    ]);
  }

  function render() {
    // Never tear down and rebuild the panel while the user has an actual TEXT INPUT
    // focused inside it (typing in the text textarea, picking a custom color) — a remote
    // collaborator's unrelated edit, or even our own drag of some OTHER object, would
    // otherwise fire object-style-change/transform-preview and yank focus out from under
    // active input. A plain BUTTON (Bold/Italic/swatch/...) has no in-progress state to
    // lose, so those are deliberately NOT protected — the button's own active/pressed
    // state needs the rebuild to actually show up after being clicked.
    const activeTag = document.activeElement?.tagName;
    if (body.contains(document.activeElement) && (activeTag === 'TEXTAREA' || activeTag === 'INPUT')) return;
    if (engine.selectedObjectIds.size !== 1) { el.classList.add('hidden'); return; }
    const [id] = engine.selectedObjectIds;
    const obj = engine.objects.get(id);
    if (!obj || engine.isLockedByOther(id)) { el.classList.add('hidden'); return; }

    const sections = [];
    if (FILLABLE_TYPES.has(obj.type)) sections.push(buildShapeSection(obj));
    else if (STROKE_ONLY_TYPES.has(obj.type)) sections.push(buildStrokeOnlySection(obj));
    if (TEXT_CAPABLE_TYPES.has(obj.type)) sections.push(buildTextSection(obj));

    if (sections.length === 0) { el.classList.add('hidden'); return; }
    setChildren(body, sections);
    el.classList.remove('hidden');
  }

  // Deferred (microtask) rather than called directly from the event listener: a click on
  // one control (e.g. "Bold") can itself trigger ANOTHER control's blur-commit first (the
  // text textarea, if it still had focus) — committing that synchronously fires
  // object-style-change, which would otherwise rebuild this panel's DOM (replacing the
  // very button mid-click) before the browser has finished dispatching the click to it.
  // Deferring by a tick lets the current click's own handler finish first, and naturally
  // coalesces a burst of events (e.g. a drag's many transform-preview ticks) into one render.
  let renderScheduled = false;
  const scheduleRender = () => {
    if (renderScheduled) return;
    renderScheduled = true;
    queueMicrotask(() => { renderScheduled = false; render(); });
  };

  render();
  const events = ['local-selection-change', 'object-style-change', 'transform-preview', 'lock-change'];
  for (const ev of events) engine.addEventListener(ev, scheduleRender);

  return { el, destroy: () => { for (const ev of events) engine.removeEventListener(ev, scheduleRender); } };
}
