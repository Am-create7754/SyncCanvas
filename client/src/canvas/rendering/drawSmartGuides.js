const GUIDE_COLOR = '#EC4899'; // pink — deliberately distinct from the indigo selection/lock colors
const MEASUREMENT_COLOR = '#EC4899';

/** Draws temporary alignment guide lines (Phase 11) — a thin line spanning the extent
 *  shared by the dragged object and whichever object it aligned with. World-space, called
 *  from inside the same translate/scale transform selection boxes already use, so line
 *  width/dash need the usual `/scale` correction to stay screen-constant. Purely ephemeral:
 *  CanvasEngine clears `activeGuides` the instant a drag ends — nothing here is ever saved. */
export function drawSmartGuides(ctx, guides, scale) {
  if (!guides || guides.length === 0) return;
  ctx.save();
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.lineWidth = 1 / scale;
  ctx.setLineDash([4 / scale, 3 / scale]);
  for (const guide of guides) {
    ctx.beginPath();
    if (guide.axis === 'v') {
      ctx.moveTo(guide.position, guide.extentMin);
      ctx.lineTo(guide.position, guide.extentMax);
    } else {
      ctx.moveTo(guide.extentMin, guide.position);
      ctx.lineTo(guide.extentMax, guide.position);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Draws a distance callout between two nearby objects — a dashed connector line plus a
 *  centered "48" label — for each ephemeral measurement CanvasEngine computed this frame. */
export function drawMeasurements(ctx, measurements, scale) {
  if (!measurements || measurements.length === 0) return;
  ctx.save();
  ctx.strokeStyle = MEASUREMENT_COLOR;
  ctx.fillStyle = MEASUREMENT_COLOR;
  ctx.lineWidth = 1 / scale;
  ctx.font = `600 ${11 / scale}px Inter, ui-sans-serif, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const m of measurements) {
    const label = `${Math.round(m.distance)}`;
    ctx.beginPath();
    if (m.axis === 'x') {
      ctx.moveTo(m.from, m.at);
      ctx.lineTo(m.to, m.at);
      ctx.stroke();
      drawLabelBadge(ctx, (m.from + m.to) / 2, m.at, label, scale);
    } else {
      ctx.moveTo(m.at, m.from);
      ctx.lineTo(m.at, m.to);
      ctx.stroke();
      drawLabelBadge(ctx, m.at, (m.from + m.to) / 2, label, scale);
    }
  }
  ctx.restore();
}

function drawLabelBadge(ctx, x, y, text, scale) {
  const padX = 5 / scale;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 14 / scale;
  ctx.save();
  ctx.fillStyle = MEASUREMENT_COLOR;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 3 / scale);
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.fillText(text, x, y + 0.5 / scale);
  ctx.restore();
}
