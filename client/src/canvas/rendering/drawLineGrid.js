const MIN_SCREEN_SPACING = 6; // below this, lines would just be visual noise — skip entirely
const LINE_COLOR_LIGHT = 'rgba(15, 23, 42, 0.10)';
const LINE_COLOR_DARK = 'rgba(255, 255, 255, 0.12)';

/**
 * The user-toggleable functional grid (Phase 11) — distinct from the always-on decorative
 * dot texture (`drawGrid.js`, Phase 1). This one draws actual lines at `gridSize` world
 * units and exists to make Snap-to-Grid's target intervals visible, not just decorative.
 *
 * Same O(visible screen area) technique as the dot grid: lines are placed via
 * `viewport.x/y mod spacing` in a single untransformed (screen-space) pass, so cost never
 * depends on how far the content spans — it never iterates world coordinates, which is
 * what keeps it cheap even at extreme zoom-out (spec #6/#28).
 */
export function drawLineGrid(ctx, { viewport, cssWidth, cssHeight, gridSize, dark = false }) {
  const spacing = gridSize * viewport.scale;
  if (spacing < MIN_SCREEN_SPACING) return;

  const offsetX = ((viewport.x % spacing) + spacing) % spacing;
  const offsetY = ((viewport.y % spacing) + spacing) % spacing;

  ctx.save();
  ctx.strokeStyle = dark ? LINE_COLOR_DARK : LINE_COLOR_LIGHT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = offsetX; x < cssWidth; x += spacing) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, cssHeight);
  }
  for (let y = offsetY; y < cssHeight; y += spacing) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(cssWidth, Math.round(y) + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}
