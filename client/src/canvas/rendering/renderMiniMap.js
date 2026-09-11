import { visualBoundsOfObjects } from '../geometry/objectBounds.js';
import { usePresenceStore } from '../../store/usePresenceStore.js';
import { useViewportStore } from '../../store/useViewportStore.js';

export const MAP_WIDTH = 168;
export const MAP_HEIGHT = 124;
const PADDING = 14;

/**
 * Pure mini-map rendering (Phase 13A: extracted out of the old MiniMap.jsx so it has no
 * React involvement at all — it never did; only the component wrapper around it did).
 * A real second canvas render, not a decorative rectangle: it reads the same
 * `engine.objects`/`engine.viewport` the main canvas does and projects them into a small
 * coordinate space. `projectionRef.current` is populated with `{worldToMap, mapToWorld}`
 * so the caller's click/drag-to-navigate handler can convert a map-space click back into
 * a world point.
 */
export function render(ctx, dpr, engine, projectionRef, isDark) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  ctx.fillStyle = isDark ? '#111827' : '#F9FAFB';
  ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  const { viewport, cssWidth, cssHeight } = engine;
  const viewportWorldBounds = {
    minX: -viewport.x / viewport.scale,
    minY: -viewport.y / viewport.scale,
    maxX: (cssWidth - viewport.x) / viewport.scale,
    maxY: (cssHeight - viewport.y) / viewport.scale,
  };

  const displayObjects = engine.getDisplayObjects();
  // visualBoundsOfObjects (not boundsOfObjects) so a rotated rectangle's true on-screen
  // extent is what the mini-map fits everything to — otherwise a large rotated shape
  // could read as badly clipped/wrong relative to the actual canvas (Phase 11 spec #24).
  const contentBounds = visualBoundsOfObjects(displayObjects);
  const bounds = contentBounds
    ? {
      minX: Math.min(contentBounds.minX, viewportWorldBounds.minX),
      minY: Math.min(contentBounds.minY, viewportWorldBounds.minY),
      maxX: Math.max(contentBounds.maxX, viewportWorldBounds.maxX),
      maxY: Math.max(contentBounds.maxY, viewportWorldBounds.maxY),
    }
    : viewportWorldBounds;

  const contentW = Math.max(bounds.maxX - bounds.minX, 1);
  const contentH = Math.max(bounds.maxY - bounds.minY, 1);
  const availW = MAP_WIDTH - PADDING * 2;
  const availH = MAP_HEIGHT - PADDING * 2;
  const scale = Math.min(availW / contentW, availH / contentH);
  const offsetX = PADDING + (availW - contentW * scale) / 2;
  const offsetY = PADDING + (availH - contentH * scale) / 2;

  const worldToMap = (p) => ({ x: offsetX + (p.x - bounds.minX) * scale, y: offsetY + (p.y - bounds.minY) * scale });
  const mapToWorld = (p) => ({ x: bounds.minX + (p.x - offsetX) / scale, y: bounds.minY + (p.y - offsetY) / scale });
  projectionRef.current = { worldToMap, mapToWorld };

  // Simplified object representations — real geometry, scaled down, not decoration.
  for (const obj of displayObjects.values()) {
    if (!obj.points || obj.points.length === 0) continue;
    if (obj.type === 'eraser') continue; // an erased area isn't a "thing" to show on the map
    ctx.save();
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.9;
    if ((obj.type === 'rect' || obj.type === 'circle' || obj.type === 'sticky' || obj.type === 'frame') && obj.points.length >= 2) {
      // Drawn ACTUALLY rotated (not just a simplified bounding box) — map obj.points
      // (always the LOCAL/unrotated definition, see canvas/geometry/rotation.js) into map
      // space, then apply the same translate/rotate/translate around their own center the
      // main Renderer uses, so a tilted rectangle (or sticky note — also rotatable, see
      // ROTATABLE_TYPES) reads as tilted on the mini-map too. worldToMap uses one uniform
      // `scale` for both axes (see below), so rotation degrees carry over unchanged from
      // world space into map space. Circles and frames never rotate (see ROTATABLE_TYPES),
      // so this is a no-op for them regardless.
      const [a, b] = obj.points.map(worldToMap);
      const rotation = obj.rotation ?? 0;
      if (rotation) {
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        ctx.translate(cx, cy);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.translate(-cx, -cy);
      }
      if (obj.fillEnabled && obj.fillColor) {
        ctx.globalAlpha = (obj.fillOpacity ?? 1) * 0.9;
        ctx.fillStyle = obj.fillColor;
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.globalAlpha = 0.9;
      }
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else {
      const mapped = obj.points.map(worldToMap);
      ctx.beginPath();
      ctx.moveTo(mapped[0].x, mapped[0].y);
      for (let i = 1; i < mapped.length; i++) ctx.lineTo(mapped[i].x, mapped[i].y);
      if (mapped.length === 1) ctx.lineTo(mapped[0].x + 0.5, mapped[0].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Other collaborators' viewport centers — optional, kept tiny and uncluttered.
  const selfId = usePresenceStore.getState().selfId;
  const users = usePresenceStore.getState().users;
  for (const [userId, vp] of useViewportStore.getState().viewports) {
    if (userId === selfId || !vp || typeof vp.x !== 'number' || typeof vp.y !== 'number' || !vp.scale) continue;
    const user = users.get(userId);
    const centerWorld = { x: (cssWidth / 2 - vp.x) / vp.scale, y: (cssHeight / 2 - vp.y) / vp.scale };
    const p = worldToMap(centerWorld);
    ctx.beginPath();
    ctx.fillStyle = user?.color ?? '#999';
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Current viewport rectangle.
  const vpTopLeft = worldToMap({ x: viewportWorldBounds.minX, y: viewportWorldBounds.minY });
  const vpBottomRight = worldToMap({ x: viewportWorldBounds.maxX, y: viewportWorldBounds.maxY });
  ctx.save();
  ctx.strokeStyle = '#6366F1';
  ctx.lineWidth = 1.5;
  ctx.fillStyle = 'rgba(99, 102, 241, 0.12)';
  const vx = vpTopLeft.x, vy = vpTopLeft.y, vw = vpBottomRight.x - vpTopLeft.x, vh = vpBottomRight.y - vpTopLeft.y;
  ctx.fillRect(vx, vy, vw, vh);
  ctx.strokeRect(vx, vy, vw, vh);
  ctx.restore();
}
