import { LIMITS, reconstructAt as sharedReconstructAt } from '@synccanvas/shared';

let opCounter = 0;
/** Process-wide monotonic suffix so two operations recorded in the same millisecond (very
 *  possible under load) still get distinct ids without needing a random generator here. */
function generateOpId() {
  opCounter += 1;
  return `op_${Date.now().toString(36)}_${opCounter}`;
}

let checkpointCounter = 0;
function generateCheckpointId() {
  checkpointCounter += 1;
  return `chk_${Date.now().toString(36)}_${checkpointCounter}`;
}

/**
 * Server-authoritative, persistent operation log for one room — Phase 9's session
 * replay/timeline/time-travel substrate. Sequence numbers are assigned HERE, strictly
 * increasing, which is what gives every client the same deterministic operation order
 * regardless of client clocks or network jitter (never rely on client-reported timestamps
 * for ordering, only for display).
 *
 * Deliberately separate from Room's per-user undo/redo stacks (those exist to let one user
 * reverse their OWN last action) and from ephemeral collaboration signals (cursor, laser,
 * selection, viewport — see socket/handlers.js), which never reach this log at all.
 *
 * Internal checkpoints (periodic, automatic, for fast reconstruction) are a completely
 * different concept from named checkpoints (manual, user-labeled, shared) — see #10 in the
 * Phase 9 spec. Both live here since they're both "a document snapshot at a sequence", but
 * `checkpoints` is compaction-eligible bookkeeping while `namedCheckpoints` is user-facing
 * data that must never silently disappear once created.
 */
export class RoomHistory {
  constructor() {
    /** @type {Array<object>} canonical operations, oldest first, sequence-ordered. */
    this.operations = [];
    /** @type {Array<{sequence:number, objects:object[]}>} internal reconstruction checkpoints */
    this.checkpoints = [];
    /** @type {Array<{id,name,sequence,timestamp,createdBy,createdByName,objects}>} */
    this.namedCheckpoints = [];
    this.nextSequence = 1;
    /** sequence of the oldest operation still directly recorded (>0 once compaction has trimmed the log) */
    this.baseSequence = 0;
    /** document state (object array) as of `baseSequence` — the reconstruction floor */
    this.baseSnapshot = [];
  }

  /**
   * Records one canonical operation. `getObjectsSnapshot` is called lazily — only when an
   * internal checkpoint is actually due — so recording a routine operation (the common
   * case, e.g. every completed stroke) stays O(1) rather than O(room size).
   * @param {{type:string, userId:string, username:string, forward:object, summary?:object}} entry
   * @param {() => object[]} getObjectsSnapshot
   * @returns {object} the recorded operation
   */
  record({ type, userId, username, forward, summary }, getObjectsSnapshot) {
    const sequence = this.nextSequence++;
    const op = {
      id: generateOpId(),
      sequence,
      type,
      timestamp: Date.now(),
      userId: userId ?? null,
      username: username ?? 'Someone',
      summary: summary ?? {},
      forward: forward ?? {},
    };
    this.operations.push(op);

    if (sequence % LIMITS.HISTORY_CHECKPOINT_INTERVAL === 0) {
      this.checkpoints.push({ sequence, objects: getObjectsSnapshot() });
      if (this.checkpoints.length > LIMITS.MAX_HISTORY_CHECKPOINTS) this.checkpoints.shift();
    }
    this._compact(getObjectsSnapshot);
    return op;
  }

