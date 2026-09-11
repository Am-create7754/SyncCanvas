import { LIMITS, FREEHAND_TOOLS, BATCH_OP_TYPES, isValidCanvasObject, isValidCheckpointName } from '@synccanvas/shared';
import { RoomHistory } from './RoomHistory.js';
import { RoomLocks } from './RoomLocks.js';

/** Best-effort history label when a batchUpdate call omits (or sends an invalid) opType —
 *  only ever a fallback; the client normally always supplies one since it knows exactly
 *  which command (move/resize/align/distribute/group/ungroup) it just ran. */
function inferBatchOpType(updates) {
  const touchesGroup = updates.some((u) => 'groupId' in u.patch);
  if (touchesGroup) return updates.some((u) => u.patch.groupId === null) ? 'UNGROUP' : 'GROUP';
  const touchesPoints = updates.some((u) => 'points' in u.patch);
  if (touchesPoints) return 'OBJECT_MOVE';
  const touchesRotation = updates.some((u) => 'rotation' in u.patch);
  if (touchesRotation) return 'OBJECT_ROTATE';
  return 'OBJECT_STYLE_CHANGE';
}

/**
 * In-memory state for a single collaborative room. One Room instance owns its users,
 * its finalized objects, and ONE GLOBAL (room-wide) undo/redo history shared by every
 * collaborator. Node's single-threaded event loop processes all socket events for this
 * room strictly one-at-a-time, so every method here can mutate state directly without
 * locks — that serialization is what gives us a deterministic total order for concurrent
 * operations without needing CRDT/OT machinery.
 *
 * Undo/redo is intentionally GLOBAL, not per-user: whoever clicks Undo reverts the most
 * recent operation in the ROOM (regardless of who performed it), and any new action by
 * ANYONE clears the shared redo stack — the same model a real-time whiteboard (Figma,
 * Google Slides) uses, since a per-user stack would let two collaborators' undo histories
 * silently diverge from what's actually on screen. `userId` is still threaded through
 * undo()/redo() below, but only to (a) decide whether an object currently soft-locked by
 * someone ELSE should be skipped rather than yanked out from under them, and (b) attribute
 * the resulting persistent-history entry to whoever clicked the button — never to select
 * which stack to use, since there is only one.
 *
 * Undo/redo history entries come in several shapes, all reversible the same way (undo
 * applies `.before`/deletes/restores, redo applies `.after` — the entry itself just moves
 * between the two stacks unchanged, no bookkeeping duplication):
 *   { action: 'create', objectId, userId, object? }        object is stashed only once undone
 *   { action: 'update', objectId, userId, before, after }  single-object style patch
 *   { action: 'batch-update', patches: [{objectId, before, after}], userId, opType }  Phase 8:
 *                                                          move/resize/align/distribute/group/
 *                                                          ungroup — N objects, ONE transaction
 *   { action: 'create-batch', objectIds, userId, objects? } Phase 8: paste/duplicate
 *   { action: 'delete-batch', objects, userId }            Phase 8: multi-delete
 *   { action: 'reorder', before, after, userId }           Phase 8: layer order (full id order)
 * `entry.userId` records the ORIGINAL author of the action (for debugging/display only —
 * it plays no role in who is allowed to undo it, since undo/redo is global).
 *
 * `this.history` (Phase 9, see RoomHistory.js) is a COMPLETELY SEPARATE, append-only,
 * server-sequenced log of meaningful document changes — it exists for session replay,
 * the timeline, and time travel, never for reversing the room's last action, and it is
 * never wiped by undo/redo/clear/import the way undoStack/redoStack are. Every mutating
 * method below records into it right after mutating `this.objects`, using the exact same
 * payload shapes already broadcast to other clients — one representation of "what changed
 * and how", reused for both live sync and historical replay.
 */
export class Room {
  constructor(id) {
    this.id = id;
    /** @type {Map<string, {id:string, username:string, color:string, socketId:string}>} */
    this.users = new Map();
    /** @type {Map<string, object>} objectId -> canvas object */
    this.objects = new Map();
    /** @type {object[]} ONE global, room-wide undo stack — see class doc comment. Oldest
     *  entries are dropped once LIMITS.MAX_UNDO_STACK is exceeded (FIFO trim) so a very
     *  long-running room session can't grow this without bound. */
    this.undoStack = [];
    /** @type {object[]} the room's global redo stack — entries popped by undo(), cleared
     *  by ANY new mutating action from ANY user. */
    this.redoStack = [];
    /** @type {Map<string, NodeJS.Timeout>} userId -> pending disconnect-grace timer */
    this.pendingRemovals = new Map();
    this.lastActivity = Date.now();
    /** @type {RoomHistory} Phase 9 persistent operation log */
    this.history = new RoomHistory();
    /** @type {RoomLocks} Phase 10 ephemeral soft-lock + control-request registry —
     *  NEVER touches this.objects/this.history directly; see RoomLocks.js. */
    this.locks = new RoomLocks();
  }

