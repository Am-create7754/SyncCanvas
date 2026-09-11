/** Server-enforced bounds so malformed or hostile payloads can't blow up room state. */
export const LIMITS = {
  ROOM_ID_LENGTH: 6,
  USERNAME_MAX_LEN: 24,
  USERNAME_MIN_LEN: 1,
  MAX_STROKE_WIDTH: 60,
  MIN_STROKE_WIDTH: 1,
  MAX_POINTS_PER_OBJECT: 5000,
  MAX_POINTS_PER_BATCH: 200,
  MAX_COORD: 200000,
  MIN_COORD: -200000,
  MAX_OBJECTS_PER_ROOM: 20000,
  MAX_USERS_PER_ROOM: 40,
  CURSOR_RATE_LIMIT_MS: 40,
  DRAW_RATE_LIMIT_MS: 16,
  DISCONNECT_GRACE_MS: 8000,

  LASER_RATE_LIMIT_MS: 40,
  VIEWPORT_RATE_LIMIT_MS: 60,
  MIN_ZOOM: 0.05,
  MAX_ZOOM: 20,

  // Phase 8 editor operations
  TRANSFORM_PREVIEW_RATE_LIMIT_MS: 40,
  MAX_BATCH_SIZE: 500, // objects touched by one move/resize/align/group/paste/delete/reorder op
  MAX_UNDO_STACK: 1000, // room's GLOBAL undo/redo stack depth — oldest entries drop (FIFO) beyond this

  // Document import/export (Phase 7)
  DOCUMENT_FORMAT: 'synccanvas',
  DOCUMENT_VERSION: 1,
  MAX_IMPORT_OBJECTS: 20000, // matches MAX_OBJECTS_PER_ROOM — an import can't smuggle in more than a room could ever hold
  MAX_DOCUMENT_NAME_LEN: 60,

  // Persistent operation history / replay / time travel (Phase 9)
  MAX_HISTORY_OPERATIONS: 5000, // bounded in-memory log per room — see RoomHistory._compact
  HISTORY_CHECKPOINT_INTERVAL: 100, // an internal reconstruction checkpoint every N operations
  MAX_HISTORY_CHECKPOINTS: 25, // internal checkpoints retained alongside the base snapshot
  MAX_NAMED_CHECKPOINTS: 20, // user-named, shared checkpoints per room
  MAX_CHECKPOINT_NAME_LEN: 60,
  MAX_HISTORY_FETCH: 5000, // matches MAX_HISTORY_OPERATIONS — one GET_HISTORY reply never exceeds the log itself

  // Collaborative concurrency & conflict safety (Phase 10)
  LOCK_TTL_MS: 12000, // an unrefreshed lock (no heartbeat/mutation) expires after this long
  LOCK_HEARTBEAT_INTERVAL_MS: 3000, // client refresh cadence while actively holding a lock
  LOCK_SWEEP_INTERVAL_MS: 3000, // server: how often expired locks/control-requests are reaped
  CONTROL_REQUEST_TTL_MS: 15000, // "X wants to edit Y" expires if the holder never responds
  LOCK_REQUEST_RATE_LIMIT_MS: 150, // per-socket throttle on lock acquire/release spam

  // Diagramming (Phase 12)
  MAX_CONNECTOR_LABEL_LEN: 80,
  MAX_STICKY_TEXT_LEN: 500,
  MAX_FRAME_TITLE_LEN: 80,
  CONNECTOR_ANCHOR_HIT_RADIUS: 10, // screen px — how close a click must be to an anchor dot to grab it
  CONNECTOR_ELBOW_PADDING: 20, // world units the elbow route steps out from an anchor before bending
};

export const USER_COLORS = [
  '#F43F5E', '#F97316', '#EAB308', '#22C55E',
  '#14B8A6', '#3B82F6', '#6366F1', '#A855F7',
  '#EC4899', '#84CC16', '#06B6D4', '#8B5CF6',
];
