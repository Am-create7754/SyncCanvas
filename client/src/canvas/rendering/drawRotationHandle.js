const HANDLE_RADIUS = 5; // screen px

/** Draws the rotation handle (a small circle above the selection, connected to the bbox
 *  by a thin stalk) and, while actively rotating, a live angle readout. Called from inside
 *  the same per-object rotated transform the selection box/resize handles use, so the
 *  handle's LOCAL position (already computed by getRotationHandlePosition, unrotated) is
 *  what's passed in here — the surrounding ctx.rotate takes care of making it track the
 *  object's current rotation on screen. */
export function drawRotationHandle(ctx, localHandlePos, stalkFromY, stalkX, { color, scale = 1, angleLabel }) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 / scale;
  ctx.beginPath();
  ctx.moveTo(stalkX, stalkFromY);
  ctx.lineTo(localHandlePos.x, localHandlePos.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.fillStyle = 'white';
  ctx.arc(localHandlePos.x, localHandlePos.y, HANDLE_RADIUS / scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  if (angleLabel !== undefined && angleLabel !== null) {
    ctx.save();
    ctx.font = `600 ${11 / scale}px Inter, ui-sans-serif, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${Math.round(angleLabel)}°`, localHandlePos.x, localHandlePos.y - 10 / scale);
    ctx.restore();
  }
}