  /** Bumps and returns an existing object's server-authoritative revision — the ONLY
   *  place a revision number is ever produced (Phase 10). Every content mutation to an
   *  already-existing object (style edit, move/resize, undo/redo of either) goes through
   *  this exact call, so a client's baseRevision check always has one true counter to
   *  compare against. */
  _bumpRevision(obj) {
    obj.revision = (obj.revision ?? 0) + 1;
    return obj.revision;
  }

  /** @returns {object[]} a snapshot of the current document — what a new internal/named
   *  checkpoint captures. Deep-copied so later mutation of `this.objects` can never leak
   *  into an already-recorded checkpoint. */
  _objectsSnapshot() {
    return [...this.objects.values()].map((o) => ({ ...o, points: o.points.map((p) => ({ ...p })) }));
  }

  _username(userId) {
    return this.users.get(userId)?.username ?? 'Someone';
  }

  _recordOp(type, userId, forward, summary) {
    return this.history.record(
      { type, userId, username: this._username(userId), forward, summary },
      () => this._objectsSnapshot(),
    );
  }

  /** Records the inverse (undo) or re-applied (redo) effect of a history-eligible entry —
   *  shared by undo()/redo() so "undo results in an inverse persistent operation" (Phase 9
   *  #39) is implemented exactly once. */
  _recordFromResult(userId, result, opType) {
    switch (result.type) {
      case 'delete': return this._recordOp('OBJECT_DELETE', userId, { ids: [result.objectId] });
      case 'update': return this._recordOp('OBJECT_STYLE_CHANGE', userId, { patches: [{ id: result.objectId, patch: result.patch }] });
      case 'batch-update': return this._recordOp(opType, userId, { patches: result.patches });
      case 'delete-many': return this._recordOp('OBJECT_DELETE', userId, { ids: result.objectIds });
      case 'restore-many': return this._recordOp('OBJECT_CREATE', userId, { objects: result.objects });
      case 'reorder': return this._recordOp('LAYER_CHANGE', userId, { order: result.order });
      default: return null;
    }
  }

  touch() {
    this.lastActivity = Date.now();
  }

  /**
   * Decides how a JOIN_ROOM request should be handled — updating an existing user record
   * in place, or creating a fresh one — WITHOUT performing any of the actual mutation or
   * socket side effects (those stay in server/src/socket/handlers.js). Extracted as its
   * own pure decision specifically so the bug it guards against is unit-testable without a
   * live socket: `this.pendingRemovals` (a disconnect-grace timer) and `this.users` (the
   * live roster) can disagree — a timer can outlive the user record it was scheduled for,
   * e.g. two connections briefly sharing one userId, each getting their own grace timer for
   * the same key. Trusting "there's a pending removal for this id" as a stand-in for
   * "there's a live user to update" was exactly that bug (crashed on `undefined.socketId`).
   * `existingUser` — not `pendingRemovals.has(userId)` — is what actually decides the mode.
   * @returns {{mode:'update', user:object} | {mode:'create', wasReconnecting:boolean}}
   */
  resolveJoinMode(userId, hasKnownId) {
    const existingUser = hasKnownId ? this.users.get(userId) : null;
    if (existingUser) return { mode: 'update', user: existingUser };
    const wasReconnecting = !!(hasKnownId && this.pendingRemovals.has(userId));
    return { mode: 'create', wasReconnecting };
  }

  isEmpty() {
    return this.users.size === 0 && this.pendingRemovals.size === 0;
  }

  addUser(user) {
    this.users.set(user.id, user);
    this.touch();
  }

  removeUser(userId) {
    this.users.delete(userId);
    // Undo/redo is GLOBAL (room-wide) — a disconnecting user's own past actions remain
    // undoable/redoable by whoever is left in the room, so nothing here touches
    // undoStack/redoStack.
    // Defense in depth — the socket 'disconnect' handler already releases this user's
    // locks IMMEDIATELY (not after the grace period), but a second, idempotent release
    // here means removeUser is never the path that leaves a ghost lock behind.
    this.locks.releaseAllForUser(userId);
    this.touch();
  }

