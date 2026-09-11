const WORLD_SPACING = 32; // dot spacing in world units
const MIN_SCREEN_SPACING = 8; // below this, dots would just look like noise — skip them
const DOT_RADIUS = 1.1;
const DOT_COLOR_LIGHT = 'rgba(15, 23, 42, 0.08)';
const DOT_COLOR_DARK = 'rgba(255, 255, 255, 0.10)';

/**
 * Draws a subtle dot grid anchored to world space, in a single untransformed
 * (screen-space) pass so dots stay a constant visual size at any zoom level instead of
 * scaling with content. The grid's screen offset is derived straight from the viewport's
 * pan (`viewport.x/y mod spacing`), which is what makes it track panning/zooming without
 * ever iterating actual world coordinates — cost stays O(visible screen area).
 */
export function drawGrid(ctx, { viewport, cssWidth, cssHeight, dark = false }) {
  const spacing = WORLD_SPACING * viewport.scale;
  if (spacing < MIN_SCREEN_SPACING) return;

  const offsetX = ((viewport.x % spacing) + spacing) % spacing;
  const offsetY = ((viewport.y % spacing) + spacing) % spacing;

  ctx.save();
  ctx.fillStyle = dark ? DOT_COLOR_DARK : DOT_COLOR_LIGHT;
  for (let x = offsetX; x < cssWidth; x += spacing) {
    for (let y = offsetY; y < cssHeight; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
