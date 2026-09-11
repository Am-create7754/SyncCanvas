import { customAlphabet } from 'nanoid';
import {
  EVENTS,
  LIMITS,
  USER_COLORS,
  isValidRoomId,
  isValidUsername,
  sanitizeUsername,
  isValidId,
  isValidPoint,
  isValidPointArray,
  isValidColor,
  isValidStrokeWidth,
  isValidToolType,
  isValidViewport,
  isValidStylePatch,
  isValidCanvasObject,
  isValidBatchPatch,
  isValidIdArray,
  isValidReorderOp,
  isValidBatchOpType,
  isValidCheckpointName,
  isValidSequence,
  isValidRevision,
  isValidRotation,
  isValidHistoryExport,
  FILLABLE_TYPES,
} from '@synccanvas/shared';
import { logger } from '../utils/logger.js';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 12);

const pickColor = (room) => {
  const used = new Set([...room.users.values()].map((u) => u.color));
  const free = USER_COLORS.find((c) => !used.has(c));
  return free ?? USER_COLORS[room.users.size % USER_COLORS.length];
};

/**
 * Pulls the optional fill fields off a draw-start payload for a fillable shape type,
 * validating each one that's actually present. A shape simply never gets fill keys if
 * the client didn't send them (e.g. old client, or a non-fillable type) — the renderer
 * already treats a missing `fillEnabled` as "no fill", so there's no need to default them
 * here too.
 */
function extractFillFields(type, payload) {
  if (!FILLABLE_TYPES.has(type)) return {};
  const patch = {};
  if ('fillEnabled' in payload) {
    if (typeof payload.fillEnabled !== 'boolean') return null;
    patch.fillEnabled = payload.fillEnabled;
  }
  if ('fillColor' in payload) {
    if (!isValidStylePatch({ fillColor: payload.fillColor })) return null;
    patch.fillColor = payload.fillColor;
  }
  if ('fillOpacity' in payload) {
    if (!isValidStylePatch({ fillOpacity: payload.fillOpacity })) return null;
    patch.fillOpacity = payload.fillOpacity;
  }
  return patch;
}

/**
 * Wires every Socket.IO connection to room state. Kept deliberately free of transport
 * details beyond the `io`/`socket` handles so the room logic itself (Room/RoomManager)
 * stays testable without a live network.
 */