  getState() {
    return {
      users: [...this.users.values()],
      objects: [...this.objects.values()],
    };
  }

  addObject(object) {
    if (this.objects.size >= LIMITS.MAX_OBJECTS_PER_ROOM) return false;
    // Revision is always server-assigned, never client-supplied — a brand-new object
    // always starts at 0 (Phase 10). Both client and server agree on this baseline
    // without needing a round-trip, since it's a constant rather than something derived.
    object.revision = 0;
    this.objects.set(object.id, object);
    this._pushUndo({ action: 'create', objectId: object.id, userId: object.userId });
    this.redoStack = [];
    this.touch();
    // No history recording here on purpose: draw-start only carries the FIRST point of a
    // stroke/shape (see socket/handlers.js), so the object isn't "meaningful" yet — Phase
    // 9 #4 explicitly wants ONE completed-stroke operation, not one per point. The actual
    // OBJECT_CREATE/STROKE_CREATE entry is recorded once draw-end arrives — see
    // recordStrokeComplete below.
    return true;
  }

  appendPoints(objectId, points) {
    const obj = this.objects.get(objectId);
    if (!obj) return null;
    const room = LIMITS.MAX_POINTS_PER_OBJECT - obj.points.length;
    if (room <= 0) return obj;
    obj.points.push(...points.slice(0, room));
    this.touch();
    return obj;
  }

  /**
   * Records the ONE meaningful history operation for a just-completed stroke/shape (Phase
   * 9 #4) — called when draw-end arrives, by which point the object already carries every
   * point draw-start/draw-update appended to it. A no-op if the object is already gone
   * (e.g. cleared mid-stroke).
   */
  recordStrokeComplete(userId, objectId) {
    const obj = this.objects.get(objectId);
    if (!obj) return null;
    const type = FREEHAND_TOOLS.has(obj.type) ? 'STROKE_CREATE' : 'OBJECT_CREATE';
    return this._recordOp(type, userId, { objects: [obj] }, { objectType: obj.type });
  }

  /**
   * Applies a validated style patch (color/width/fill*) to an existing object and records
   * it as an undoable action for `userId` — the editor's undo, not necessarily the
   * object's original creator, since "undo my last action" should cover edits too.
   *
   * Phase 10 conflict safety, checked in this order (matches the spec's validation order):
   * the object must exist, must not be soft-locked by ANOTHER user, and — regardless of
   * lock state, since a lock owner can still send a stale packet on a reordered network —
   * `baseRevision` (when the caller supplies one) must match the object's current
   * authoritative revision. Only then is the patch applied and the revision bumped.
   * @returns {{ok:true, object:object, patch:object} | {ok:false, reason:'not-found'|'lock-denied'|'stale-revision', authoritative?:object}}
   */
  updateObject(userId, objectId, patch, baseRevision) {
    const obj = this.objects.get(objectId);
    if (!obj) return { ok: false, reason: 'not-found' };
    if (this.locks.isLockedByOther(objectId, userId)) {
      return { ok: false, reason: 'lock-denied', authoritative: obj };
    }
    if (baseRevision !== undefined && baseRevision !== (obj.revision ?? 0)) {
      return { ok: false, reason: 'stale-revision', authoritative: obj };
    }
    const before = {};
    for (const key of Object.keys(patch)) before[key] = obj[key];
    Object.assign(obj, patch);
    this._bumpRevision(obj);
    this._pushUndo({ action: 'update', objectId, userId, before, after: { ...patch } });
    this.redoStack = [];
    this.touch();
    // This method is only ever reached via OBJECT_UPDATE, which is only ever a StylePanel
    // fill/stroke edit — one unambiguous history label, no client hint needed. The
    // recorded op deliberately excludes `revision` (a live-sync-only concern) so it stays
    // valid against isValidBatchPatch's fixed field whitelist for export/import/replay.
    this._recordOp('OBJECT_STYLE_CHANGE', userId, { patches: [{ id: objectId, patch: { ...patch } }] });
    return { ok: true, object: obj, patch: { ...patch } };
  }

  deleteObject(objectId) {
    return this.objects.delete(objectId);
  }

