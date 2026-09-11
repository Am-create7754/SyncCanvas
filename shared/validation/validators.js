import { LIMITS } from '../constants/limits.js';
import {
  TOOL_TYPES, STYLE_FIELDS, HISTORY_OP_TYPES, BATCH_OP_TYPES,
  CONNECTOR_ANCHORS, CONNECTOR_ROUTINGS, CONNECTOR_PATCH_FIELDS,
  FONT_SIZES, FONT_FAMILIES, TEXT_ALIGNMENTS, TEXT_PATCH_FIELDS,
} from '../constants/events.js';

const ALLOWED_OBJECT_KEYS = new Set([
  'id', 'type', 'userId', 'color', 'width', 'points', 'fillEnabled', 'fillColor', 'fillOpacity', 'createdAt', 'groupId', 'revision', 'rotation',
  // Phase 12 diagramming fields — only meaningful (and only ever present) on their own
  // object type; isValidCanvasObject's per-type checks below enforce that, not this whitelist.
  'start', 'end', 'routing', 'arrowStart', 'arrowEnd', 'label', 'text', 'title',
  // Final polish phase — text content + formatting, valid on TEXT_CAPABLE_TYPES.
  'fontSize', 'fontFamily', 'bold', 'italic', 'underline', 'textAlign', 'textColor',
]);
const ALLOWED_METADATA_KEYS = new Set(['name', 'createdAt', 'updatedAt']);
/** Fields a batch-update (move/resize/rotate/align/distribute/group/ungroup/connector-
 *  attributes/sticky-text/frame-title/shape-or-standalone-text) is allowed to touch on an
 *  existing object — geometry + grouping + rotation + style + the Phase 12 diagramming
 *  fields + text content/formatting, so one validator covers every multi-object
 *  transaction regardless of object type. */
const BATCH_PATCH_FIELDS = ['points', 'groupId', 'rotation', ...STYLE_FIELDS, ...CONNECTOR_PATCH_FIELDS, ...TEXT_PATCH_FIELDS, 'title'];
const REORDER_OPS = new Set(['front', 'back', 'forward', 'backward']);

const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);

const inCoordRange = (n) => isFiniteNum(n) && n >= LIMITS.MIN_COORD && n <= LIMITS.MAX_COORD;

/** @returns {boolean} true if `p` is a well-formed {x,y} point within room bounds. */
export function isValidPoint(p) {
  return !!p && typeof p === 'object' && inCoordRange(p.x) && inCoordRange(p.y);
}

/** @returns {boolean} true if `points` is a non-empty array of valid points under the size cap. */
export function isValidPointArray(points, maxLen = LIMITS.MAX_POINTS_PER_OBJECT) {
  return (
    Array.isArray(points) &&
    points.length > 0 &&
    points.length <= maxLen &&
    points.every(isValidPoint)
  );
}

/** @returns {boolean} true if `color` is a 3/4/6/8-digit hex color string. */
export function isValidColor(color) {
  return typeof color === 'string' && /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color);
}

/** @returns {boolean} true if `width` is a stroke width within allowed bounds. */
export function isValidStrokeWidth(width) {
  return isFiniteNum(width) && width >= LIMITS.MIN_STROKE_WIDTH && width <= LIMITS.MAX_STROKE_WIDTH;
}

/** @returns {boolean} true if `type` is a recognized drawing tool type. */
export function isValidToolType(type) {
  return Object.values(TOOL_TYPES).includes(type);
}

/** @returns {boolean} true if `roomId` matches the expected generated room-id shape. */
export function isValidRoomId(roomId) {
  return typeof roomId === 'string' && /^[a-zA-Z0-9]{4,10}$/.test(roomId);
}

/** @returns {boolean} true if `username` is a safe, bounded display name. */
export function isValidUsername(username) {
  return (
    typeof username === 'string' &&
    username.trim().length >= LIMITS.USERNAME_MIN_LEN &&
    username.length <= LIMITS.USERNAME_MAX_LEN
  );
}

/** Strips characters that have no business in a plain-text display name. */
export function sanitizeUsername(username) {
  return String(username).trim().slice(0, LIMITS.USERNAME_MAX_LEN).replace(/[<>]/g, '');
}

/** @returns {boolean} true if `id` looks like a nanoid/uuid-shaped identifier. */
export function isValidId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(id);
}

/** @returns {boolean} true if `id` is either a valid object id or explicitly null (deselect). */
export function isValidNullableId(id) {
  return id === null || isValidId(id);
}

