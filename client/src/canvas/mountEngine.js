import { CanvasEngine } from './engine/CanvasEngine.js';
import { useCanvasMetaStore } from '../store/useCanvasMetaStore.js';

/**
 * Vanilla JS replacement for the old `useCanvasEngine` React hook (Phase 13A migration).
 * Creates one CanvasEngine, mounts it to `canvas`, keeps it sized to `container` via
 * ResizeObserver, and mirrors its viewport/object-count/fps/lock events into the (now
 * plain, framework-free) zustand-shaped store — same wiring as before, just called
 * directly instead of inside a React effect.
 * @returns {{engine: CanvasEngine, destroy: () => void}}
 */
export function mountCanvasEngine(canvas, container) {
  const engine = new CanvasEngine();
  if (import.meta.env.DEV) window.__engine = engine; // dev-only inspection hook

  engine.mount(canvas);

  const onViewport = (e) => useCanvasMetaStore.getState().setZoomPercent(Math.round(e.detail.scale * 100));
  const onObjectCount = (e) => useCanvasMetaStore.getState().setObjectCount(e.detail);
  const onFps = (e) => useCanvasMetaStore.getState().setFps(e.detail);
  const onLockChange = () => useCanvasMetaStore.getState().setLockCount(engine.remoteLocks.size);
  engine.addEventListener('viewport-change', onViewport);
  engine.addEventListener('object-count-change', onObjectCount);
  engine.addEventListener('fps-update', onFps);
  engine.addEventListener('lock-change', onLockChange);

  const resizeObserver = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    engine.resize(width, height);
  });
  resizeObserver.observe(container);

  const destroy = () => {
    resizeObserver.disconnect();
    engine.removeEventListener('viewport-change', onViewport);
    engine.removeEventListener('object-count-change', onObjectCount);
    engine.removeEventListener('fps-update', onFps);
    engine.removeEventListener('lock-change', onLockChange);
    engine.destroy();
  };

  return { engine, destroy };
}
