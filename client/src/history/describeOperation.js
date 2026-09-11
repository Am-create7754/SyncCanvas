/** Human-readable labels for the shapes an OBJECT_CREATE/STROKE_CREATE op might carry. */
const SHAPE_NAMES = {
  path: 'a stroke', eraser: 'an eraser stroke', line: 'a line', rect: 'a rectangle', circle: 'a circle',
  connector: 'a connector', sticky: 'a sticky note', frame: 'a frame',
};

function shapeLabel(type) {
  return SHAPE_NAMES[type] ?? 'an object';
}

function countedLabel(count, singular, plural = `${singular}s`) {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

function styleChangeLabel(op) {
  const patch = op.forward?.patches?.[0]?.patch ?? {};
  if ('fillColor' in patch || 'fillEnabled' in patch || 'fillOpacity' in patch) return 'changed fill';
  if ('color' in patch) return 'changed stroke color';
  if ('width' in patch) return 'changed stroke width';
  return 'changed style';
}

/**
 * Translates one canonical history operation into a short, human sentence for the
 * Activity Feed / timeline tooltips (Phase 9 #27 — never show raw event names like
 * "OBJECT_UPDATE ID: abc123"). Pure and side-effect-free so it's trivial to unit test.
 * @param {object} op
 * @returns {string}
 */
export function describeOperation(op) {
  const who = op.username || 'Someone';

  switch (op.type) {
    case 'OBJECT_CREATE': {
      const objects = op.forward?.objects ?? [];
      if (objects.length > 1) return `${who} created ${countedLabel(objects.length, 'object')}`;
      return `${who} created ${shapeLabel(objects[0]?.type)}`;
    }
    case 'STROKE_CREATE':
      return `${who} drew a stroke`;
    case 'OBJECT_DELETE': {
      const count = op.forward?.ids?.length ?? 1;
      return `${who} deleted ${countedLabel(count, 'object')}`;
    }
    case 'OBJECT_MOVE': {
      const count = op.forward?.patches?.length ?? 1;
      return count > 1 ? `${who} moved ${countedLabel(count, 'object')}` : `${who} moved an object`;
    }
    case 'OBJECT_RESIZE':
      return `${who} resized an object`;
    case 'OBJECT_ROTATE':
      return `${who} rotated an object`;
    case 'OBJECT_STYLE_CHANGE':
      return `${who} ${styleChangeLabel(op)}`;
    case 'GROUP':
      return `${who} grouped ${countedLabel(op.forward?.patches?.length ?? 2, 'object')}`;
    case 'UNGROUP':
      return `${who} ungrouped objects`;
    case 'ALIGN':
      return `${who} aligned objects`;
    case 'DISTRIBUTE':
      return `${who} distributed objects`;
    case 'LAYER_CHANGE':
      return `${who} changed layer order`;
    case 'CLEAR_CANVAS':
      return `${who} cleared the canvas${op.summary?.count ? ` (${op.summary.count} objects)` : ''}`;
    case 'DOCUMENT_IMPORT':
      return `${who} imported a document`;
    case 'DOCUMENT_RESTORE':
      return `${who} restored a previous version`;
    case 'CHECKPOINT_CREATED':
      return `${who} created checkpoint "${op.summary?.name ?? 'Untitled'}"`;
    default:
      return `${who} made a change`;
  }
}

/** Compact single-glyph markers for the timeline (Phase 9 #22) — never text labels, which
 *  would overwhelm a timeline with hundreds of operations. */
const MARKERS = {
  OBJECT_CREATE: '●', STROKE_CREATE: '●', OBJECT_DELETE: '×', OBJECT_MOVE: '●', OBJECT_RESIZE: '●', OBJECT_ROTATE: '●',
  OBJECT_STYLE_CHANGE: '●', GROUP: '●', UNGROUP: '●', ALIGN: '●', DISTRIBUTE: '●',
  LAYER_CHANGE: '●', CLEAR_CANVAS: '×', DOCUMENT_IMPORT: '⬆', DOCUMENT_RESTORE: '↺', CHECKPOINT_CREATED: '◆',
};

export function markerFor(op) {
  return MARKERS[op.type] ?? '●';
}

/** Only the "big" operation types get a visible timeline marker on their own — routine
 *  strokes/moves would otherwise put hundreds of dots on the same bar (Phase 9 #22: "Do
 *  not put 1000 labels on the screen"). */
const MAJOR_TYPES = new Set(['CLEAR_CANVAS', 'DOCUMENT_IMPORT', 'DOCUMENT_RESTORE', 'CHECKPOINT_CREATED']);

export function isMajorOperation(op) {
  return MAJOR_TYPES.has(op.type);
}