/** @returns {boolean} true if `scale` is a finite zoom factor within sane bounds. */
export function isValidZoom(scale) {
  return isFiniteNum(scale) && scale >= LIMITS.MIN_ZOOM && scale <= LIMITS.MAX_ZOOM;
}

/** @returns {boolean} true if `viewport` has a valid {x,y,scale} shape (x/y reuse the
 *  room's coordinate bounds since a viewport offset is just a point in the same space). */
export function isValidViewport(viewport) {
  return !!viewport && typeof viewport === 'object' && inCoordRange(viewport.x) && inCoordRange(viewport.y) && isValidZoom(viewport.scale);
}

/** @returns {boolean} true if `opacity` is a finite fraction in [0, 1]. */
export function isValidOpacity(opacity) {
  return isFiniteNum(opacity) && opacity >= 0 && opacity <= 1;
}

/** @returns {boolean} true if `degrees` is a finite rotation angle already normalized to
 *  [0, 360) — the one place a rotation is ever produced (CanvasEngine's normalizeRotation)
 *  always yields a value in this range, so anything outside it is rejected rather than
 *  silently re-normalized, same "never quietly reinterpret a malformed value" discipline
 *  every other validator here follows. */
export function isValidRotation(degrees) {
  return isFiniteNum(degrees) && degrees >= 0 && degrees < 360;
}

// ---- Phase 12: diagramming (connectors / sticky notes / frames) ----

/** @returns {boolean} true if `anchor` is one of the four cardinal connection points. */
export function isValidAnchor(anchor) {
  return CONNECTOR_ANCHORS.includes(anchor);
}

/** @returns {boolean} true if `endpoint` is a well-formed connector endpoint
 *  `{objectId, anchor}` — note this only checks *shape*, never that `objectId` actually
 *  exists in the room; that's Room's job (same trust boundary as `groupId`, which is
 *  similarly never existence-checked at the validator layer). */
export function isValidConnectorEndpoint(endpoint) {
  return !!endpoint && typeof endpoint === 'object' && isValidId(endpoint.objectId) && isValidAnchor(endpoint.anchor);
}

/** @returns {boolean} true if `routing` is a recognized connector routing mode. */
export function isValidRouting(routing) {
  return CONNECTOR_ROUTINGS.includes(routing);
}

/** @returns {boolean} true if `label` is a safe, bounded connector label. Unlike a
 *  checkpoint name, an EMPTY label is valid (removing a label is a legitimate edit). */
export function isValidConnectorLabel(label) {
  return typeof label === 'string' && label.length <= LIMITS.MAX_CONNECTOR_LABEL_LEN && !/[<>]/.test(label);
}

/** @returns {boolean} true if `text` is safe, bounded sticky-note text. Multi-line (word
 *  wrap is a rendering concern, not a validation one), so newlines are allowed. */
export function isValidStickyText(text) {
  return typeof text === 'string' && text.length <= LIMITS.MAX_STICKY_TEXT_LEN && !/[<>]/.test(text);
}

/** @returns {boolean} true if `title` is a safe, bounded frame title. */
export function isValidFrameTitle(title) {
  return typeof title === 'string' && title.length <= LIMITS.MAX_FRAME_TITLE_LEN && !/[<>]/.test(title);
}

// ---- Final polish phase: text content + formatting (standalone text objects, and text
// embedded inside a shape — see TEXT_CAPABLE_TYPES) ----

/** @returns {boolean} true if `text` is safe, bounded text content — reused for a
 *  standalone text object's own text and for text embedded inside a shape (the same
 *  bound sticky notes already used, extended to every TEXT_CAPABLE_TYPES member). */
export function isValidObjectText(text) {
  return isValidStickyText(text);
}

/** @returns {boolean} true if `size` is one of the fixed, canvas-safe font sizes. */
export function isValidFontSize(size) {
  return FONT_SIZES.includes(size);
}

/** @returns {boolean} true if `family` is one of the fixed, web-safe font families. */
export function isValidFontFamily(family) {
  return FONT_FAMILIES.includes(family);
}

/** @returns {boolean} true if `align` is a recognized text alignment. */
export function isValidTextAlign(align) {
  return TEXT_ALIGNMENTS.includes(align);
}

/**
 * Validates a partial object-style patch (color/width/fillEnabled/fillColor/fillOpacity).
 * Every key present must be one of STYLE_FIELDS and pass its own type check; unknown keys
 * or an empty/malformed patch are rejected outright so a client can't smuggle arbitrary
 * fields (e.g. `points`) into an object via the style-update path.
 * @returns {boolean}
 */
