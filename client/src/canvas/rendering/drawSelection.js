import { boundsOfPoints } from '../geometry/points.js';

const PADDING = 8;

/**
 * Draws a bounding-box outline around a selected object, in world space so it tracks the
 * object through pan/zoom automatically. `label` (when given) draws a small name badge
 * above the box — used for remote selections so everyone can see *who* has something
 * selected, not just that it's selected.
 */
export function drawSelectionBox(ctx, object, { color, dashed = false, label, scale = 1, weight = 2 }) {
  if (!object || object.points.length === 0) return;
  const { minX, minY, maxX, maxY } = boundsOfPoints(object.points);
  const x = minX - PADDING / scale;
  const y = minY - PADDING / scale;
  const w = maxX - minX + (PADDING * 2) / scale;
  const h = maxY - minY + (PADDING * 2) / scale;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = weight / scale;
  if (dashed) ctx.setLineDash([6 / scale, 4 / scale]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();

  if (label) {
    ctx.save();
    ctx.font = `600 ${11 / scale}px Inter, ui-sans-serif, sans-serif`;
    const textWidth = ctx.measureText(label).width;
    const padX = 5 / scale;
    const tagH = 16 / scale;
    const tagY = y - tagH - 3 / scale;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, tagY, textWidth + padX * 2, tagH, 4 / scale);
    ctx.fill();

    ctx.fillStyle = 'white';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + padX, tagY + tagH / 2 + 0.5 / scale);
    ctx.restore();
  }
}

/** Draws a bounding-box outline directly from world-space bounds (rather than a single
 *  object's points) — used for the combined multi-selection box, where there's no one
 *  object to derive it from. */
export function drawBoundsBox(ctx, bounds, { color, scale = 1 }) {
  if (!bounds) return;
  const { minX, minY, maxX, maxY } = bounds;
  const x = minX - PADDING / scale;
  const y = minY - PADDING / scale;
  const w = maxX - minX + (PADDING * 2) / scale;
  const h = maxY - minY + (PADDING * 2) / scale;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 / scale;
  ctx.setLineDash([5 / scale, 3 / scale]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

const HANDLE_SCREEN_SIZE = 8; // px — kept visually constant regardless of zoom

/** Draws resize handles (world-space positions, screen-constant size) around a selected
 *  shape. Purely an interaction affordance — ephemeral overlay, never exported/persisted. */
export function drawResizeHandles(ctx, handles, { color, scale = 1 }) {
  const half = HANDLE_SCREEN_SIZE / 2 / scale;
  ctx.save();
  ctx.lineWidth = 1.5 / scale;
  ctx.strokeStyle = color;
  ctx.fillStyle = 'white';
  for (const h of handles) {
    ctx.beginPath();
    ctx.rect(h.x - half, h.y - half, half * 2, half * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Draws the marquee-select rectangle while the user is drag-selecting on empty canvas —
 *  purely ephemeral UI, never exported or persisted. */
export function drawMarquee(ctx, rect, { scale = 1 } = {}) {
  if (!rect) return;
  const { minX, minY, maxX, maxY } = rect;
  ctx.save();
  ctx.fillStyle = 'rgba(99, 102, 241, 0.12)';
  ctx.strokeStyle = '#6366F1';
  ctx.lineWidth = 1 / scale;
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
  ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
  ctx.restore();
}