  /**
   * Applies a validated patch (geometry/grouping/style) to each of several existing
   * objects as ONE undoable transaction — the mechanism behind move, resize, align,
   * distribute, group, and ungroup alike, so a 3-second multi-object drag or a 5-object
   * align becomes exactly one undo entry instead of one per object touched.
   * @param {string} userId
   * @param {Array<{id:string, patch:object, baseRevision?:number}>} updates
   * @param {string} [opType] - one of BATCH_OP_TYPES; a display label for the history log
   *   only (see Room.js top comment) — never trusted for validation or replay math, which
   *   both still only ever use `updates` itself. Falls back to a best-effort guess from the
   *   patch contents if omitted/invalid, so a missing label never blocks the real action.
   * @returns {{applied:Array<{id:string,patch:object}>, rejected:Array<{id:string,reason:string,authoritative:object}>}}
   *   `applied` is the subset that existed, wasn't lock-blocked, and matched its
   *   baseRevision — same partial-tolerance the batch already had for missing objects,
   *   now extended to lock/stale conflicts: one contested object in a multi-select drag
   *   skips just that object rather than aborting everyone else's.
   */
  batchUpdate(userId, updates, opType) {
    const applied = [];
    const rejected = [];
    const historyPatches = [];
    for (const { id, patch, baseRevision } of updates) {
      const obj = this.objects.get(id);
      if (!obj) continue;
      if (this.locks.isLockedByOther(id, userId)) {
        rejected.push({ id, reason: 'lock-denied', authoritative: obj });
        continue;
      }
      if (baseRevision !== undefined && baseRevision !== (obj.revision ?? 0)) {
        rejected.push({ id, reason: 'stale-revision', authoritative: obj });
        continue;
      }
      const before = {};
      for (const key of Object.keys(patch)) before[key] = obj[key];
      Object.assign(obj, patch);
      this._bumpRevision(obj);
      historyPatches.push({ objectId: id, before, after: { ...patch } });
      applied.push({ id, patch });
    }
    if (historyPatches.length === 0) return { applied: [], rejected };
    const label = BATCH_OP_TYPES.includes(opType) ? opType : inferBatchOpType(updates);
    this._pushUndo({ action: 'batch-update', patches: historyPatches, userId, opType: label });
    this.redoStack = [];
    this.touch();
    this._recordOp(label, userId, { patches: applied });
    return { applied, rejected };
  }

  /**
   * Adds several brand-new, already-validated objects (paste/duplicate) as ONE undoable
   * transaction. Enforces the room object cap against the whole batch atomically — either
   * every object fits, or none are added, so a paste never silently partial-applies.
   * @returns {object[]|null} the added objects, or null if the room doesn't have room for all of them
   */
  createObjects(userId, objects) {
    if (this.objects.size + objects.length > LIMITS.MAX_OBJECTS_PER_ROOM) return null;
    for (const obj of objects) {
      obj.revision = 0; // brand-new objects always start at 0 — see addObject
      this.objects.set(obj.id, obj);
    }
    this._pushUndo({ action: 'create-batch', objectIds: objects.map((o) => o.id), userId });
    this.redoStack = [];
    this.touch();
    // Unlike draw-start, paste/duplicate objects arrive already-complete — record immediately.
    this._recordOp('OBJECT_CREATE', userId, { objects }, { count: objects.length });
    return objects;
  }

  /**
   * Deletes several existing objects as ONE undoable transaction (multi-select delete,
   * group delete). Stashes the full objects at delete time so undo can restore them
   * without needing to have kept a copy around beforehand.
   *
   * Phase 10: never deletes out from under an active editor — an id locked by someone
   * OTHER than `userId` is skipped (same partial-tolerance pattern as a missing object)
   * rather than silently deleted, and reported back in `deniedByLock` so the caller can
   * tell the initiator "Amber is editing this object" instead of failing silently.
   * @returns {{removedIds:string[], deniedByLock:Array<{id:string, lockedBy:object}>}}
   */
  deleteObjects(userId, ids) {
    const removed = [];
    const deniedByLock = [];
    for (const id of ids) {
      const obj = this.objects.get(id);
      if (!obj) continue;
      if (this.locks.isLockedByOther(id, userId)) {
        deniedByLock.push({ id, lockedBy: this.locks.get(id) });
        continue;
      }
      this.objects.delete(id);
      removed.push(obj);
    }
    if (removed.length === 0) return { removedIds: [], deniedByLock };
    this._pushUndo({ action: 'delete-batch', objects: removed, userId });
    this.redoStack = [];
    this.touch();
    const removedIds = removed.map((o) => o.id);
    this._recordOp('OBJECT_DELETE', userId, { ids: removedIds }, { count: removedIds.length });
    // A deleted object's lock (if it somehow still had one — e.g. self-locked) no longer
    // references anything real; drop it rather than leave a lock pointing at nothing.
    this.locks.releaseForMissingObjects([...this.objects.keys()]);
    return { removedIds, deniedByLock };
  }

