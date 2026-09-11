/** Socket.IO event names shared between client and server so both sides stay in sync by import, not by string-matching. */
export const EVENTS = {
  JOIN_ROOM: 'join-room',
  ROOM_JOINED: 'room-joined',
  ROOM_FULL_STATE: 'canvas-state',
  USER_JOINED: 'user-joined',
  USER_LEFT: 'user-left',

  CURSOR_MOVE: 'cursor-move',
  CURSOR_UPDATE: 'cursor-update',

  DRAW_START: 'draw-start',
  DRAW_UPDATE: 'draw-update',
  DRAW_END: 'draw-end',

  OBJECT_DELETE: 'object-delete',
  OBJECT_RESTORE: 'object-restore',
  OBJECT_UPDATE: 'object-update',
  CLEAR_CANVAS: 'clear-canvas',

  UNDO: 'undo',
  REDO: 'redo',

  // Whole-document replacement (Phase 7) — import/snapshot-restore/crash-recovery all
  // funnel through this one event so "replace the room's persistent state" has exactly
  // one code path, same treatment as CLEAR_CANVAS but with a starting object set.
  IMPORT_DOCUMENT: 'import-document',
  DOCUMENT_IMPORTED: 'document-imported',

  // Phase 8 editor operations — every one of these is ONE logical, undoable transaction
  // covering N objects at once, so a multi-select drag/align/group never fragments into
  // per-object history entries. See server/src/rooms/Room.js for the undo-entry shapes.
  BATCH_UPDATE: 'batch-update', // patch existing objects (move/resize/align/distribute/group/ungroup)
  OBJECTS_CREATE: 'objects-create', // paste/duplicate — brand-new objects, atomic
  OBJECTS_DELETE: 'objects-delete', // delete selection, atomic
  REORDER_OBJECTS: 'reorder-objects', // layer order: front/back/forward/backward

  PING: 'ping',
  PONG: 'pong',

  // Ephemeral collaboration signals (Phase 5) — never touch Room's persistent object
  // state on the server; they're relayed and forgotten, same treatment as cursor-move.
  LASER_MOVE: 'laser-move',
  VIEWPORT_UPDATE: 'viewport-update',
  SELECTION_CHANGE: 'selection-change',
  // Live drag/resize preview (Phase 8) — same ephemeral treatment: relayed only, never
  // persisted, never enters undo history. The authoritative geometry lands via
  // BATCH_UPDATE once the drag ends. Keeps a 3-second drag from spamming Room state.
  TRANSFORM_PREVIEW: 'transform-preview',

  // Phase 9 — persistent, server-authoritative operation history (session replay /
  // timeline / time travel), entirely separate from the room's global undo/redo stacks
  // above and from every ephemeral signal below. See server/src/rooms/RoomHistory.js. There's no
  // dedicated "a new operation was recorded" broadcast: the client already receives one of
  // the events above (BATCH_UPDATE, OBJECTS_CREATE, DRAW_END, DOCUMENT_IMPORTED, ...) for
  // every persistent change, so the Replay UI's "live changes available" indicator piggy-
  // backs on those instead of a second, parallel notification channel.
  GET_HISTORY: 'get-history', // ack-based: fetch the room's full operation log + checkpoints
  CREATE_CHECKPOINT: 'create-checkpoint', // request: name + snapshot the current document
  CHECKPOINT_CREATED: 'checkpoint-created', // server -> everyone: a named checkpoint was added
  RESTORE_VERSION: 'restore-version', // request: replace the live document with a historical one

  // Phase 10 — collaborative concurrency & conflict safety. Locks are EPHEMERAL, per-room
  // state (never exported/autosaved/replayed, see server/src/rooms/RoomLocks.js) that
  // reduce conflicts but never replace the revision check below: a lock owner can still
  // send a stale packet due to network reordering, so "lock valid" never implies "update
  // valid" (see UPDATE_REJECTED). Never a CRDT/OT — plain server-authoritative arbitration.
  OBJECTS_LOCK_REQUEST: 'objects-lock-request', // ack: {objectIds} -> all-or-nothing acquire
  OBJECTS_LOCK_RELEASE: 'objects-lock-release', // fire: {objectIds} — voluntary release (commit/cancel)
  OBJECT_LOCK_GRANTED: 'object-lock-granted', // server -> room: someone acquired lock(s)
  OBJECT_LOCK_RELEASED: 'object-lock-released', // server -> room: {objectIds, reason: 'release'|'timeout'|'disconnect'|'control-transfer'|'document-replaced'}
  OBJECT_LOCK_HEARTBEAT: 'object-lock-heartbeat', // fire: {objectIds} — keep-alive for held locks
  UPDATE_REJECTED: 'update-rejected', // server -> sender only: stale revision / lock conflict — client must reconcile, no scary modal

  REQUEST_CONTROL: 'request-control', // fire: {objectId} — ask the current lock holder to release
  CONTROL_REQUESTED: 'control-requested', // server -> lock holder only: "X wants to edit Y"
  CONTROL_RESPONSE: 'control-response', // fire (from lock holder): {objectId, action: 'release'|'keep'}
  CONTROL_GRANTED: 'control-granted', // server -> requester only: holder released, lock now yours
  CONTROL_DENIED: 'control-denied', // server -> requester only: {objectId, reason: 'kept'|'timeout'|'invalid'}

  ERROR: 'server-error',
};

