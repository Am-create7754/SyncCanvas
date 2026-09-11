const RULER_SIZE = 20; // screen px — thickness of both ruler bars
const TARGET_TICK_SPACING_PX = 80; // aim for roughly this much screen space between labeled ticks
const BG_LIGHT = '#F9FAFB';
const BG_DARK = '#111827';
const LINE_LIGHT = 'rgba(15, 23, 42, 0.25)';
const LINE_DARK = 'rgba(255, 255, 255, 0.25)';
const TEXT_LIGHT = '#6B7280';
const TEXT_DARK = '#9CA3AF';
const HIGHLIGHT = '#6366F1'; // indigo — matches the app's selection color, for the viewport-relative "0" marks

/**
 * Picks a "nice" (1/2/5 * 10^n) world-unit interval between ruler ticks such that the
 * on-screen spacing stays close to `TARGET_TICK_SPACING_PX` regardless of zoom — the
 * standard ruler/graph-axis algorithm. This is what keeps labels from overlapping at high
 * zoom-out and from being wastefully dense at high zoom-in (spec #11).
 * @param {number} scale - viewport.scale (world-to-screen multiplier)
 * @returns {number} world-unit interval
 */
export function chooseRulerInterval(scale) {
  const rawWorldInterval = TARGET_TICK_SPACING_PX / scale;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawWorldInterval)));
  const candidates = [1, 2, 5, 10].map((m) => m * magnitude);
  return candidates.reduce((best, c) => (Math.abs(c - rawWorldInterval) < Math.abs(best - rawWorldInterval) ? c : best));
}

/**
 * Draws horizontal (top) and vertical (left) rulers showing WORLD coordinates, in screen
 * space (drawn after the world-space content, alongside cursors — see Renderer.render).
 * Ticks/labels always reflect pan+zoom correctly since every position is computed via
 * `worldToScreen`'s inverse (`(worldTick * scale) + viewport offset`) fresh each frame —
 * there's no cached tick state to go stale. Negative coordinates work identically to
 * positive ones; nothing here assumes a non-negative origin.
 */
export function drawRulers(ctx, { viewport, cssWidth, cssHeight, dark = false }) {
  const bg = dark ? BG_DARK : BG_LIGHT;
  const line = dark ? LINE_DARK : LINE_LIGHT;
  const text = dark ? TEXT_DARK : TEXT_LIGHT;
  const interval = chooseRulerInterval(viewport.scale);

  ctx.save();
  ctx.font = '10px Inter, ui-sans-serif, sans-serif';
  ctx.textBaseline = 'middle';

  // ---- horizontal ruler (top) ----
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cssWidth, RULER_SIZE);
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const firstWorldX = Math.floor(-viewport.x / viewport.scale / interval) * interval;
  for (let worldX = firstWorldX; ; worldX += interval) {
    const screenX = worldX * viewport.scale + viewport.x;
    if (screenX > cssWidth) break;
    if (screenX < RULER_SIZE) continue;
    ctx.moveTo(Math.round(screenX) + 0.5, RULER_SIZE - 6);
    ctx.lineTo(Math.round(screenX) + 0.5, RULER_SIZE);
  }
  ctx.stroke();
  ctx.fillStyle = text;
  for (let worldX = firstWorldX; ; worldX += interval) {
    const screenX = worldX * viewport.scale + viewport.x;
    if (screenX > cssWidth) break;
    if (screenX < RULER_SIZE) continue;
    ctx.fillText(String(Math.round(worldX)), screenX + 3, RULER_SIZE / 2);
  }

  // ---- vertical ruler (left) ----
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, RULER_SIZE, cssHeight);
  ctx.strokeStyle = line;
  ctx.beginPath();
  const firstWorldY = Math.floor(-viewport.y / viewport.scale / interval) * interval;
  for (let worldY = firstWorldY; ; worldY += interval) {
    const screenY = worldY * viewport.scale + viewport.y;
    if (screenY > cssHeight) break;
    if (screenY < RULER_SIZE) continue;
    ctx.moveTo(RULER_SIZE - 6, Math.round(screenY) + 0.5);
    ctx.lineTo(RULER_SIZE, Math.round(screenY) + 0.5);
  }
  ctx.stroke();
  ctx.fillStyle = text;
  ctx.save();
  for (let worldY = firstWorldY; ; worldY += interval) {
    const screenY = worldY * viewport.scale + viewport.y;
    if (screenY > cssHeight) break;
    if (screenY < RULER_SIZE) continue;
    ctx.save();
    ctx.translate(RULER_SIZE / 2, screenY - 3);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'left';
    ctx.fillText(String(Math.round(worldY)), 0, 0);
    ctx.restore();
  }
  ctx.restore();

  // ---- corner + world-origin highlight (helps orient "where is (0,0)") ----
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE);
  const originScreen = { x: 0 * viewport.scale + viewport.x, y: 0 * viewport.scale + viewport.y };
  ctx.fillStyle = HIGHLIGHT;
  if (originScreen.x >= RULER_SIZE && originScreen.x <= cssWidth) ctx.fillRect(originScreen.x - 0.5, 0, 1, RULER_SIZE);
  if (originScreen.y >= RULER_SIZE && originScreen.y <= cssHeight) ctx.fillRect(0, originScreen.y - 0.5, RULER_SIZE, 1);

  ctx.restore();
}