  /**
   * Reorders the given ids one step (forward/backward) or to an extreme (front/back)
   * within the room's z-order — which is simply this.objects' Map insertion order, the
   * same order rendering, hit-testing, the mini-map, and PNG export already read. There is
   * deliberately no separate zIndex field: one ordering system, not two.
   *
   * The client sends *which ids* and *which operation*, never a full recomputed order —
   * the server always derives the new order from its own authoritative current order, so a
   * stale or malicious client can't smuggle in an arbitrary permutation.
   * @returns {{before:string[], after:string[]}|null}
   */
  reorderObjects(userId, ids, op) {
    const order = [...this.objects.keys()];
    const idSet = new Set(ids.filter((id) => this.objects.has(id)));
    if (idSet.size === 0) return null;

    let after;
    if (op === 'front') {
      after = [...order.filter((id) => !idSet.has(id)), ...order.filter((id) => idSet.has(id))];
    } else if (op === 'back') {
      after = [...order.filter((id) => idSet.has(id)), ...order.filter((id) => !idSet.has(id))];
    } else {
      const direction = op === 'forward' ? 1 : -1;
      const arr = [...order];
      const indices = arr.map((id, i) => (idSet.has(id) ? i : -1)).filter((i) => i >= 0);
      const ordered = direction === 1 ? [...indices].reverse() : indices;
      for (const i of ordered) {
        const j = i + direction;
        if (j >= 0 && j < arr.length && !idSet.has(arr[j])) {
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
      }
      after = arr;
    }

    if (after.every((id, i) => id === order[i])) return null; // no-op (already at the extreme)

    const newObjects = new Map();
    for (const id of after) newObjects.set(id, this.objects.get(id));
    this.objects = newObjects;
    this._pushUndo({ action: 'reorder', before: order, after, userId });
    this.redoStack = [];
    this.touch();
    this._recordOp('LAYER_CHANGE', userId, { order: after }, { op });
    return { before: order, after };
  }

  /** @returns {{count:number, releasedLockIds:string[]}} */
  clear(userId) {
    const count = this.objects.size;
    this.objects.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.touch();
    // ONE meaningful CLEAR_CANVAS entry regardless of how many objects existed (Phase 9
    // #40) — never N individual OBJECT_DELETE entries.
    this._recordOp('CLEAR_CANVAS', userId, {}, { count });
    // Phase 10: a document-level wipe atomically invalidates every lock too — nothing
    // should be left referencing an object that no longer exists.
    const releasedLockIds = this.locks.releaseForMissingObjects([]);
    return { count, releasedLockIds };
  }

  /**
   * Wholesale-replaces the room's persistent objects — used by JSON import, snapshot
   * restore, and crash recovery, all of which are "replace the document" operations at
   * heart (same shape as `clear()` but with a starting object set instead of nothing).
   * Every entry in `objects` must already be validated by the caller (isValidCanvasObject)
   * — this method trusts its input, same contract as `addObject`. Undo/redo history is
   * wiped: reverting "half an import" against objects that no longer exist wouldn't mean
   * anything.
   *
   * Phase 10: every object gets a FRESH revision of 0 — a document replace is a brand new
   * baseline for concurrency purposes, same reasoning as a reconnect never reclaiming old
   * locks. Every existing lock is invalidated too (see `locks.releaseForMissingObjects`),
   * since whatever was being edited a moment ago may not even exist in the new document.
   * @returns {string[]} ids of locks released as a result of the replace
   */
  loadDocument(objects, userId, historyType = 'DOCUMENT_IMPORT') {
    this.objects.clear();
    this.undoStack = [];
    this.redoStack = [];
    for (const obj of objects) {
      obj.revision = 0;
      this.objects.set(obj.id, obj);
    }
    this.touch();
    // The persistent history log is NEVER wiped here (unlike undoStack/redoStack) — an
    // import or a historical restore is itself just one more entry appended to the log,
    // exactly like every other document change (Phase 9 #35: "Do NOT delete history after
    // the selected point").
    this._recordOp(historyType, userId, { objects }, { count: objects.length });
    return this.locks.releaseForMissingObjects([...this.objects.keys()]);
  }

  /** Pushes onto the ONE global undo stack, trimming the oldest entry once
   *  LIMITS.MAX_UNDO_STACK is exceeded — a simple FIFO bound so a very long-running room
   *  session can't grow this without limit (the persistent Phase 9 history log has its
   *  own, separate cap+compaction; this is a much smaller, simpler bound since undo/redo
   *  entries are only ever needed in strict LIFO order, never reconstructed from). */
  _pushUndo(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > LIMITS.MAX_UNDO_STACK) this.undoStack.shift();
  }