/**
 * Canonical, human-meaningful operation types recorded in a room's persistent history
 * log (Phase 9). Deliberately coarser than the wire protocol above — e.g. a multi-object
 * drag is ONE OBJECT_MOVE here no matter how many BATCH_UPDATE/TRANSFORM_PREVIEW packets
 * it took to get there. Never includes ephemeral signals (cursor/laser/selection/viewport).
 */
export const HISTORY_OP_TYPES = [
  'OBJECT_CREATE', 'STROKE_CREATE', 'OBJECT_DELETE',
  'OBJECT_MOVE', 'OBJECT_RESIZE', 'OBJECT_ROTATE', 'OBJECT_STYLE_CHANGE',
  'GROUP', 'UNGROUP', 'ALIGN', 'DISTRIBUTE', 'LAYER_CHANGE',
  'CLEAR_CANVAS', 'DOCUMENT_IMPORT', 'DOCUMENT_RESTORE', 'CHECKPOINT_CREATED',
];

/** The subset of HISTORY_OP_TYPES a client may hint at when it sends a BATCH_UPDATE —
 *  the raw {id,patch} pairs alone can't tell a move from an align from a group, so the
 *  client (which knows exactly which command it just ran) labels it. Purely a display
 *  label for the Activity Feed/timeline: never trusted for validation or replay math,
 *  which both still only ever use the actual patch data. */
export const BATCH_OP_TYPES = ['OBJECT_MOVE', 'OBJECT_RESIZE', 'OBJECT_ROTATE', 'GROUP', 'UNGROUP', 'ALIGN', 'DISTRIBUTE'];

export const TOOL_TYPES = {
  PATH: 'path',
  ERASER: 'eraser',
  LINE: 'line',
  RECT: 'rect',
  CIRCLE: 'circle',
  // Phase 12 — diagramming objects. STICKY/FRAME reuse the exact same drag-to-size
  // creation flow as rect/circle (see SHAPE_TOOLS); CONNECTOR has its own hover-anchor
  // creation flow (see CanvasEngine's connector-tool pointer handling) and is never a
  // SHAPE_TOOL, since its geometry is derived from two other objects, not drawn directly.
  CONNECTOR: 'connector',
  STICKY: 'sticky',
  FRAME: 'frame',
};

/** Tools whose geometry is only meaningful with exactly a start+end point (drag-to-size shapes). */
export const SHAPE_TOOLS = new Set([TOOL_TYPES.LINE, TOOL_TYPES.RECT, TOOL_TYPES.CIRCLE, TOOL_TYPES.STICKY, TOOL_TYPES.FRAME]);
/** Tools that stream points progressively while the pointer is down. */
export const FREEHAND_TOOLS = new Set([TOOL_TYPES.PATH, TOOL_TYPES.ERASER]);
/** Closed shapes that can carry an interior fill — a line has no "inside", so it's
 *  excluded even though it's a SHAPE_TOOL. Connectors are excluded too — their "fill" is
 *  the stroke of the line itself, handled entirely by STYLE_FIELDS' color/width. */
export const FILLABLE_TYPES = new Set([TOOL_TYPES.RECT, TOOL_TYPES.CIRCLE, TOOL_TYPES.STICKY, TOOL_TYPES.FRAME]);
/** Style fields that can be edited on an existing object via OBJECT_UPDATE. */
export const STYLE_FIELDS = ['color', 'width', 'fillEnabled', 'fillColor', 'fillOpacity'];

/** The four cardinal connection points a connectable shape offers (Phase 12). */
export const CONNECTOR_ANCHORS = ['top', 'right', 'bottom', 'left'];
/** Connector routing modes — a straight line, or an orthogonal (horizontal/vertical-only) path. */
export const CONNECTOR_ROUTINGS = ['straight', 'elbow'];
/** Fields a connector's own attributes (routing/arrows/label) can be edited through via
 *  BATCH_UPDATE — kept distinct from STYLE_FIELDS (color/width) since those already work
 *  for a connector's stroke unchanged; see isValidConnectorPatch. */
export const CONNECTOR_PATCH_FIELDS = ['routing', 'arrowStart', 'arrowEnd', 'label'];