  /**
   * Bounds memory: once the log grows past MAX_HISTORY_OPERATIONS, fold the oldest half
   * into `baseSnapshot` using the newest checkpoint that's old enough, rather than either
   * growing forever or crashing (Phase 9 #8). Reconstruction of anything still >= the new
   * baseSequence remains exact; anything older is no longer individually inspectable, only
   * its net effect (already captured in baseSnapshot) survives.
   */
  _compact(getObjectsSnapshot) {
    if (this.operations.length <= LIMITS.MAX_HISTORY_OPERATIONS) return;
    const targetSequence = this.operations[0].sequence + Math.floor(LIMITS.MAX_HISTORY_OPERATIONS / 2);
    let foldInto = null;
    for (const cp of this.checkpoints) {
      if (cp.sequence <= targetSequence) foldInto = cp;
    }
    if (!foldInto) {
      // No checkpoint old enough yet — force one right at the compaction boundary so the
      // log can still shrink instead of growing unbounded until the next interval hits.
      foldInto = { sequence: this.operations[this.operations.length - 1].sequence, objects: getObjectsSnapshot() };
    }
    this.baseSequence = foldInto.sequence;
    this.baseSnapshot = foldInto.objects;
    this.operations = this.operations.filter((op) => op.sequence > foldInto.sequence);
    this.checkpoints = this.checkpoints.filter((cp) => cp.sequence > foldInto.sequence);
  }

  /** @returns {object[]} the document as of `sequence` (clamped to the log's actual range). */
  reconstructAt(sequence) {
    const clamped = Math.max(this.baseSequence, Math.min(sequence, this.nextSequence - 1));
    return sharedReconstructAt(this, clamped);
  }

  /** @returns {number} the latest recorded sequence (0 if nothing has happened yet). */
  latestSequence() {
    return this.nextSequence - 1;
  }

  /**
   * Creates a named, shared checkpoint pinned to the CURRENT document state — stored with
   * its own full object snapshot (same pattern as Phase 7's local snapshots) so it stays
   * restorable forever, independent of internal-checkpoint compaction.
   * @returns {object|null} the checkpoint, or null if the room already has too many
   */
  createNamedCheckpoint({ name, userId, username, objects }) {
    if (this.namedCheckpoints.length >= LIMITS.MAX_NAMED_CHECKPOINTS) return null;
    const checkpoint = {
      id: generateCheckpointId(),
      name,
      sequence: this.latestSequence(),
      timestamp: Date.now(),
      createdBy: userId ?? null,
      createdByName: username ?? 'Someone',
      objects: objects.map((o) => ({ ...o, points: o.points.map((p) => ({ ...p })) })),
    };
    this.namedCheckpoints.push(checkpoint);
    return checkpoint;
  }

  getNamedCheckpoint(id) {
    return this.namedCheckpoints.find((c) => c.id === id) ?? null;
  }

  /** @returns {object} a client-safe snapshot of the whole log. Never includes INTERNAL
   *  reconstruction checkpoints' object arrays (clients reconstruct locally from
   *  `operations` + `baseSnapshot` instead) — but DOES include named checkpoints' full
   *  objects, since those are few (capped, MAX_NAMED_CHECKPOINTS), user-facing, and needed
   *  both for the timeline UI and for "Export With History" to round-trip them faithfully. */
  serialize() {
    return {
      operations: this.operations,
      baseSequence: this.baseSequence,
      baseSnapshot: this.baseSnapshot,
      namedCheckpoints: this.namedCheckpoints,
      latestSequence: this.latestSequence(),
    };
  }

  /**
   * Wholesale-replaces this room's history log with an externally-supplied, already-
   * validated operation list — "Import With History" (Phase 9 Part I). Every operation is
   * replayed through the normal `record` path, so it gets a fresh id/sequence/timestamp
   * here; nothing about an imported op's original id, sequence, or timestamp is trusted or
   * preserved (#43). Named checkpoints are cleared too — their sequence numbers would
   * otherwise reference a timeline that no longer exists once everything is re-sequenced.
   */
  replaceWith(ops, getObjectsSnapshot) {
    this.operations = [];
    this.checkpoints = [];
    this.namedCheckpoints = [];
    this.nextSequence = 1;
    this.baseSequence = 0;
    this.baseSnapshot = [];
    for (const op of ops) {
      this.record({ type: op.type, userId: op.userId ?? null, username: op.username, forward: op.forward, summary: op.summary }, getObjectsSnapshot);
    }
  }
}
