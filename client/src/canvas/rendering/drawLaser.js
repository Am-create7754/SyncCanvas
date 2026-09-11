export const LASER_FADE_MS = 1500;

/**
 * Draws one user's laser trail as a fading polyline with a bright head dot. Runs in the
 * world-transformed pass so points inherently track pan/zoom like everything else — the
 * fade itself is purely a function of `performance.now() - point.t`, recomputed every
 * frame, so no timers are needed to "finish" the animation; a trail with no fresh points
 * simply fades to nothing and CanvasEngine prunes it once every point has expired.
 */
export function drawLaser(ctx, trail, color, now) {
  if (trail.length === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 1; i < trail.length; i++) {
    const point = trail[i];
    const age = now - point.t;
    if (age >= LASER_FADE_MS) continue;
    const alpha = 1 - age / LASER_FADE_MS;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha * 0.7;
    ctx.lineWidth = 3 + alpha * 2;
    ctx.beginPath();
    ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  const head = trail[trail.length - 1];
  const headAge = now - head.t;
  if (headAge < LASER_FADE_MS) {
    const alpha = 1 - headAge / LASER_FADE_MS;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(head.x, head.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