export function isValidStylePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
  const keys = Object.keys(patch);
  if (keys.length === 0) return false;
  for (const key of keys) {
    if (!STYLE_FIELDS.includes(key)) return false;
    switch (key) {
      case 'color': if (!isValidColor(patch.color)) return false; break;
      case 'width': if (!isValidStrokeWidth(patch.width)) return false; break;
      case 'fillEnabled': if (typeof patch.fillEnabled !== 'boolean') return false; break;
      case 'fillColor': if (!isValidColor(patch.fillColor)) return false; break;
      case 'fillOpacity': if (!isValidOpacity(patch.fillOpacity)) return false; break;
      default: return false;
    }
  }
  return true;
}

/**
 * Validates one persistent canvas object — the same shape whether it arrived via
 * draw-start, a JSON import, an autosave-recovery blob, or a snapshot. Whitelists exact
 * keys (rejects anything extra) so an imported file can't smuggle unexpected fields onto
 * a live object; every present field gets its own type/range check.
 * @returns {boolean}
 */
export function isValidCanvasObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_OBJECT_KEYS.has(key)) return false;
  }
  if (!isValidId(obj.id)) return false;
  if (!isValidToolType(obj.type)) return false;
  if (!isValidColor(obj.color)) return false;
  if (!isValidStrokeWidth(obj.width)) return false;
  if (!isValidPointArray(obj.points)) return false;
  if (obj.userId !== undefined && !isValidId(obj.userId)) return false;
  if (obj.createdAt !== undefined && !(isFiniteNum(obj.createdAt) && obj.createdAt >= 0)) return false;
  if (obj.fillEnabled !== undefined && typeof obj.fillEnabled !== 'boolean') return false;
  if (obj.fillColor !== undefined && !isValidColor(obj.fillColor)) return false;
  if (obj.fillOpacity !== undefined && !isValidOpacity(obj.fillOpacity)) return false;
  if (obj.groupId !== undefined && !isValidNullableId(obj.groupId)) return false;
  // A revision is never trusted from a client (server exclusively assigns/increments it —
  // see server/src/rooms/Room.js), but an object carrying one (e.g. an exported document
  // being re-imported) must still be *shaped* correctly rather than rejected outright.
  if (obj.revision !== undefined && !(Number.isInteger(obj.revision) && obj.revision >= 0)) return false;
  // Unlike revision, rotation IS a legitimate client-authored value (Phase 11) — a shape
  // simply omits it if never rotated, same "missing means 0" default every reader applies.
  if (obj.rotation !== undefined && !isValidRotation(obj.rotation)) return false;

  // Phase 12 — type-specific diagramming fields. `start`/`end` are REQUIRED on a
  // connector (a connector with no endpoints isn't a connector); everything else here is
  // optional with a client-applied default, same "missing means default" convention as
  // revision/rotation above.
  if (obj.type === 'connector') {
    if (!isValidConnectorEndpoint(obj.start) || !isValidConnectorEndpoint(obj.end)) return false;
  } else if (obj.start !== undefined || obj.end !== undefined) {
    return false; // start/end only ever belong on a connector
  }
  if (obj.routing !== undefined && !isValidRouting(obj.routing)) return false;
  if (obj.arrowStart !== undefined && typeof obj.arrowStart !== 'boolean') return false;
  if (obj.arrowEnd !== undefined && typeof obj.arrowEnd !== 'boolean') return false;
  if (obj.label !== undefined && !isValidConnectorLabel(obj.label)) return false;
  // A standalone text object is meaningless with no `text` field at all (same "REQUIRED"
  // treatment as a connector's start/end above) — every other TEXT_CAPABLE_TYPES member
  // (rect/circle/sticky) treats it as optional, "missing means no embedded text yet".
  if (obj.type === 'text' && obj.text === undefined) return false;
  if (obj.text !== undefined && !isValidObjectText(obj.text)) return false;
  if (obj.title !== undefined && !isValidFrameTitle(obj.title)) return false;
  if (obj.fontSize !== undefined && !isValidFontSize(obj.fontSize)) return false;
  if (obj.fontFamily !== undefined && !isValidFontFamily(obj.fontFamily)) return false;
  if (obj.bold !== undefined && typeof obj.bold !== 'boolean') return false;
  if (obj.italic !== undefined && typeof obj.italic !== 'boolean') return false;
  if (obj.underline !== undefined && typeof obj.underline !== 'boolean') return false;
  if (obj.textAlign !== undefined && !isValidTextAlign(obj.textAlign)) return false;
  if (obj.textColor !== undefined && !isValidColor(obj.textColor)) return false;
  return true;
}