export function attachSocketHandlers(io, roomManager) {
  io.on('connection', (socket) => {
    let lastCursorAt = 0;
    let lastLaserAt = 0;
    let lastViewportAt = 0;
    let lastTransformPreviewAt = 0;
    let lastLockRequestAt = 0;
    let lastLockHeartbeatAt = 0;

    socket.on(EVENTS.JOIN_ROOM, ({ roomId, username, userId } = {}, ack) => {
      try {
        const cleanUsername = isValidUsername(username) ? sanitizeUsername(username) : `Guest ${nanoid(4)}`;
        let room;

        if (roomId) {
          if (!isValidRoomId(roomId)) return ack?.({ ok: false, error: 'invalid-room-id' });
          room = roomManager.getOrCreate(roomId);
        } else {
          room = roomManager.createRoom();
        }

        const hasKnownId = userId && isValidId(userId);
        // Decision extracted onto Room itself (see Room.resolveJoinMode) so the exact
        // race it guards against — a disconnect-grace timer that outlives the user record
        // it was scheduled for, e.g. two connections briefly sharing one userId — is unit
        // testable without a live socket.
        const joinMode = room.resolveJoinMode(userId, hasKnownId);

        if (joinMode.mode === 'create' && !joinMode.wasReconnecting && room.users.size >= LIMITS.MAX_USERS_PER_ROOM) {
          return ack?.({ ok: false, error: 'room-full' });
        }

        let selfId;
        if (joinMode.mode === 'update') {
          clearTimeout(room.pendingRemovals.get(userId));
          room.pendingRemovals.delete(userId);
          joinMode.user.socketId = socket.id;
          joinMode.user.username = cleanUsername;
          selfId = userId;
        } else {
          // A leftover grace-timer for a userId that's already gone — clear it so it can
          // never later fire room.removeUser() against the FRESH user record we're about
          // to create for this same id.
          if (joinMode.wasReconnecting) {
            clearTimeout(room.pendingRemovals.get(userId));
            room.pendingRemovals.delete(userId);
          }
          const user = {
            id: hasKnownId ? userId : nanoid(),
            username: cleanUsername,
            color: pickColor(room),
            socketId: socket.id,
          };
          room.addUser(user);
          socket.to(room.id).emit(EVENTS.USER_JOINED, { user });
          selfId = user.id;
        }

        socket.data.roomId = room.id;
        socket.data.userId = selfId;
        socket.join(room.id);

        const { users, objects } = room.getState();
        // Phase 10: a joining/reconnecting client needs the CURRENT lock registry
        // immediately, not just future broadcasts — otherwise "Arpan is editing this
        // object" would only appear once Arpan's next heartbeat happened to fire. Locks
        // are never reclaimed on reconnect (see Room.removeUser) — this is purely a
        // read of whatever's currently held by others.
        ack?.({ ok: true, selfId, roomId: room.id, users, objects, locks: room.locks.serialize() });
        logger.debug('join-room', { roomId: room.id, userId: selfId, reconnecting: joinMode.mode === 'update' || !!joinMode.wasReconnecting });
      } catch (err) {
        logger.error('join-room failed', err);
        ack?.({ ok: false, error: 'internal-error' });
      }
    });

    socket.on(EVENTS.CURSOR_MOVE, (point) => {
      const now = Date.now();
      if (now - lastCursorAt < LIMITS.CURSOR_RATE_LIMIT_MS - 5) return;
      lastCursorAt = now;
      const { roomId, userId } = socket.data;
      if (!roomId || !isValidPoint(point)) return;
      socket.to(roomId).emit(EVENTS.CURSOR_UPDATE, { userId, x: point.x, y: point.y });
    });

    // ---- ephemeral collaboration signals (Phase 5) ----
    // None of these touch Room's persistent state (objects/undoStack) — they're purely
    // relayed to the rest of the room, same treatment as cursor-move above. That's what
    // keeps a laser stroke or a selection highlight from ever becoming a real canvas
    // object, surviving a refresh, or counting toward the room's object limit.
    socket.on(EVENTS.LASER_MOVE, (point) => {
      const now = Date.now();
      if (now - lastLaserAt < LIMITS.LASER_RATE_LIMIT_MS - 5) return;
      lastLaserAt = now;
      const { roomId, userId } = socket.data;
      if (!roomId || !isValidPoint(point)) return;
      socket.to(roomId).emit(EVENTS.LASER_MOVE, { userId, x: point.x, y: point.y });
    });

    socket.on(EVENTS.VIEWPORT_UPDATE, (viewport) => {
      const now = Date.now();
      if (now - lastViewportAt < LIMITS.VIEWPORT_RATE_LIMIT_MS - 5) return;
      lastViewportAt = now;
      const { roomId, userId } = socket.data;
      if (!roomId || !isValidViewport(viewport)) return;
      socket.to(roomId).emit(EVENTS.VIEWPORT_UPDATE, { userId, x: viewport.x, y: viewport.y, scale: viewport.scale });
    });

    socket.on(EVENTS.SELECTION_CHANGE, ({ objectIds } = {}) => {
      const { roomId, userId } = socket.data;
      if (!roomId || !Array.isArray(objectIds)) return;
      if (objectIds.length > 0 && !isValidIdArray(objectIds, LIMITS.MAX_BATCH_SIZE)) return;
      socket.to(roomId).emit(EVENTS.SELECTION_CHANGE, { userId, objectIds });
    });

    // Live drag/resize preview (Phase 8) — purely relayed, exactly like laser/cursor: never
    // touches Room's persistent objects, never enters undo history. The authoritative
    // geometry arrives moments later via BATCH_UPDATE once the drag ends.
    socket.on(EVENTS.TRANSFORM_PREVIEW, ({ patches } = {}) => {
      const now = Date.now();
      if (now - lastTransformPreviewAt < LIMITS.TRANSFORM_PREVIEW_RATE_LIMIT_MS - 5) return;
      lastTransformPreviewAt = now;
      const { roomId } = socket.data;
      if (!roomId || !Array.isArray(patches) || patches.length === 0 || patches.length > LIMITS.MAX_BATCH_SIZE) return;
      for (const p of patches) {
        if (!isValidId(p?.id) || !isValidPointArray(p?.points)) return;
        // Phase 11: a live rotation-drag preview rides the same ephemeral channel as
        // move/resize — points are always included unchanged, rotation is additive.
        if (p.rotation !== undefined && !isValidRotation(p.rotation)) return;
      }
      socket.to(roomId).emit(EVENTS.TRANSFORM_PREVIEW, { patches });
    });

    socket.on(EVENTS.DRAW_START, (payload) => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !payload) return;
      const { id, type, color, width, point } = payload;
      if (!isValidId(id) || !isValidToolType(type) || !isValidColor(color) || !isValidStrokeWidth(width) || !isValidPoint(point)) {
        logger.warn('rejected draw-start', payload);
        return;
      }
      const fillFields = extractFillFields(type, payload);
      if (fillFields === null) {
        logger.warn('rejected draw-start (bad fill fields)', payload);
        return;
      }
      const object = { id, type, userId, color, width, points: [point], createdAt: Date.now(), ...fillFields };
      if (!room.addObject(object)) return;
      socket.to(roomId).emit(EVENTS.DRAW_START, object);
    });

    socket.on(EVENTS.DRAW_UPDATE, ({ id, points } = {}) => {
      const { roomId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !isValidId(id) || !isValidPointArray(points, LIMITS.MAX_POINTS_PER_BATCH)) return;
      const updated = room.appendPoints(id, points);
      if (!updated) return;
      socket.to(roomId).emit(EVENTS.DRAW_UPDATE, { id, points });
    });

    socket.on(EVENTS.DRAW_END, ({ id } = {}) => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !isValidId(id)) return;
      // The stroke/shape only becomes a MEANINGFUL history entry now that every point has
      // arrived (draw-start only carries the first one) — see Room.recordStrokeComplete.
      room.recordStrokeComplete(userId, id);
      socket.to(roomId).emit(EVENTS.DRAW_END, { id });
    });

    // Phase 10: unlike the other Phase 8 transactions below, this one now broadcasts via
    // io.to (everyone, sender included) instead of socket.to. The sender already applied
    // this patch optimistically at the ORIGINAL values, but only the server knows the new
    // authoritative revision — the sender needs this exact echo to learn it, or their next
    // edit's baseRevision would be stale against their own last change. Re-applying an
    // identical patch client-side is a harmless no-op (see CanvasEngine.applyObjectUpdate).
    socket.on(EVENTS.OBJECT_UPDATE, ({ id, patch, baseRevision } = {}) => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !isValidId(id) || !isValidStylePatch(patch)) return;
      if (baseRevision !== undefined && !isValidRevision(baseRevision)) return;
      const result = room.updateObject(userId, id, patch, baseRevision);
      if (!result.ok) {
        if (result.reason === 'not-found') return; // nothing sensible to reconcile against
        const lockedBy = result.reason === 'lock-denied' ? room.locks.get(id) : null;
        socket.emit(EVENTS.UPDATE_REJECTED, {
          kind: 'update',
          objectId: id,
          reason: result.reason,
          expectedRevision: result.authoritative.revision ?? 0,
          receivedRevision: baseRevision,
          authoritativeObject: result.authoritative,
          lockedBy: lockedBy ? { userId: lockedBy.userId, userName: lockedBy.userName } : undefined,
        });
        return;
      }
      io.to(roomId).emit(EVENTS.OBJECT_UPDATE, { id, patch: { ...result.patch, revision: result.object.revision } });
    });

    socket.on(EVENTS.CLEAR_CANVAS, () => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room) return;
      const { releasedLockIds } = room.clear(userId);
      io.to(roomId).emit(EVENTS.CLEAR_CANVAS);
      if (releasedLockIds.length > 0) io.to(roomId).emit(EVENTS.OBJECT_LOCK_RELEASED, { objectIds: releasedLockIds, reason: 'document-replaced' });
    });

    // Import/snapshot-restore/crash-recovery all funnel through here — the client has
    // already validated the whole document (format/version/metadata), but the server
    // never trusts that: every object is re-validated independently, and the import is
    // rejected atomically (no partial room state) if even one object is malformed.
    // Objects are re-attributed to the importer, since the document's original author
    // (if any) may not even be a member of this room.
    socket.on(EVENTS.IMPORT_DOCUMENT, (payload) => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !payload || !Array.isArray(payload.objects)) return;
      if (payload.objects.length > LIMITS.MAX_IMPORT_OBJECTS) {
        logger.warn('rejected import-document (too many objects)', payload.objects.length);
        return;
      }
      const importedObjects = [];
      for (const obj of payload.objects) {
        if (!isValidCanvasObject(obj)) {
          logger.warn('rejected import-document (invalid object)', obj);
          return;
        }
        importedObjects.push({ ...obj, userId });
      }
      const releasedLockIds = room.loadDocument(importedObjects, userId, 'DOCUMENT_IMPORT');

      // Optional "Export With History" companion data (Phase 9 Part I/#43) — validated
      // independently of the drawing itself; a malformed history block never blocks the
      // (already-applied) document import, it just means the history simply isn't imported.
      if (payload.history && isValidHistoryExport(payload.history)) {
        room.importHistory(userId, payload.history);
      }

      io.to(roomId).emit(EVENTS.DOCUMENT_IMPORTED, { objects: room.getState().objects });
      if (releasedLockIds.length > 0) io.to(roomId).emit(EVENTS.OBJECT_LOCK_RELEASED, { objectIds: releasedLockIds, reason: 'document-replaced' });
    });

    // ---- Phase 8 editor transactions ----
    // Move, resize, align, distribute, group, and ungroup all funnel through here: a
    // batch of {id, patch} pairs applied atomically as ONE undo entry. The sender already
    // applied this optimistically (see RoomConnection), so only other clients need it.
    // Phase 10: broadcasts via io.to (sender included) for the same reason OBJECT_UPDATE
    // does — the sender needs the authoritative revision echoed back. Any patch entry the
    // server rejects (locked by someone else, or stale) is reported to the sender ONLY via
    // UPDATE_REJECTED so it can reconcile that one object without a scary modal, while the
    // rest of the batch (e.g. a 5-object drag where 1 is contested) still goes through.
    socket.on(EVENTS.BATCH_UPDATE, ({ patches, opType } = {}) => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !Array.isArray(patches) || patches.length === 0 || patches.length > LIMITS.MAX_BATCH_SIZE) return;
      for (const p of patches) {
        if (!isValidId(p?.id) || !isValidBatchPatch(p?.patch) || (p?.baseRevision !== undefined && !isValidRevision(p.baseRevision))) {
          logger.warn('rejected batch-update', p);
          return;
        }
      }
      // opType is a pure history-log display label (Amber "moved"/"resized"/"grouped"...) —
      // never used for validation or for computing the actual patch, which is why an
      // invalid/missing one only affects Room's best-effort fallback label, not correctness.
      const { applied, rejected } = room.batchUpdate(userId, patches, isValidBatchOpType(opType) ? opType : undefined);
      if (applied.length > 0) {
        const withRevision = applied.map(({ id, patch }) => ({ id, patch: { ...patch, revision: room.objects.get(id)?.revision ?? 0 } }));
        io.to(roomId).emit(EVENTS.BATCH_UPDATE, { patches: withRevision });
      }
      for (const r of rejected) {
        const lockedBy = r.reason === 'lock-denied' ? room.locks.get(r.id) : null;
        socket.emit(EVENTS.UPDATE_REJECTED, {
          kind: 'update',
          objectId: r.id,
          reason: r.reason,
          expectedRevision: r.authoritative.revision ?? 0,
          authoritativeObject: r.authoritative,
          lockedBy: lockedBy ? { userId: lockedBy.userId, userName: lockedBy.userName } : undefined,
        });
      }
    });

    // Paste/duplicate — brand-new objects, atomic. Re-attributed to the pasting user,
    // same as import, since a duplicate of someone else's shape is a new creation by you.
    socket.on(EVENTS.OBJECTS_CREATE, ({ objects } = {}) => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !Array.isArray(objects) || objects.length === 0 || objects.length > LIMITS.MAX_BATCH_SIZE) return;
      const toAdd = [];
      for (const obj of objects) {
        if (!isValidCanvasObject(obj)) {
          logger.warn('rejected objects-create', obj);
          return;
        }
        toAdd.push({ ...obj, userId });
      }
      const added = room.createObjects(userId, toAdd);
      if (!added) return; // would exceed room capacity
      socket.to(roomId).emit(EVENTS.OBJECTS_CREATE, { objects: added });
    });

    // Multi-select delete — sender already removed these locally (see RoomConnection),
    // matching the optimistic-apply pattern move/resize use for zero-latency feedback.
    socket.on(EVENTS.OBJECTS_DELETE, ({ ids } = {}) => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !isValidIdArray(ids, LIMITS.MAX_BATCH_SIZE)) return;
      const { removedIds, deniedByLock } = room.deleteObjects(userId, ids);
      if (removedIds.length > 0) socket.to(roomId).emit(EVENTS.OBJECTS_DELETE, { ids: removedIds });
      // Phase 10: "Amber is editing this object" — never delete out from under an active
      // editor. Told to the sender only, one UPDATE_REJECTED per contested id, so a
      // multi-select delete that's mostly fine doesn't get buried in noise. kind:'delete'
      // (vs 'update') tells the client to fully RESTORE the object, not patch it — the
      // client already optimistically removed it locally before the server's answer
      // arrived (see RoomConnection/CanvasEngine.commitDeleteObjects).
      for (const { id, lockedBy } of deniedByLock) {
        socket.emit(EVENTS.UPDATE_REJECTED, {
          kind: 'delete',
          objectId: id,
          reason: 'lock-denied',
          authoritativeObject: room.objects.get(id),
          lockedBy: { userId: lockedBy.userId, userName: lockedBy.userName },
        });
      }
    });

    // Layer order: front/back/forward/backward. The server derives the new order from its
    // own authoritative current order (see Room.reorderObjects) — the client only says
    // *which* ids and *which* direction, never a full permutation.
    socket.on(EVENTS.REORDER_OBJECTS, ({ ids, op } = {}) => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !isValidIdArray(ids, LIMITS.MAX_BATCH_SIZE) || !isValidReorderOp(op)) return;
      const result = room.reorderObjects(userId, ids, op);
      if (!result) return;
      io.to(roomId).emit(EVENTS.REORDER_OBJECTS, { order: result.after });
    });

    // ---- Phase 10: soft object locking, editing presence, and takeover flow ----
    // Locks are EPHEMERAL — never recorded into RoomHistory, never part of getState()'s
    // persistent document, never exported/autosaved. Every lock/control event below is
    // deliberately excluded from RoomConnection's SIMULATABLE_EVENTS on the client (see
    // that file): pretending a lock request is "slow" would make collaborators fight over
    // stale ownership info, exactly the kind of confusion locks exist to prevent.

    socket.on(EVENTS.OBJECTS_LOCK_REQUEST, ({ objectIds } = {}, ack) => {
      const now = Date.now();
      if (now - lastLockRequestAt < LIMITS.LOCK_REQUEST_RATE_LIMIT_MS) return ack?.({ ok: false, error: 'rate-limited' });
      lastLockRequestAt = now;
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !isValidIdArray(objectIds, LIMITS.MAX_BATCH_SIZE)) return ack?.({ ok: false, error: 'invalid-request' });
      const user = room.users.get(userId);
      if (!user) return ack?.({ ok: false, error: 'not-in-room' });

      const result = room.acquireLocks(userId, user.username, socket.id, objectIds);
      if (!result.ok) {
        return ack?.({
          ok: false,
          error: result.reason === 'no-such-objects' ? 'no-such-objects' : 'locked',
          lockedBy: result.blockedBy ? { objectId: result.objectId, userId: result.blockedBy.userId, userName: result.blockedBy.userName } : undefined,
        });
      }
      io.to(roomId).emit(EVENTS.OBJECT_LOCK_GRANTED, { objectIds: result.objectIds, userId, userName: user.username });
      ack?.({ ok: true, objectIds: result.objectIds });
    });

    socket.on(EVENTS.OBJECTS_LOCK_RELEASE, ({ objectIds } = {}) => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !isValidIdArray(objectIds, LIMITS.MAX_BATCH_SIZE)) return;
      const released = room.releaseLocks(userId, objectIds);
      if (released.length > 0) io.to(roomId).emit(EVENTS.OBJECT_LOCK_RELEASED, { objectIds: released, reason: 'release' });
    });

    socket.on(EVENTS.OBJECT_LOCK_HEARTBEAT, ({ objectIds } = {}) => {
      const now = Date.now();
      if (now - lastLockHeartbeatAt < LIMITS.LOCK_HEARTBEAT_INTERVAL_MS - 100) return;
      lastLockHeartbeatAt = now;
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !isValidIdArray(objectIds, LIMITS.MAX_BATCH_SIZE)) return;
      room.heartbeatLocks(userId, objectIds);
      // No broadcast needed — a heartbeat only refreshes a TTL the rest of the room
      // never directly observes; they already know the lock exists from OBJECT_LOCK_GRANTED.
    });

    // "Arpan is editing this object" + [Request Control] — NOT chat, not a force-unlock:
    // the current holder always gets to say yes or no (spec explicitly forbids an
    // arbitrary Force Unlock for normal users; timeout/disconnect handling covers that).
    socket.on(EVENTS.REQUEST_CONTROL, ({ objectId } = {}) => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !isValidId(objectId)) return;
      const requester = room.users.get(userId);
      if (!requester) return;
      const result = room.requestControl(objectId, { userId, userName: requester.username, socketId: socket.id });
      if (!result.ok) return;
      io.to(result.holder.socketId).emit(EVENTS.CONTROL_REQUESTED, { objectId, requesterId: userId, requesterName: requester.username });
    });

    socket.on(EVENTS.CONTROL_RESPONSE, ({ objectId, action } = {}) => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !isValidId(objectId) || (action !== 'release' && action !== 'keep')) return;
      const result = room.respondToControl(objectId, userId, action);
      if (!result.ok) return;

      if (action === 'keep') {
        io.to(result.request.requesterSocketId).emit(EVENTS.CONTROL_DENIED, { objectId, reason: 'kept' });
        return;
      }

      // action === 'release': the holder's lock is already gone (RoomLocks.respondToControl
      // cleared it) — re-grant it to the requester now, server-side, only "if still valid"
      // (they must still be a member of this room; nothing else can have raced this, since
      // Node's single-threaded event loop serializes every socket event for this room).
      io.to(roomId).emit(EVENTS.OBJECT_LOCK_RELEASED, { objectIds: [objectId], reason: 'control-transfer' });
      const requesterUser = room.users.get(result.request.requesterId);
      if (!requesterUser) return; // requester left in the meantime — nothing to grant
      const grant = room.acquireLocks(result.request.requesterId, requesterUser.username, result.request.requesterSocketId, [objectId]);
      if (grant.ok) {
        io.to(roomId).emit(EVENTS.OBJECT_LOCK_GRANTED, { objectIds: [objectId], userId: result.request.requesterId, userName: requesterUser.username });
        io.to(result.request.requesterSocketId).emit(EVENTS.CONTROL_GRANTED, { objectId });
      }
    });

    // ---- Phase 9: persistent operation history / replay / time travel ----
    // Ack-based fetch of the room's whole operation log (+ checkpoints) — the client then
    // reconstructs historical states LOCALLY via the shared, pure reconstructAt/
    // applyOperation functions, so scrubbing the timeline never round-trips per tick.
    socket.on(EVENTS.GET_HISTORY, (payload, ack) => {
      const { roomId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room) return ack?.({ ok: false, error: 'not-in-room' });
      ack?.({ ok: true, history: room.history.serialize() });
    });

    socket.on(EVENTS.CREATE_CHECKPOINT, ({ name } = {}, ack) => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !isValidCheckpointName(name)) return ack?.({ ok: false, error: 'invalid-name' });
      const checkpoint = room.createCheckpoint(userId, name.trim());
      if (!checkpoint) return ack?.({ ok: false, error: 'too-many-checkpoints' });
      io.to(roomId).emit(EVENTS.CHECKPOINT_CREATED, { checkpoint });
      ack?.({ ok: true, checkpoint });
    });

    // Restores the live document to a historical sequence or a named checkpoint — always
    // creates a NEW DOCUMENT_RESTORE history entry (see Room.restoreToSequence/
    // restoreToCheckpoint), never truncates anything that came before it. Broadcasts the
    // same DOCUMENT_IMPORTED event whole-document-replacement already uses everywhere else
    // (import, snapshot restore, crash recovery) — the client-side handling is identical:
    // wholesale-replace the live scene with an authoritative object list.
    socket.on(EVENTS.RESTORE_VERSION, ({ sequence, checkpointId } = {}) => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room) return;
      const result = checkpointId
        ? (isValidId(checkpointId) ? room.restoreToCheckpoint(userId, checkpointId) : null)
        : (isValidSequence(sequence) ? room.restoreToSequence(userId, sequence) : null);
      if (!result) return;
      io.to(roomId).emit(EVENTS.DOCUMENT_IMPORTED, { objects: room.getState().objects });
      if (result.releasedLockIds.length > 0) io.to(roomId).emit(EVENTS.OBJECT_LOCK_RELEASED, { objectIds: result.releasedLockIds, reason: 'document-replaced' });
    });

    socket.on(EVENTS.UNDO, () => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !userId) return;
      const result = room.undo(userId);
      if (!result) return;
      if (result.type === 'delete') io.to(roomId).emit(EVENTS.OBJECT_DELETE, { id: result.objectId });
      else if (result.type === 'update') io.to(roomId).emit(EVENTS.OBJECT_UPDATE, { id: result.objectId, patch: result.patch });
      else if (result.type === 'batch-update') io.to(roomId).emit(EVENTS.BATCH_UPDATE, { patches: result.patches });
      else if (result.type === 'delete-many') io.to(roomId).emit(EVENTS.OBJECTS_DELETE, { ids: result.objectIds });
      else if (result.type === 'restore-many') io.to(roomId).emit(EVENTS.OBJECTS_CREATE, { objects: result.objects });
      else if (result.type === 'reorder') io.to(roomId).emit(EVENTS.REORDER_OBJECTS, { order: result.order });
    });

    socket.on(EVENTS.REDO, () => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !userId) return;
      const result = room.redo(userId);
      if (!result) return;
      if (result.type === 'restore') io.to(roomId).emit(EVENTS.OBJECT_RESTORE, result.object);
      else if (result.type === 'update') io.to(roomId).emit(EVENTS.OBJECT_UPDATE, { id: result.objectId, patch: result.patch });
      else if (result.type === 'batch-update') io.to(roomId).emit(EVENTS.BATCH_UPDATE, { patches: result.patches });
      else if (result.type === 'delete-many') io.to(roomId).emit(EVENTS.OBJECTS_DELETE, { ids: result.objectIds });
      else if (result.type === 'restore-many') io.to(roomId).emit(EVENTS.OBJECTS_CREATE, { objects: result.objects });
      else if (result.type === 'reorder') io.to(roomId).emit(EVENTS.REORDER_OBJECTS, { order: result.order });
    });

    socket.on(EVENTS.PING, (clientTs) => {
      socket.emit(EVENTS.PONG, clientTs);
    });

    socket.on('disconnect', () => {
      const { roomId, userId } = socket.data;
      const room = roomId && roomManager.getRoom(roomId);
      if (!room || !userId) return;

      // Phase 10: lock cleanup happens IMMEDIATELY on disconnect — not deferred to the
      // grace-period timer below like user removal is. Another collaborator shouldn't
      // have to wait out a reconnect grace window to edit something the disconnected
      // user was mid-edit on. Reconnecting later never reclaims these (see Room.removeUser).
      const releasedLockIds = room.locks.releaseAllForUser(userId);
      if (releasedLockIds.length > 0) io.to(roomId).emit(EVENTS.OBJECT_LOCK_RELEASED, { objectIds: releasedLockIds, reason: 'disconnect' });

      const timer = setTimeout(() => {
        room.removeUser(userId);
        room.pendingRemovals.delete(userId);
        io.to(roomId).emit(EVENTS.USER_LEFT, { userId });
        // A departing user's remote selection highlight (if any) must vanish for
        // everyone else too — cheap to always send, clients no-op if there wasn't one.
        io.to(roomId).emit(EVENTS.SELECTION_CHANGE, { userId, objectIds: [] });
        roomManager.deleteIfEmpty(roomId);
      }, LIMITS.DISCONNECT_GRACE_MS);

      room.pendingRemovals.set(userId, timer);
    });
  });

  // Phase 10: a single shared sweep across every room, rather than a per-room timer — an
  // expired lock (nobody refreshed it — no heartbeat, no mutation) or an unanswered
  // control request both need to resolve themselves even if nobody sends another packet
  // to that room again. `.unref()` keeps this from ever being the reason the process
  // stays alive (matters for a clean test-suite/server shutdown).
  const sweepTimer = setInterval(() => {
    for (const room of roomManager.rooms.values()) {
      const expiredLockIds = room.locks.sweepExpiredLocks();
      if (expiredLockIds.length > 0) io.to(room.id).emit(EVENTS.OBJECT_LOCK_RELEASED, { objectIds: expiredLockIds, reason: 'timeout' });

      const expiredRequests = room.locks.sweepExpiredControlRequests();
      for (const req of expiredRequests) {
        io.to(req.requesterSocketId).emit(EVENTS.CONTROL_DENIED, { objectId: req.objectId, reason: 'timeout' });
      }
    }
  }, LIMITS.LOCK_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}
