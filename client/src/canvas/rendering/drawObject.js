import { connectorLabelPosition, finalSegmentAngle, firstSegmentAngle } from '../geometry/connector.js';

/** Draws one CanvasObject into a context already transformed into world space. */
export function drawObject(ctx, object) {
  const { type, points, color, width, fillEnabled, fillColor, fillOpacity } = object;
  if (!points || points.length === 0) return;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = width;

  if (type === 'eraser') {
    // destination-out cuts existing painted pixels rather than adding new color, so an
    // eraser stroke only affects whatever was drawn *before* it in the object list.
    ctx.globalCompositeOperation = 'destination-out';
  }

  const fillOpts = { fillEnabled, fillColor, fillOpacity };

  if (type === 'path' || type === 'eraser') {
    drawPath(ctx, points);
  } else if (type === 'line') {
    drawLine(ctx, points);
  } else if (type === 'rect') {
    drawRect(ctx, points, fillOpts);
  } else if (type === 'circle') {
    drawCircle(ctx, points, fillOpts);
  } else if (type === 'connector') {
    drawConnector(ctx, object);
  } else if (type === 'sticky') {
    drawSticky(ctx, object);
  } else if (type === 'frame') {
    drawFrame(ctx, object);
  }

  ctx.restore();
}

function drawPath(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 1) {
    // A single-point stroke (a tap) still renders as a dot.
    ctx.lineTo(points[0].x + 0.01, points[0].y);
  }
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

function drawLine(ctx, points) {
  if (points.length < 2) return;
  const [a, b] = points;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/**
 * Fills (if enabled) then strokes whatever path is already current on `ctx`. Fill and
 * stroke share one path so they align pixel-for-pixel; opacity is scoped to the fill via
 * its own save/restore so the border always renders fully opaque regardless of fill
 * opacity, and so it can never leak into whatever gets drawn next.
 */
function fillThenStroke(ctx, { fillEnabled, fillColor, fillOpacity }) {
  if (fillEnabled && fillColor) {
    ctx.save();
    ctx.globalAlpha = fillOpacity ?? 1;
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.restore();
  }
  ctx.stroke();
}

function drawRect(ctx, points, fillOpts) {
  if (points.length < 2) return;
  const [a, b] = points;
  ctx.beginPath();
  ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  fillThenStroke(ctx, fillOpts);
}

function drawCircle(ctx, points, fillOpts) {
  if (points.length < 2) return;
  const [a, b] = points;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  fillThenStroke(ctx, fillOpts);
}

// ---- Phase 12: diagramming objects ----

const ARROW_LENGTH_MULTIPLIER = 3; // arrowhead length, in multiples of stroke width
const ARROW_MIN_LENGTH = 8; // world units — keeps a thin connector's arrowhead visible

function drawArrowhead(ctx, tip, angleDegrees, length, color) {
  const rad = (angleDegrees * Math.PI) / 180;
  ctx.save();
  ctx.translate(tip.x, tip.y);
  ctx.rotate(rad);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-length, -length * 0.45);
  ctx.lineTo(-length, length * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A connector's `points` is already the fully-routed polyline (straight or elbow — see
 *  canvas/geometry/connector.js), so the LINE itself is just a generic polyline stroke,
 *  identical in kind to a freehand path. Arrowheads and the optional label are the only
 *  connector-specific drawing on top of that. */
function drawConnector(ctx, object) {
  const { points, color, width, arrowStart, arrowEnd, label } = object;
  if (points.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();

  const arrowLength = Math.max(width * ARROW_LENGTH_MULTIPLIER, ARROW_MIN_LENGTH);
  if (arrowEnd) drawArrowhead(ctx, points[points.length - 1], finalSegmentAngle(points), arrowLength, color);
  if (arrowStart) drawArrowhead(ctx, points[0], firstSegmentAngle(points), arrowLength, color);

  if (label) {
    const pos = connectorLabelPosition(points);
    ctx.save();
    ctx.font = '600 14px Inter, ui-sans-serif, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const padX = 6;
    const padY = 3;
    const textWidth = ctx.measureText(label).width;
    const badgeHeight = 14 + padY * 2;
    // A light, theme-agnostic badge (not the app's dark/light chrome — this is PERSISTENT
    // object content, so it stays the same regardless of the viewer's theme, same as the
    // shape's own stroke/fill color already does).
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(pos.x - textWidth / 2 - padX, pos.y - badgeHeight / 2, textWidth + padX * 2, badgeHeight, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1F2937';
    ctx.fillText(label, pos.x, pos.y + 0.5);
    ctx.restore();
  }
}

const STICKY_CORNER_RADIUS = 6;
const STICKY_TEXT_PADDING = 12;
const STICKY_LINE_HEIGHT = 18;
const STICKY_FONT = '13px Inter, ui-sans-serif, sans-serif';
const STICKY_TEXT_COLOR = '#1F2937'; // persistent object content — deliberately theme-independent, see drawConnector's label

function drawSticky(ctx, object) {
  const { points, fillEnabled, fillColor, fillOpacity, text } = object;
  if (points.length < 2) return;
  const [a, b] = points;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);

  ctx.beginPath();
  ctx.roundRect(x, y, w, h, STICKY_CORNER_RADIUS);
  ctx.save();
  ctx.fillStyle = fillEnabled && fillColor ? fillColor : '#FEF3C7';
  ctx.globalAlpha = fillOpacity ?? 1;
  ctx.fill();
  ctx.restore();
  ctx.stroke();

  if (text) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h); // clip so wrapped text can never spill outside the note
    ctx.clip();
    ctx.font = STICKY_FONT;
    ctx.fillStyle = STICKY_TEXT_COLOR;
    ctx.textBaseline = 'top';
    const lines = wrapText(ctx, text, w - STICKY_TEXT_PADDING * 2);
    lines.forEach((line, i) => {
      ctx.fillText(line, x + STICKY_TEXT_PADDING, y + STICKY_TEXT_PADDING + i * STICKY_LINE_HEIGHT);
    });
    ctx.restore();
  }
}

/** Splits `text` into lines that fit `maxWidth`, honoring the author's own line breaks
 *  first — basic word wrap via `ctx.measureText`, no HTML/layout engine involved. */
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(''); continue; }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (ctx.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = words[i];
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

const FRAME_BORDER_COLOR = 'rgba(100, 116, 139, 0.6)'; // slate — theme-independent, see drawSticky
const FRAME_TITLE_COLOR = '#334155';

/** A frame is deliberately understated — a thin border + a faint fill + a title label —
 *  it organizes a diagram visually, it isn't itself a diagram element (spec #25/#26). */
function drawFrame(ctx, object) {
  const { points, fillEnabled, fillColor, fillOpacity, title } = object;
  if (points.length < 2) return;
  const [a, b] = points;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);

  if (fillEnabled && fillColor) {
    ctx.save();
    ctx.globalAlpha = (fillOpacity ?? 1) * 0.5; // always subtle, regardless of the chosen opacity
    ctx.fillStyle = fillColor;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = FRAME_BORDER_COLOR;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();

  if (title) {
    ctx.save();
    ctx.font = '600 13px Inter, ui-sans-serif, sans-serif';
    ctx.fillStyle = FRAME_TITLE_COLOR;
    ctx.textBaseline = 'bottom';
    ctx.fillText(title, x, y - 6);
    ctx.restore();
  }
}