/**
 * Validates a batch-update patch — the geometry/grouping/style fields a Phase 8
 * transaction (move, resize, align, distribute, group, ungroup) is allowed to change on
 * an existing object. Same whitelist-and-reject-unknown-keys discipline as
 * isValidStylePatch, extended with `points` (geometry) and `groupId`.
 * @returns {boolean}
 */
export function isValidBatchPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
  const keys = Object.keys(patch);
  if (keys.length === 0) return false;
  for (const key of keys) {
    if (!BATCH_PATCH_FIELDS.includes(key)) return false;
    switch (key) {
      case 'points': if (!isValidPointArray(patch.points)) return false; break;
      case 'groupId': if (!isValidNullableId(patch.groupId)) return false; break;
      case 'rotation': if (!isValidRotation(patch.rotation)) return false; break;
      case 'color': if (!isValidColor(patch.color)) return false; break;
      case 'width': if (!isValidStrokeWidth(patch.width)) return false; break;
      case 'fillEnabled': if (typeof patch.fillEnabled !== 'boolean') return false; break;
      case 'fillColor': if (!isValidColor(patch.fillColor)) return false; break;
      case 'fillOpacity': if (!isValidOpacity(patch.fillOpacity)) return false; break;
      case 'routing': if (!isValidRouting(patch.routing)) return false; break;
      case 'arrowStart': if (typeof patch.arrowStart !== 'boolean') return false; break;
      case 'arrowEnd': if (typeof patch.arrowEnd !== 'boolean') return false; break;
      case 'label': if (!isValidConnectorLabel(patch.label)) return false; break;
      case 'text': if (!isValidObjectText(patch.text)) return false; break;
      case 'title': if (!isValidFrameTitle(patch.title)) return false; break;
      case 'fontSize': if (!isValidFontSize(patch.fontSize)) return false; break;
      case 'fontFamily': if (!isValidFontFamily(patch.fontFamily)) return false; break;
      case 'bold': if (typeof patch.bold !== 'boolean') return false; break;
      case 'italic': if (typeof patch.italic !== 'boolean') return false; break;
      case 'underline': if (typeof patch.underline !== 'boolean') return false; break;
      case 'textAlign': if (!isValidTextAlign(patch.textAlign)) return false; break;
      case 'textColor': if (!isValidColor(patch.textColor)) return false; break;
      default: return false;
    }
  }
  return true;
}

/** @returns {boolean} true if `ids` is a non-empty array of valid, unique object ids under `maxLen`. */
export function isValidIdArray(ids, maxLen = 500) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > maxLen) return false;
  if (!ids.every(isValidId)) return false;
  return new Set(ids).size === ids.length;
}

/** @returns {boolean} true if `op` is a recognized layer-reorder operation. */
export function isValidReorderOp(op) {
  return REORDER_OPS.has(op);
}

/** @returns {boolean} true if `metadata` is absent or a well-formed document metadata object. */
export function isValidDocumentMetadata(metadata) {
  if (metadata === undefined) return true;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  for (const key of Object.keys(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) return false;
  }
  if (metadata.name !== undefined && (typeof metadata.name !== 'string' || metadata.name.length > LIMITS.MAX_DOCUMENT_NAME_LEN)) return false;
  if (metadata.createdAt !== undefined && typeof metadata.createdAt !== 'string') return false;
  if (metadata.updatedAt !== undefined && typeof metadata.updatedAt !== 'string') return false;
  return true;
}

/**
 * Validates a whole SyncCanvas document (the format exported to JSON, autosaved, and
 * stored in snapshots). Unlike the boolean validators above, this one names which check
 * failed — import UX needs to tell a user *why* their file was rejected, not just that it
 * was.
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateDocument(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, error: 'not-an-object' };
  if (doc.format !== LIMITS.DOCUMENT_FORMAT) return { ok: false, error: 'wrong-format' };
  if (doc.version !== LIMITS.DOCUMENT_VERSION) return { ok: false, error: 'unsupported-version' };
  if (!isValidDocumentMetadata(doc.metadata)) return { ok: false, error: 'invalid-metadata' };
  if (!Array.isArray(doc.objects)) return { ok: false, error: 'invalid-objects' };
  if (doc.objects.length > LIMITS.MAX_IMPORT_OBJECTS) return { ok: false, error: 'too-many-objects' };
  for (const obj of doc.objects) {
    if (!isValidCanvasObject(obj)) return { ok: false, error: 'invalid-object' };
  }
  // `history` is entirely optional (Phase 7 files never have it, and "Export Drawing Only"
  // deliberately omits it) — only validated when present, and never required.
  if (doc.history !== undefined && !isValidHistoryExport(doc.history)) return { ok: false, error: 'invalid-history' };
  return { ok: true };
}

/** @returns {boolean} true if `type` is one of the canonical Phase 9 history operation types. */
export function isValidHistoryOpType(type) {
  return HISTORY_OP_TYPES.includes(type);
}

