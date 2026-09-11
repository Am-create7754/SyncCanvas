import { h } from './dom.js';
import { render as renderMiniMap, MAP_WIDTH, MAP_HEIGHT } from '../canvas/rendering/renderMiniMap.js';
import { useThemeStore } from '../store/useThemeStore.js';

/**
 * Vanilla wrapper around the pure `render(ctx, dpr, engine, projectionRef, isDark)`
 * function already exported by MiniMap.jsx (Phase 12/earlier) — that function never
 * touched React itself (see its own doc comment: exported specifically so it could be
 * unit-tested without a real <canvas>), so it's reused completely unchanged here. Only
 * the React component wrapper around it is replaced.
 */
export function mountMiniMap(root, engine) {
  const canvas = h('canvas', { class: 'block cursor-pointer' });
  const closeBtn = h('button', {
    type: 'button', title: 'Hide mini-map', class: 'absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-black/5 dark:hover:bg-white/10',
  }, '×');
  const panel = h('div', {
    class: 'absolute bottom-5 right-3 z-20 overflow-hidden rounded-lg border border-gray-200 bg-white/95 shadow-md backdrop-blur dark:border-gray-800 dark:bg-gray-900/95',
  }, [closeBtn, canvas]);
  const showBtn = h('button', {
    type: 'button', title: 'Show mini-map', class: 'absolute bottom-5 right-3 z-20 hidden h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-600 shadow-md backdrop-blur dark:border-gray-800 dark:bg-gray-900/95 dark:text-gray-300',
  }, '🗺');
  root.append(panel, showBtn);

  closeBtn.addEventListener('click', () => { panel.classList.add('hidden'); showBtn.classList.remove('hidden'); showBtn.style.display = 'flex'; });
  showBtn.addEventListener('click', () => { panel.classList.remove('hidden'); showBtn.classList.add('hidden'); showBtn.style.display = 'none'; });

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = MAP_WIDTH * dpr;
  canvas.height = MAP_HEIGHT * dpr;
  canvas.style.width = `${MAP_WIDTH}px`;
  canvas.style.height = `${MAP_HEIGHT}px`;

  const projectionRef = { current: null };
  let dragging = false;
  const navigateToEvent = (e) => {
    if (!projectionRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    engine.centerOn(projectionRef.current.mapToWorld(point));
  };
  canvas.addEventListener('pointerdown', (e) => { dragging = true; navigateToEvent(e); });
  window.addEventListener('pointermove', (e) => { if (dragging) navigateToEvent(e); });
  window.addEventListener('pointerup', () => { dragging = false; });

  let dirty = true;
  const markDirty = () => { dirty = true; };
  engine.addEventListener('viewport-change', markDirty);
  engine.addEventListener('object-count-change', markDirty);
  engine.addEventListener('object-style-change', markDirty);
  engine.addEventListener('transform-preview', markDirty);
  const unsubTheme = useThemeStore.subscribe(markDirty);

  let rafId;
  const loop = () => {
    if (dirty && !panel.classList.contains('hidden')) {
      renderMiniMap(ctx, dpr, engine, projectionRef, useThemeStore.getState().theme === 'dark');
      dirty = false;
    }
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(rafId);
    engine.removeEventListener('viewport-change', markDirty);
    engine.removeEventListener('object-count-change', markDirty);
    engine.removeEventListener('object-style-change', markDirty);
    engine.removeEventListener('transform-preview', markDirty);
    unsubTheme();
  };
}
