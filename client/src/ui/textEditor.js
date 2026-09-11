import { h } from './dom.js';
import { worldToScreen } from '../canvas/geometry/viewport.js';
import { boundsOfPoints } from '../canvas/geometry/points.js';

/**
 * Final polish phase — the inline text-editing surface. A real Canvas 2D `fillText` call
 * (see canvas/rendering/drawObject.js) renders the FINISHED text; hand-rolling cursor
 * blink/selection/IME support directly on canvas would be exactly the over-engineering
 * the spec warns against, so EDITING itself uses a plain `<textarea>` positioned exactly
 * over the object's on-screen box, styled to preview the same font/size/weight/style/
 * alignment/color the canvas will render. Nothing is sent over the network per keystroke —
 * only on commit (blur / Ctrl+Enter), reusing engine.createTextObject / engine.editSelectedText,
 * which is what makes this integrate with undo/redo/multiplayer/autosave for free.
 *
 * Listens for the engine's `request-text-edit` CustomEvent (dispatched by the Text tool's
 * pointerdown handling and by double-click — see CanvasEngine.js) so this stays the ONE
 * place DOM text-editing lives, regardless of what triggered it.
 * @param {HTMLElement} container - the (position:relative) element the canvas itself sits
 *   in; the overlay is positioned absolutely within it.
 * @returns {() => void} destroy
 */
export function mountTextEditor(container, engine) {
  let activeTextarea = null;

  function closeEditor() {
    if (activeTextarea) {
      activeTextarea.remove();
      activeTextarea = null;
    }
  }

  function styleFor(formatting, fontSizeWorld) {
    const scale = engine.viewport.scale;
    return {
      fontSize: `${Math.max((fontSizeWorld ?? 16) * scale, 8)}px`,
      fontFamily: formatting.fontFamily || 'sans-serif',
      fontWeight: formatting.bold ? '700' : '400',
      fontStyle: formatting.italic ? 'italic' : 'normal',
      textDecoration: formatting.underline ? 'underline' : 'none',
      textAlign: formatting.textAlign || 'left',
      color: formatting.textColor || '#1F2937',
    };
  }

  function createOverlay(x, y, w, hgt, formatting, fontSizeWorld) {
    return h('textarea', {
      maxlength: 500,
      spellcheck: false,
      'aria-label': 'Text content',
      class: 'absolute z-40 resize-none rounded-sm border-2 border-indigo-500 bg-white/95 px-1 py-0.5 leading-snug outline-none dark:bg-gray-900/95',
      style: { left: `${x}px`, top: `${y}px`, width: `${Math.max(w, 60)}px`, height: `${Math.max(hgt, 28)}px`, ...styleFor(formatting, fontSizeWorld) },
    });
  }

  function bindKeys(textarea, { onEscape, onCommitKey }) {
    // stopPropagation on Escape/Ctrl+Enter so the GLOBAL shortcut handler (which also
    // reacts to Escape, see ui/keyboardShortcuts.js) never ALSO fires while this overlay
    // is open — this textarea is the one place that keystroke should be handled.
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onEscape(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.stopPropagation(); onCommitKey(); }
    });
  }

  function openForNew(worldPoint) {
    closeEditor();
    const screen = worldToScreen(worldPoint, engine.viewport);
    const w = 160 * engine.viewport.scale;
    const hgt = 44 * engine.viewport.scale;
    const formatting = {
      fontFamily: engine.textFontFamily, bold: engine.textBold, italic: engine.textItalic,
      underline: engine.textUnderline, textAlign: engine.textAlign, textColor: engine.textColor,
    };
    const textarea = createOverlay(screen.x - w / 2, screen.y - hgt / 2, w, hgt, formatting, engine.textFontSize);

    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      const value = textarea.value;
      closeEditor();
      if (value.trim()) engine.createTextObject(worldPoint, value);
    };
    textarea.addEventListener('blur', finish);
    bindKeys(textarea, { onEscape: () => { textarea.value = ''; textarea.blur(); }, onCommitKey: () => textarea.blur() });

    container.appendChild(textarea);
    textarea.focus();
    activeTextarea = textarea;
  }

  function openForExisting(id) {
    const obj = engine.objects.get(id);
    if (!obj || !obj.points || obj.points.length < 2) return;
    closeEditor();
    const bounds = boundsOfPoints(obj.points);
    const topLeft = worldToScreen({ x: bounds.minX, y: bounds.minY }, engine.viewport);
    const bottomRight = worldToScreen({ x: bounds.maxX, y: bounds.maxY }, engine.viewport);
    const textarea = createOverlay(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y, obj, obj.fontSize);
    textarea.value = obj.text ?? '';
    const original = textarea.value;

    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      const value = textarea.value;
      closeEditor();
      if (value !== original) engine.editSelectedText({ text: value });
    };
    textarea.addEventListener('blur', finish);
    bindKeys(textarea, { onEscape: () => { textarea.value = original; textarea.blur(); }, onCommitKey: () => textarea.blur() });

    container.appendChild(textarea);
    textarea.focus();
    textarea.select();
    activeTextarea = textarea;
  }

  const onRequest = (e) => {
    const { id, isNew, point } = e.detail;
    if (isNew) openForNew(point);
    else openForExisting(id);
  };
  engine.addEventListener('request-text-edit', onRequest);

  // Panning/zooming mid-edit is a rare interaction — rather than re-deriving the overlay's
  // screen position every frame (and risking it drifting out of sync with the canvas
  // underneath), just commit-and-close: the object/text is never lost, editing just ends.
  const onViewportChange = () => { if (activeTextarea) activeTextarea.blur(); };
  engine.addEventListener('viewport-change', onViewportChange);

  return () => {
    engine.removeEventListener('request-text-edit', onRequest);
    engine.removeEventListener('viewport-change', onViewportChange);
    closeEditor();
  };
}