  _pushRedo(entry) {
    this.redoStack.push(entry);
    if (this.redoStack.length > LIMITS.MAX_UNDO_STACK) this.redoStack.shift();
  }

  /**
   * Reverts the ROOM's most recent surviving history entry — GLOBAL undo, not scoped to
   * whoever calls it (see class doc comment): if Amber draws A, Arpan draws B, then Amber
   * draws C, calling undo() from EITHER user's connection reverts C, since C is the most
   * recent operation in the room, period.
   *
   * Phase 10: an object currently locked by ANOTHER user (relative to the CALLER, `userId`
   * here) is treated the same as an already-gone object — skipped rather than silently
   * reverted out from under an active editor (spec: "don't let undo silently corrupt an
   * actively-edited object"). Every content change made here still bumps the object's
   * revision, same as a live edit, since undo IS a live edit from the server's perspective.
   * @param {string} userId - whoever is CLICKING undo right now (for lock-skip checks and
   *   persistent-history attribution only — never for selecting a stack)
   * @returns {{type:'delete', objectId} | {type:'update', objectId, patch} |
   *   {type:'batch-update', patches:[{objectId,patch}]} | {type:'delete-many', objectIds} |
   *   {type:'restore-many', objects} | {type:'reorder', order} | null}
   */
  undo(userId) {
    const stack = this.undoStack;
    while (stack.length > 0) {
      const entry = stack.pop();
      if (entry.action === 'create') {
        const obj = this.objects.get(entry.objectId);
        if (!obj || this.locks.isLockedByOther(entry.objectId, userId)) continue; // gone, or being actively edited by someone else
        this.objects.delete(entry.objectId);
        entry.object = obj; // stash so redo can restore it wholesale
        this._pushRedo(entry);
        this.touch();
        const result = { type: 'delete', objectId: entry.objectId };
        this._recordFromResult(userId, result);
        return result;
      }
      if (entry.action === 'update') {
        const obj = this.objects.get(entry.objectId);
        if (!obj || this.locks.isLockedByOther(entry.objectId, userId)) continue;
        Object.assign(obj, entry.before);
        this._bumpRevision(obj);
        this._pushRedo(entry);
        this.touch();
        const result = { type: 'update', objectId: entry.objectId, patch: { ...entry.before } };
        this._recordFromResult(userId, result);
        return this._withRevision(result);
      }
      if (entry.action === 'batch-update') {
        const patches = [];
        for (const p of entry.patches) {
          const obj = this.objects.get(p.objectId);
          if (!obj || this.locks.isLockedByOther(p.objectId, userId)) continue; // skip objects gone or locked by someone else
          Object.assign(obj, p.before);
          this._bumpRevision(obj);
          patches.push({ id: p.objectId, patch: { ...p.before } });
        }
        if (patches.length === 0) continue;
        this._pushRedo(entry);
        this.touch();
        const result = { type: 'batch-update', patches };
        this._recordFromResult(userId, result, entry.opType);
        return this._withRevision(result);
      }
      if (entry.action === 'create-batch') {
        const objects = [];
        for (const id of entry.objectIds) {
          const obj = this.objects.get(id);
          if (!obj || this.locks.isLockedByOther(id, userId)) continue;
          this.objects.delete(id);
          objects.push(obj);
        }
        if (objects.length === 0) continue;
        entry.objects = objects; // stash so redo can restore them wholesale
        this._pushRedo(entry);
        this.touch();
        const result = { type: 'delete-many', objectIds: objects.map((o) => o.id) };
        this._recordFromResult(userId, result);
        return result;
      }
      if (entry.action === 'delete-batch') {
        for (const obj of entry.objects) this.objects.set(obj.id, obj);
        this._pushRedo(entry);
        this.touch();
        const result = { type: 'restore-many', objects: entry.objects };
        this._recordFromResult(userId, result);
        return result;
      }
      if (entry.action === 'reorder') {
        // Only valid if the object set hasn't changed shape since (e.g. no deletes/creates
        // interleaved) — if it has, this reorder no longer applies cleanly, so skip it
        // rather than risk dropping or duplicating objects.
        if (entry.before.length !== this.objects.size || !entry.before.every((id) => this.objects.has(id))) continue;
        const newObjects = new Map();
        for (const id of entry.before) newObjects.set(id, this.objects.get(id));
        this.objects = newObjects;
        this._pushRedo(entry);
        this.touch();
        const result = { type: 'reorder', order: entry.before };
        this._recordFromResult(userId, result);
        return result;
      }
    }
    return null;
  }

