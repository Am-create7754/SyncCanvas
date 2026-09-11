import { getAllAnchorPoints } from '../geometry/connector.js';

/**
 * Ephemeral Connector-tool overlay (Phase 12) — anchor dots on hover, plus the live
 * preview line while dragging from one anchor toward another. Nothing drawn here is ever
 * part of a persisted object; same "draw straight from engine ephemeral state, never
 * touch this.objects" treatment as drawSmartGuides/drawSelection.
 */

const CONNECTOR_ACCENT = '#0D9488'; // teal — distinct from indigo-selection/pink-guides/amber-conflict/red-lock
const ANCHOR_RADIUS_SCREEN = 4;
const ANCHOR_RADIUS_HOVER_SCREEN = 6;

/** Draws the 4 cardinal anchor dots for `shape` — the hover-reveal affordance shown while
 *  the Connector tool is active and the pointer is near a connectable shape.
 *  `activeAnchor` (if given) renders larger/filled, showing which one the pointer would
 *  currently grab or snap to. */
export function drawConnectorAnchors(ctx, shape, scale, activeAnchor = null) {
  ctx.save();
  for (const { anchor, point } of getAllAnchorPoints(shape)) {
    const isActive = anchor === activeAnchor;
    const r = (isActive ? ANCHOR_RADIUS_HOVER_SCREEN : ANCHOR_RADIUS_SCREEN) / scale;
    ctx.beginPath();
    ctx.arc(point.x, point.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? CONNECTOR_ACCENT : '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 1.5 / scale;
    ctx.strokeStyle = CONNECTOR_ACCENT;
    ctx.stroke();
  }
  ctx.restore();
}

/** Draws the live in-progress connector line from the grabbed start anchor to either the
 *  currently-snapped target anchor (solid, since releasing here would create a real
 *  connector) or the raw pointer position (dashed, since releasing here cancels). */
export function drawConnectorDraft(ctx, startPoint, draft, hoverTarget, scale) {
  const endPoint = hoverTarget ? hoverTarget.point : draft.currentPoint;
  ctx.save();
  ctx.strokeStyle = CONNECTOR_ACCENT;
  ctx.lineWidth = 2 / scale;
  ctx.setLineDash(hoverTarget ? [] : [6 / scale, 4 / scale]);
  ctx.beginPath();
  ctx.moveTo(startPoint.x, startPoint.y);
  ctx.lineTo(endPoint.x, endPoint.y);
  ctx.stroke();

  const r = ANCHOR_RADIUS_HOVER_SCREEN / scale;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(startPoint.x, startPoint.y, r, 0, Math.PI * 2);
  ctx.fillStyle = CONNECTOR_ACCENT;
  ctx.fill();

  if (hoverTarget) {
    ctx.beginPath();
    ctx.arc(endPoint.x, endPoint.y, r, 0, Math.PI * 2);
    ctx.fillStyle = CONNECTOR_ACCENT;
    ctx.fill();
  }
  ctx.restore();
}