/** @returns {boolean} true if `opType` is one of the labels a client may attach to a BATCH_UPDATE. */
export function isValidBatchOpType(opType) {
  return BATCH_OP_TYPES.includes(opType);
}

/**
 * Validates one recorded operation's `forward` payload against what its `type` actually
 * needs to be replayed (reuses the exact same validators live traffic already goes
 * through — an imported op is held to the identical bar as a live one).
 * @returns {boolean}
 */
export function isValidHistoryOperation(op) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) return false;
  if (!isValidHistoryOpType(op.type)) return false;
  if (op.userId !== undefined && !isValidNullableId(op.userId)) return false;
  if (typeof op.username !== 'string' || op.username.length === 0 || op.username.length > LIMITS.USERNAME_MAX_LEN) return false;
  if (!(isFiniteNum(op.timestamp) && op.timestamp >= 0)) return false;

  const forward = op.forward;
  if (!forward || typeof forward !== 'object' || Array.isArray(forward)) return false;

  switch (op.type) {
    case 'OBJECT_CREATE':
    case 'STROKE_CREATE':
    case 'DOCUMENT_IMPORT':
    case 'DOCUMENT_RESTORE':
      return Array.isArray(forward.objects) && forward.objects.length <= LIMITS.MAX_IMPORT_OBJECTS && forward.objects.every(isValidCanvasObject);
    case 'OBJECT_DELETE':
      return Array.isArray(forward.ids) && forward.ids.length > 0 && forward.ids.every(isValidId);
    case 'OBJECT_MOVE':
    case 'OBJECT_RESIZE':
    case 'OBJECT_ROTATE':
    case 'OBJECT_STYLE_CHANGE':
    case 'GROUP':
    case 'UNGROUP':
    case 'ALIGN':
    case 'DISTRIBUTE':
      return (
        Array.isArray(forward.patches) &&
        forward.patches.length > 0 &&
        forward.patches.every((p) => isValidId(p?.id) && isValidBatchPatch(p?.patch))
      );
    case 'LAYER_CHANGE':
      return isValidIdArray(forward.order, LIMITS.MAX_OBJECTS_PER_ROOM);
    case 'CLEAR_CANVAS':
    case 'CHECKPOINT_CREATED':
      return true;
    default:
      return false;
  }
}

/** @returns {boolean} true if `name` is a safe, bounded checkpoint name. */
export function isValidCheckpointName(name) {
  return typeof name === 'string' && name.trim().length > 0 && name.length <= LIMITS.MAX_CHECKPOINT_NAME_LEN && !/[<>]/.test(name);
}

/** @returns {boolean} true if `sequence` is a positive integer operation sequence number. */
export function isValidSequence(sequence) {
  return Number.isInteger(sequence) && sequence >= 0;
}

/** @returns {boolean} true if `revision` is a well-formed object-revision number — same
 *  shape as a history sequence (non-negative integer), reused rather than duplicated. A
 *  client-supplied revision is only ever compared against the server's authoritative one
 *  (see Room.updateObject/batchUpdate); it is never itself trusted as the new value. */
export function isValidRevision(revision) {
  return isValidSequence(revision);
}

/**
 * Validates an exported `history` block (Phase 9 "Export With History"). Bounded and
 * shallow on purpose — every individual operation is validated by isValidHistoryOperation,
 * but ids/timestamps/sequence numbers inside it are NEVER trusted as authoritative; the
 * importer re-sequences and re-stamps everything fresh (see Room.importHistory).
 * @returns {boolean}
 */
export function isValidHistoryExport(history) {
  if (!history || typeof history !== 'object' || Array.isArray(history)) return false;
  if (!Array.isArray(history.operations) || history.operations.length > LIMITS.MAX_HISTORY_OPERATIONS) return false;
  if (!history.operations.every(isValidHistoryOperation)) return false;
  if (history.checkpoints !== undefined) {
    if (!Array.isArray(history.checkpoints) || history.checkpoints.length > LIMITS.MAX_NAMED_CHECKPOINTS) return false;
    for (const cp of history.checkpoints) {
      if (!cp || typeof cp !== 'object') return false;
      if (!isValidCheckpointName(cp.name)) return false;
      if (!Array.isArray(cp.objects) || !cp.objects.every(isValidCanvasObject)) return false;
    }
  }
  return true;
}
