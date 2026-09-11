import { EVENTS, LIMITS } from '@synccanvas/shared';
import { createSocket } from './socket.js';
import { usePresenceStore } from '../store/usePresenceStore.js';
import { useConnectionStore } from '../store/useConnectionStore.js';
import { useCanvasMetaStore } from '../store/useCanvasMetaStore.js';
import { useDevStore } from '../store/useDevStore.js';
import { useToastStore } from '../store/useToastStore.js';
import { useFollowStore } from '../store/useFollowStore.js';
import { useViewportStore } from '../store/useViewportStore.js';
import { useLockStore } from '../store/useLockStore.js';
import { logger } from '../utils/logger.js';

// Only these events are subject to the network simulator — connection lifecycle (join,
// ping, undo/redo/clear) always goes out immediately so the simulator demonstrates
// "collaboration feels laggy" without also making the app itself feel broken. The three
// Phase 5 ephemeral events (laser/viewport/selection) are included deliberately: under
// simulated latency, presence-style awareness should lag right along with drawing.
const SIMULATABLE_EVENTS = new Set([
  EVENTS.DRAW_START, EVENTS.DRAW_UPDATE, EVENTS.DRAW_END, EVENTS.CURSOR_MOVE,
  EVENTS.LASER_MOVE, EVENTS.VIEWPORT_UPDATE, EVENTS.SELECTION_CHANGE, EVENTS.OBJECT_UPDATE,
  EVENTS.TRANSFORM_PREVIEW, EVENTS.BATCH_UPDATE, EVENTS.OBJECTS_CREATE, EVENTS.OBJECTS_DELETE,
]);

const PING_INTERVAL_MS = 3000;

/**
 * Bridges a CanvasEngine to a Socket.IO room. All engine <-> network wiring lives here so
 * the engine stays network-agnostic and the socket lifecycle stays out of React.
 *
 * Reconnection strategy: on any reconnect we don't try to merge/replay missed operations
 * client-side. We just re-run join-room and let the server hand back its authoritative
 * object list, which we use to wholesale-replace the local scene. That's a deliberate
 * simplification (documented in docs/ENGINEERING_DECISIONS.md) — it trades "seamless
 * offline editing" for "always provably correct after reconnect," which matters far more
 * for a short-lived whiteboard session than uninterrupted offline drawing.
 */
export class RoomConnection {
  constructor(engine, { roomId, username, userId }) {
    this.engine = engine;
    this.roomId = roomId;
    this.username = username;
    this.userId = userId;
    this.socket = createSocket();
    this.pingTimer = null;
    this.lockHeartbeatTimer = null;
    this.hasJoinedOnce = false;

    this._bindEngine();
    this._bindSocket();
  }

  connect() {
    useConnectionStore.getState().setStatus('connecting');
    this.socket.connect();
  }

  disconnect() {
    clearInterval(this.pingTimer);
    clearInterval(this.lockHeartbeatTimer);
    this._unbindEngine();
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }

  requestUndo() { this.socket.emit(EVENTS.UNDO); }
  requestRedo() { this.socket.emit(EVENTS.REDO); }
  requestClear() { this.socket.emit(EVENTS.CLEAR_CANVAS); }

  // ---- Phase 10: soft locking / control requests ----
  // Deliberately never routed through `_send` — locks/control events are never subject to
  // the network latency simulator (see SIMULATABLE_EVENTS below): pretending a lock
  // request is "slow" would make collaborators fight over stale ownership info, exactly
  // the confusion locks exist to prevent.

  requestControl(objectId) { this.socket.emit(EVENTS.REQUEST_CONTROL, { objectId }); }
  respondToControl(objectId, action) { this.socket.emit(EVENTS.CONTROL_RESPONSE, { objectId, action }); }

  /** Sends a whole document's objects to replace the room's persistent state — used by
   *  JSON import, snapshot restore, and crash recovery alike (see EVENTS.IMPORT_DOCUMENT).
   *  Not run through the optimistic-local-apply pattern the way drawing is: the server's
   *  DOCUMENT_IMPORTED broadcast (sent to everyone, sender included) is what actually
   *  applies it, so the importer converges through the same authoritative path as
   *  everyone else instead of guessing what the server will accept. */
  requestImportDocument(objects, history) { this.socket.emit(EVENTS.IMPORT_DOCUMENT, { objects, history }); }

  /** Layer reorder (front/back/forward/backward) always round-trips through the server —
   *  never applied optimistically, so every client converges on an identical order. See
   *  CanvasEngine.requestReorder / applyReorder. */
  requestReorder(ids, op) { this.socket.emit(EVENTS.REORDER_OBJECTS, { ids, op }); }

