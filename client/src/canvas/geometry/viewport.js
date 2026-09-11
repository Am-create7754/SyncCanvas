export const MIN_SCALE = 0.1; // 10%
export const MAX_SCALE = 5; // 500%

/** @returns {number} scale clamped to the allowed zoom range. */
export function clampScale(scale) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Converts a point in screen (CSS-pixel, canvas-relative) space to world space. */
export function screenToWorld(point, viewport) {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

/** Converts a point in world space to screen (CSS-pixel, canvas-relative) space. */
export function worldToScreen(point, viewport) {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  };
}

/**
 * Returns the viewport that keeps `screenAnchor` pointing at the same world position
 * after the scale changes — i.e. zoom-to-cursor instead of zoom-to-origin.
 */
export function zoomAround(viewport, screenAnchor, nextScale) {
  const clamped = clampScale(nextScale);
  const worldAnchor = screenToWorld(screenAnchor, viewport);
  return {
    scale: clamped,
    x: screenAnchor.x - worldAnchor.x * clamped,
    y: screenAnchor.y - worldAnchor.y * clamped,
  };
}