  /** Embeds each touched object's freshly-bumped revision into an 'update'/'batch-update'
   *  undo/redo result so clients can reconcile their local revision cache — kept as a
   *  separate enrichment step (rather than baked into the result from the start) so
   *  `_recordFromResult`'s history payload stays revision-free, matching isValidBatchPatch's
   *  fixed field whitelist (see updateObject/batchUpdate for the same split). */
  _withRevision(result) {
    if (result.type === 'update') {
      const obj = this.objects.get(result.objectId);
      return { ...result, patch: { ...result.patch, revision: obj?.revision ?? 0 } };
    }
    if (result.type === 'batch-update') {
      return {
        ...result,
        patches: result.patches.map((p) => ({ ...p, patch: { ...p.patch, revision: this.objects.get(p.id)?.revision ?? 0 } })),
      };
    }
    return result;
  }

  /**
   * Re-applies the ROOM's most recently undone history entry — GLOBAL redo, same "one
   * shared stack" model as undo() above: whoever calls this re-applies whatever the last
   * undo() (by anyone) just reverted, regardless of who originally authored it.
   * @param {string} userId - whoever is CLICKING redo right now (lock-skip + attribution only)
   * @returns {{type:'restore', object} | {type:'update', objectId, patch} |
   *   {type:'batch-update', patches:[{objectId,patch}]} | {type:'restore-many', objects} |
   *   {type:'delete-many', objectIds} | {type:'reorder', order} | null}
   */
  redo(userId) {
    const stack = this.redoStack;
    if (stack.length === 0) return null;
    const entry = stack.pop();
    if (entry.action === 'create') {
      this.objects.set(entry.objectId, entry.object);
      this._pushUndo(entry);
      this.touch();
      const result = { type: 'restore', object: entry.object };
      this._recordFromResult(userId, { type: 'restore-many', objects: [entry.object] });
      return result;
    }
    if (entry.action === 'update') {
      const obj = this.objects.get(entry.objectId);
      if (!obj || this.locks.isLockedByOther(entry.objectId, userId)) return null;
      Object.assign(obj, entry.after);
      this._bumpRevision(obj);
      this._pushUndo(entry);
      this.touch();
      const result = { type: 'update', objectId: entry.objectId, patch: { ...entry.after } };
      this._recordFromResult(userId, result);
      return this._withRevision(result);
    }
    if (entry.action === 'batch-update') {
      const patches = [];
      for (const p of entry.patches) {
        const obj = this.objects.get(p.objectId);
        if (!obj || this.locks.isLockedByOther(p.objectId, userId)) continue;
        Object.assign(obj, p.after);
        this._bumpRevision(obj);
        patches.push({ id: p.objectId, patch: { ...p.after } });
      }
      if (patches.length === 0) return null;
      this._pushUndo(entry);
      this.touch();
      const result = { type: 'batch-update', patches };
      this._recordFromResult(userId, result, entry.opType);
      return this._withRevision(result);
    }
    if (entry.action === 'create-batch') {
      for (const obj of entry.objects) this.objects.set(obj.id, obj);
      this._pushUndo(entry);
      this.touch();
      const result = { type: 'restore-many', objects: entry.objects };
      this._recordFromResult(userId, result);
      return result;
    }
    if (entry.action === 'delete-batch') {
      const objectIds = [];
      for (const obj of entry.objects) {
        if (this.locks.isLockedByOther(obj.id, userId)) continue; // don't re-delete under an active editor
        if (this.objects.delete(obj.id)) objectIds.push(obj.id);
      }
      if (objectIds.length === 0) return null;
      this._pushUndo(entry);
      this.touch();
      const result = { type: 'delete-many', objectIds };
      this._recordFromResult(userId, result);
      return result;
    }
    if (entry.action === 'reorder') {
      if (entry.after.length !== this.objects.size || !entry.after.every((id) => this.objects.has(id))) return null;
      const newObjects = new Map();
      for (const id of entry.after) newObjects.set(id, this.objects.get(id));
      this.objects = newObjects;
      this._pushUndo(entry);
      this.touch();
      const result = { type: 'reorder', order: entry.after };
      this._recordFromResult(userId, result);
      return result;
    }
    return null;
  }