  // ---- Phase 9: persistent history / replay / time travel ----

  /** Fetches the room's whole operation log — used once when the History panel first
   *  opens; the client then reconstructs every historical state LOCALLY (see
   *  shared/history/reconstruct.js) so scrubbing never round-trips per tick. */
  requestHistory() {
    return new Promise((resolve) => {
      this.socket.emit(EVENTS.GET_HISTORY, {}, (res) => resolve(res?.ok ? res.history : null));
    });
  }

  /** Names and shares the CURRENT live document as a checkpoint — collaborative, unlike
   *  Phase 7's local snapshots (every client in the room will see it via CHECKPOINT_CREATED). */
  createCheckpoint(name) {
    return new Promise((resolve) => {
      this.socket.emit(EVENTS.CREATE_CHECKPOINT, { name }, (res) => resolve(res?.ok ? res.checkpoint : null));
    });
  }

  /** Requests the live document be replaced by a historical version — either a raw
   *  sequence number (time-travel jump) or a named checkpoint id. Always round-trips
   *  through the server (never optimistic): the server is the one place that can validate
   *  the target and record the resulting DOCUMENT_RESTORE operation authoritatively. */
  requestRestore({ sequence, checkpointId }) {
    this.socket.emit(EVENTS.RESTORE_VERSION, { sequence, checkpointId });
  }

  /**
   * Emits `event`, optionally delayed by the dev-tools "simulated network" setting.
   * This is what makes the latency simulator real rather than cosmetic: the local
   * CanvasEngine has already rendered the stroke synchronously (optimistic local
   * render), so only what OTHER clients see is delayed — exactly what a slow network
   * would actually do.
   */
  _send(event, payload) {
    const latency = SIMULATABLE_EVENTS.has(event) ? useDevStore.getState().simulatedLatencyMs : 0;
    const scheduledAt = performance.now();
    const emit = () => {
      if (!this.socket.connected) return;
      if (latency > 0) logger.debug(`[latency-sim] ${event} sent after ${(performance.now() - scheduledAt).toFixed(0)}ms (requested ${latency}ms)`);
      this.socket.emit(event, payload);
      useConnectionStore.getState().incrementSent();
    };
    if (latency > 0) setTimeout(emit, latency);
    else emit();
  }

  // ---- engine -> network ----
  _bindEngine() {
    this._onDrawStart = (e) => this._send(EVENTS.DRAW_START, e.detail);
    this._onDrawUpdate = (e) => this._send(EVENTS.DRAW_UPDATE, e.detail);
    this._onDrawEnd = (e) => this._send(EVENTS.DRAW_END, e.detail);
    this._onLocalCursor = (e) => this._send(EVENTS.CURSOR_MOVE, e.detail);
    this._onObjectCount = (e) => useCanvasMetaStore.getState().setObjectCount(e.detail);
    this._onLocalLaser = (e) => this._send(EVENTS.LASER_MOVE, e.detail);
    this._onLocalSelection = (e) => this._send(EVENTS.SELECTION_CHANGE, e.detail);
    this._onLocalObjectUpdate = (e) => this._send(EVENTS.OBJECT_UPDATE, e.detail);
    this._onLocalTransformPreview = (e) => this._send(EVENTS.TRANSFORM_PREVIEW, e.detail);
    this._onLocalBatchUpdate = (e) => this._send(EVENTS.BATCH_UPDATE, e.detail);
    this._onLocalObjectsCreate = (e) => this._send(EVENTS.OBJECTS_CREATE, e.detail);
    this._onLocalObjectsDelete = (e) => this._send(EVENTS.OBJECTS_DELETE, e.detail);
    this._onLocalReorderRequest = (e) => this.requestReorder(e.detail.ids, e.detail.op);
    // Phase 10: fire straight to the socket, bypassing _send's latency simulator on
    // purpose (see requestControl/respondToControl above for why).
    this._onLocalLockRequest = (e) => {
      this.socket.emit(EVENTS.OBJECTS_LOCK_REQUEST, { objectIds: e.detail.objectIds }, (res) => {
        if (!res?.ok && res?.error === 'locked') {
          const name = res.lockedBy?.userName ?? 'Someone';
          useToastStore.getState().push(`${name} is already editing this`, 'error');
        }
      });
    };
    this._onLocalLockRelease = (e) => this.socket.emit(EVENTS.OBJECTS_LOCK_RELEASE, { objectIds: e.detail.objectIds });
    this._onLocalLockConflict = (e) => {
      const name = e.detail.ownerUserName ?? 'Someone';
      useToastStore.getState().push(`${name} is editing this object`, 'error');
    };
    this._onLocalViewport = (e) => {
      this._send(EVENTS.VIEWPORT_UPDATE, e.detail);
      // A genuine local pan/zoom is exactly the signal that should cancel Follow Mode —
      // this listener never fires from applyRemoteViewport (see CanvasEngine), so it
      // can't misfire while we're just tracking someone else.
      const following = useFollowStore.getState().followingUserId;
      if (following) useFollowStore.getState().stopFollowing();
    };

    this.engine.addEventListener('draw-start', this._onDrawStart);
    this.engine.addEventListener('draw-update', this._onDrawUpdate);
    this.engine.addEventListener('draw-end', this._onDrawEnd);
    this.engine.addEventListener('local-cursor', this._onLocalCursor);
    this.engine.addEventListener('object-count-change', this._onObjectCount);
    this.engine.addEventListener('local-laser-point', this._onLocalLaser);
    this.engine.addEventListener('local-selection-change', this._onLocalSelection);
    this.engine.addEventListener('local-viewport-broadcast', this._onLocalViewport);
    this.engine.addEventListener('local-object-update', this._onLocalObjectUpdate);
    this.engine.addEventListener('local-transform-preview', this._onLocalTransformPreview);
    this.engine.addEventListener('local-batch-update', this._onLocalBatchUpdate);
    this.engine.addEventListener('local-objects-create', this._onLocalObjectsCreate);
    this.engine.addEventListener('local-objects-delete', this._onLocalObjectsDelete);
    this.engine.addEventListener('local-reorder-request', this._onLocalReorderRequest);
    this.engine.addEventListener('local-lock-request', this._onLocalLockRequest);
    this.engine.addEventListener('local-lock-release', this._onLocalLockRelease);
    this.engine.addEventListener('local-lock-conflict', this._onLocalLockConflict);
  }

