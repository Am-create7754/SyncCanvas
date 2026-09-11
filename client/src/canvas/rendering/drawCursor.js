/** Draws one remote cursor (arrow + name tag) at a screen-space point. Size is fixed in
 *  CSS pixels regardless of zoom, which is why this runs in a separate untransformed pass. */
export function drawCursor(ctx, { x, y }, { username, color }) {
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = color;
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 14);
  ctx.lineTo(4, 11);
  ctx.lineTo(7, 17);
  ctx.lineTo(9.5, 15.5);
  ctx.lineTo(6.5, 9.5);
  ctx.lineTo(11, 9.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const label = username ?? 'Guest';
  ctx.font = '600 12px Inter, ui-sans-serif, sans-serif';
  const textWidth = ctx.measureText(label).width;
  const padX = 6;
  const tagX = 14;
  const tagY = 16;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(tagX, tagY, textWidth + padX * 2, 20, 6);
  ctx.fill();

  ctx.fillStyle = 'white';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, tagX + padX, tagY + 10);

  ctx.restore();
}
