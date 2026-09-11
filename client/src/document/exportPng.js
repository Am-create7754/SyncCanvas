import { drawObject } from '../canvas/rendering/drawObject.js';
import { boundsOfObjects } from '../canvas/geometry/objectBounds.js';
import { getObjectCenter } from '../canvas/geometry/rotation.js';

const PADDING = 40;
// A hard cap on export dimensions — 6000x6000 is already a 144-megapixel bitmap (~576MB
// of raw RGBA), far more than any browser should allocate on request. Content larger than
// this gets scaled down proportionally rather than refused outright.
const MAX_EXPORT_DIMENSION = 6000;

const THEME_BACKGROUNDS = { white: '#ffffff', dark: '#0a0a0f' };

/**
 * Rasterizes the persistent drawing (not the UI chrome around it) to a PNG Blob. Reuses
 * `drawObject` — the exact same per-object rendering function the main canvas and the
 * mini-map call — so export can never visually diverge from what's actually on screen.
 * Objects are drawn in the same Map (insertion) order as the live canvas, which is what
 * makes eraser strokes (destination-out) cut only what was drawn before them, correctly.
 * @param {Map<string, object>} objectsMap
 * @param {{background?: 'transparent'|'white'|'dark'}} options
 * @returns {Promise<{blob: Blob, scaledDown: boolean}|null>} null if there's nothing to export
 */
export async function exportCanvasAsPng(objectsMap, { background = 'white' } = {}) {
  const bounds = boundsOfObjects(objectsMap);
  if (!bounds) return null;

  const contentWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const contentHeight = Math.max(bounds.maxY - bounds.minY, 1);
  let width = Math.ceil(contentWidth + PADDING * 2);
  let height = Math.ceil(contentHeight + PADDING * 2);

  let downscale = 1;
  const largestDimension = Math.max(width, height);
  if (largestDimension > MAX_EXPORT_DIMENSION) {
    downscale = MAX_EXPORT_DIMENSION / largestDimension;
    width = Math.round(width * downscale);
    height = Math.round(height * downscale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (background !== 'transparent') {
    ctx.fillStyle = THEME_BACKGROUNDS[background] ?? THEME_BACKGROUNDS.white;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.translate(PADDING * downscale, PADDING * downscale);
  ctx.scale(downscale, downscale);
  ctx.translate(-bounds.minX, -bounds.minY);

  for (const obj of objectsMap.values()) {
    const rotation = obj.rotation ?? 0;
    if (!rotation) { drawObject(ctx, obj); continue; }
    const center = getObjectCenter(obj);
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-center.x, -center.y);
    drawObject(ctx, obj);
    ctx.restore();
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { blob, scaledDown: downscale < 1 };
}