  _unbindEngine() {
    this.engine.removeEventListener('draw-start', this._onDrawStart);
    this.engine.removeEventListener('draw-update', this._onDrawUpdate);
    this.engine.removeEventListener('draw-end', this._onDrawEnd);
    this.engine.removeEventListener('local-cursor', this._onLocalCursor);
    this.engine.removeEventListener('object-count-change', this._onObjectCount);
    this.engine.removeEventListener('local-laser-point', this._onLocalLaser);
    this.engine.removeEventListener('local-selection-change', this._onLocalSelection);
    this.engine.removeEventListener('local-viewport-broadcast', this._onLocalViewport);
    this.engine.removeEventListener('local-object-update', this._onLocalObjectUpdate);
    this.engine.removeEventListener('local-transform-preview', this._onLocalTransformPreview);
    this.engine.removeEventListener('local-batch-update', this._onLocalBatchUpdate);
    this.engine.removeEventListener('local-objects-create', this._onLocalObjectsCreate);
    this.engine.removeEventListener('local-objects-delete', this._onLocalObjectsDelete);
    this.engine.removeEventListener('local-reorder-request', this._onLocalReorderRequest);
    this.engine.removeEventListener('local-lock-request', this._onLocalLockRequest);
    this.engine.removeEventListener('local-lock-release', this._onLocalLockRelease);
    this.engine.removeEventListener('local-lock-conflict', this._onLocalLockConflict);
  }