  /**
   * Names and shares the current document state as a checkpoint (Phase 9 Part E). Unlike
   * Phase 7's local snapshots, this is COLLABORATIVE — every client in the room sees it.
   * @returns {object|null} the checkpoint, or null if the name is invalid or the room
   *   already has the maximum number of named checkpoints (both pre-checked by the caller;
   *   this only re-guards the capacity limit since RoomHistory owns that count).
   */
  createCheckpoint(userId, name) {
    const checkpoint = this.history.createNamedCheckpoint({
      name, userId, username: this._username(userId), objects: this._objectsSnapshot(),
    });
    if (!checkpoint) return null;
    this._recordOp('CHECKPOINT_CREATED', userId, {}, { name, checkpointId: checkpoint.id });
    return checkpoint;
  }

  /**
   * Restores the live document to a specific historical point (Phase 9 Part F) — NOT an
   * undo: this always creates a NEW DOCUMENT_RESTORE history entry rather than truncating
   * anything, so "A → B → C, view B, restore B" becomes "A → B → C → RESTORE(B)" (#35).
   * Per-user undo/redo stacks are cleared (same as import — reverting "half a restore"
   * against a document that no longer matches wouldn't mean anything), but the history log
   * itself is untouched aside from the one new entry `loadDocument` appends.
   * @returns {{objects:object[], releasedLockIds:string[]}|null} null if `sequence` is out of range
   */
  restoreToSequence(userId, sequence) {
    if (!Number.isInteger(sequence) || sequence < this.history.baseSequence || sequence > this.history.latestSequence()) return null;
    const objects = this.history.reconstructAt(sequence);
    const releasedLockIds = this.loadDocument(objects, userId, 'DOCUMENT_RESTORE');
    return { objects, releasedLockIds };
  }

  /** Restores from a named checkpoint's own stored snapshot — cheaper and always exact,
   *  since named checkpoints keep their full document state regardless of log compaction.
   *  @returns {{objects:object[], releasedLockIds:string[]}|null} */
  restoreToCheckpoint(userId, checkpointId) {
    const checkpoint = this.history.getNamedCheckpoint(checkpointId);
    if (!checkpoint) return null;
    const objects = checkpoint.objects.map((o) => ({ ...o, points: o.points.map((p) => ({ ...p })) }));
    const releasedLockIds = this.loadDocument(objects, userId, 'DOCUMENT_RESTORE');
    return { objects, releasedLockIds };
  }

  // ---- Phase 10: soft object locking / control requests ----
  // Thin, object-existence-checked wrappers around `this.locks` — kept here (rather than
  // having handlers.js reach into room.locks directly) so "does this id actually exist in
  // THIS room" is checked in exactly one place, the same discipline as every persistent
  // mutation method above. RoomLocks itself never touches this.objects.

  /** Atomic multi-object acquire — ids that don't exist in this room are dropped first
   *  (never granted, never counted as a conflict); the remaining ids are then all-or-none. */
  acquireLocks(userId, userName, socketId, objectIds) {
    const existing = objectIds.filter((id) => this.objects.has(id));
    if (existing.length === 0) return { ok: false, reason: 'no-such-objects' };
    const result = this.locks.tryAcquireMany(existing, { userId, userName, socketId });
    if (result.ok) this.touch();
    return result.ok ? { ok: true, objectIds: existing } : result;
  }

  releaseLocks(userId, objectIds) {
    return this.locks.release(objectIds, userId);
  }

  heartbeatLocks(userId, objectIds) {
    return this.locks.heartbeat(objectIds, userId);
  }

  requestControl(objectId, requester) {
    if (!this.objects.has(objectId)) return { ok: false, reason: 'no-such-object' };
    return this.locks.requestControl(objectId, requester);
  }

  respondToControl(objectId, responderUserId, action) {
    return this.locks.respondToControl(objectId, responderUserId, action);
  }

  /**
   * "Import With History" (Phase 9 Part I) — wholesale-replaces this room's history log
   * with an already-validated (isValidHistoryExport) imported one, re-importing any named
   * checkpoints too. Only ever called right after `loadDocument` has already set the
   * current objects to match, so the log's final reconstructed state and the live document
   * agree by construction.
   */
  importHistory(userId, historyBlock) {
    this.history.replaceWith(historyBlock.operations, () => this._objectsSnapshot());
    for (const cp of historyBlock.checkpoints ?? []) {
      if (!isValidCheckpointName(cp.name) || !Array.isArray(cp.objects) || !cp.objects.every(isValidCanvasObject)) continue;
      this.history.createNamedCheckpoint({ name: cp.name, userId, username: this._username(userId), objects: cp.objects });
    }
  }
}