  // ---- network -> engine / stores ----
  _bindSocket() {
    const s = this.socket;
    const received = () => useConnectionStore.getState().incrementReceived();

    s.on('connect', () => this._joinRoom());

    s.io.on('reconnect_attempt', () => useConnectionStore.getState().setStatus('reconnecting'));
    s.on('disconnect', () => useConnectionStore.getState().setStatus('reconnecting'));

    s.on('connect_error', () => {
      if (!this.hasJoinedOnce && !this._warnedUnreachable) {
        this._warnedUnreachable = true;
        useToastStore.getState().push('Unable to reach the collaboration server', 'error');
      }
    });

    s.on(EVENTS.USER_JOINED, ({ user }) => { usePresenceStore.getState().addUser(user); received(); });
    s.on(EVENTS.USER_LEFT, ({ userId }) => {
      const leavingUser = usePresenceStore.getState().users.get(userId);
      usePresenceStore.getState().removeUser(userId);
      this.engine.removeRemoteCursor(userId);
      this.engine.clearRemoteLaser(userId);
      this.engine.clearRemoteSelection(userId);
      useViewportStore.getState().clearViewport(userId);

      if (useFollowStore.getState().followingUserId === userId) {
        useFollowStore.getState().stopFollowing();
        useToastStore.getState().push(`${leavingUser?.username ?? 'That user'} disconnected. Follow mode stopped.`);
      }
      received();
    });

    s.on(EVENTS.CURSOR_UPDATE, ({ userId, x, y }) => {
      const user = usePresenceStore.getState().users.get(userId);
      this.engine.setRemoteCursor(userId, { x, y, username: user?.username, color: user?.color ?? '#666' });
      received();
    });

    s.on(EVENTS.LASER_MOVE, ({ userId, x, y }) => {
      const user = usePresenceStore.getState().users.get(userId);
      this.engine.applyRemoteLaserPoint(userId, { x, y }, user?.color ?? '#F43F5E');
      received();
    });

    s.on(EVENTS.VIEWPORT_UPDATE, ({ userId, x, y, scale }) => {
      const viewport = { x, y, scale };
      useViewportStore.getState().setViewport(userId, viewport);
      if (useFollowStore.getState().followingUserId === userId) this.engine.applyRemoteViewport(viewport);
      received();
    });

    s.on(EVENTS.SELECTION_CHANGE, ({ userId, objectIds }) => {
      if (!objectIds || objectIds.length === 0) {
        this.engine.clearRemoteSelection(userId);
      } else {
        const user = usePresenceStore.getState().users.get(userId);
        this.engine.setRemoteSelection(userId, { objectIds, color: user?.color ?? '#6366F1', username: user?.username ?? 'Someone' });
      }
      received();
    });

    // Live drag/resize preview from another collaborator — ephemeral, see EVENTS.TRANSFORM_PREVIEW.
    s.on(EVENTS.TRANSFORM_PREVIEW, ({ patches }) => { this.engine.applyTransformPreview(patches); received(); });

    s.on(EVENTS.DRAW_START, (object) => { this.engine.applyObjectStart(object); received(); this.onLiveChange?.(); });
    s.on(EVENTS.DRAW_UPDATE, ({ id, points }) => { this.engine.applyObjectPoints(id, points); received(); });
    s.on(EVENTS.DRAW_END, () => received());
    s.on(EVENTS.OBJECT_DELETE, ({ id }) => { this.engine.removeObject(id); received(); this.onLiveChange?.(); });
    s.on(EVENTS.OBJECT_RESTORE, (object) => { this.engine.restoreObject(object); received(); this.onLiveChange?.(); });
    s.on(EVENTS.OBJECT_UPDATE, ({ id, patch }) => { this.engine.applyObjectUpdate(id, patch); received(); this.onLiveChange?.(); });
    // Phase 8 batch transactions — see CanvasEngine.applyBatchUpdate/createObjects/etc.
    // These listeners fire both for OTHER collaborators' actions and for our own
    // undo/redo (the server broadcasts undo/redo results to everyone, sender included,
    // since undo/redo is never applied optimistically — see docs/SYNC_PROTOCOL.md).
    s.on(EVENTS.BATCH_UPDATE, ({ patches }) => { this.engine.applyBatchUpdate(patches); received(); this.onLiveChange?.(); });
    s.on(EVENTS.OBJECTS_CREATE, ({ objects }) => { this.engine.createObjects(objects); received(); this.onLiveChange?.(); });
    s.on(EVENTS.OBJECTS_DELETE, ({ ids }) => { this.engine.deleteObjectsBatch(ids); received(); this.onLiveChange?.(); });
    s.on(EVENTS.REORDER_OBJECTS, ({ order }) => { this.engine.applyReorder(order); received(); this.onLiveChange?.(); });
    s.on(EVENTS.CLEAR_CANVAS, () => { this.engine.clearAll(); received(); this.onLiveChange?.(); });
    s.on(EVENTS.DOCUMENT_IMPORTED, ({ objects }) => {
      this.engine.loadDocument(objects);
      received();
      this.onDocumentImported?.();
      this.onLiveChange?.();
    });

    // ---- Phase 10: soft locking / conflict safety ----
    s.on(EVENTS.OBJECT_LOCK_GRANTED, ({ objectIds, userId, userName }) => {
      const color = usePresenceStore.getState().users.get(userId)?.color;
      this.engine.applyLockGranted(objectIds, userId, userName, color);
      received();
    });
    s.on(EVENTS.OBJECT_LOCK_RELEASED, ({ objectIds }) => { this.engine.applyLockReleased(objectIds); received(); });

    // The real safety net, independent of locks: the server rejected our own update
    // (stale revision, or someone else's lock) and hands back what's actually true.
    // Reconciliation is always quiet — a toast, never a blocking modal (spec: "NO SCARY
    // ERROR MODALS").
    s.on(EVENTS.UPDATE_REJECTED, ({ kind, objectId, reason, authoritativeObject, lockedBy }) => {
      useConnectionStore.getState().incrementRejected();
      if (kind === 'delete') {
        // We already optimistically removed this locally (see CanvasEngine.commitDeleteObjects) — restore it.
        if (authoritativeObject) this.engine.restoreObject(authoritativeObject);
        this.engine.flagConflict(objectId);
        useToastStore.getState().push(`${lockedBy?.userName ?? 'Someone'} is editing this object — not deleted`, 'error');
      } else if (authoritativeObject) {
        this.engine.reconcileRejectedObject(authoritativeObject);
        if (reason === 'lock-denied') {
          useToastStore.getState().push(`${lockedBy?.userName ?? 'Someone'} is editing this object`, 'error');
        } else {
          useToastStore.getState().push('Updated remotely — your change was reverted');
        }
      }
      received();
    });

    s.on(EVENTS.CONTROL_REQUESTED, ({ objectId, requesterId, requesterName }) => {
      useLockStore.getState().setIncomingRequest({ objectId, requesterId, requesterName });
      received();
    });
    // The lock itself already arrives via OBJECT_LOCK_GRANTED — this is just the toast.
    s.on(EVENTS.CONTROL_GRANTED, () => {
      useToastStore.getState().push('You now have control');
      received();
    });
    s.on(EVENTS.CONTROL_DENIED, ({ reason }) => {
      useToastStore.getState().push(reason === 'kept' ? 'They chose to keep editing' : 'Request timed out', 'error');
      received();
    });

    // Phase 9: a collaborator (possibly us, via our own ack) named a shared checkpoint —
    // surfaced to the History panel so its checkpoint list/markers stay live without
    // needing to re-fetch the whole log.
    s.on(EVENTS.CHECKPOINT_CREATED, ({ checkpoint }) => { this.onCheckpointCreated?.(checkpoint); received(); });

    s.on(EVENTS.PONG, (sentAt) => useConnectionStore.getState().setLatency(Date.now() - sentAt));
  }

  _joinRoom() {
    this.socket.emit(
      EVENTS.JOIN_ROOM,
      { roomId: this.roomId, username: this.username, userId: this.userId },
      (res) => {
        if (!res?.ok) {
          logger.error('join-room rejected', res?.error);
          useConnectionStore.getState().setStatus('disconnected');
          this.onJoinError?.(res?.error ?? 'unknown-error');
          return;
        }

        this.roomId = res.roomId;
        usePresenceStore.getState().setSelf(res.selfId);
        usePresenceStore.getState().setUsers(res.users);

        this.engine.clearAll();
        for (const object of res.objects) this.engine.applyObjectStart(object);

        // Phase 10: a joining/reconnecting client starts from whatever the server says is
        // CURRENTLY true — never merged with anything left over locally (we never reclaim
        // our own prior locks on reconnect; see Room.removeUser server-side).
        this.engine.setSelfUserId(res.selfId);
        const presenceUsers = usePresenceStore.getState().users;
        this.engine.setLockSnapshot((res.locks ?? []).map((l) => ({ ...l, color: presenceUsers.get(l.userId)?.color })));

        if (this.hasJoinedOnce) useToastStore.getState().push('Connection restored');
        useConnectionStore.getState().setStatus('connected');
        this.hasJoinedOnce = true;
        this.onJoined?.(res);

        // Broadcast our current viewport once immediately on join so anyone who follows
        // us later has an instant baseline instead of waiting for our next pan/zoom.
        this.socket.emit(EVENTS.VIEWPORT_UPDATE, { ...this.engine.viewport });

        if (!this.pingTimer) {
          this.pingTimer = setInterval(() => this.socket.emit(EVENTS.PING, Date.now()), PING_INTERVAL_MS);
        }
        // Refreshes whatever we currently hold — a no-op emit when we hold nothing, so an
        // idle room doesn't generate heartbeat traffic just because someone once dragged
        // a shape. Never subject to the latency simulator, same as every other lock event.
        if (!this.lockHeartbeatTimer) {
          this.lockHeartbeatTimer = setInterval(() => {
            const objectIds = [...this.engine.myLockedIds];
            if (objectIds.length > 0) this.socket.emit(EVENTS.OBJECT_LOCK_HEARTBEAT, { objectIds });
          }, LIMITS.LOCK_HEARTBEAT_INTERVAL_MS);
        }
      },
    );
  }
}
