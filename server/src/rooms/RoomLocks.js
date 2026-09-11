import { LIMITS } from '@synccanvas/shared';

/**
 * Per-room soft-lock registry (Phase 10). Purely EPHEMERAL, in-memory presence-style state
 * — never touches Room.objects, never enters RoomHistory, never appears in a JSON export,
 * autosave, PNG, or session replay. Locks reduce editing conflicts but are advisory: the
 * real safety net is the object revision check in Room.updateObject/batchUpdate, since a
 * lock owner can still send a stale packet due to network reordering (locked != valid).
 *
 * "Control requests" (the takeover flow — "Arpan is editing" + [Request Control]) are kept
 * here too, one pending request per object, latest request wins. Neither locks nor control
 * requests use their own timers: server/src/socket/handlers.js runs a single shared sweep
 * across every room's RoomLocks instance, keeping Room/RoomLocks themselves timer-free and
 * trivially unit-testable with an injected `now`.
 */
export class RoomLocks {
  constructor() {
    /** @type {Map<string, {userId:string, userName:string, socketId:string, acquiredAt:number, lastHeartbeat:number}>} */
    this.locks = new Map();
    /** @type {Map<string, {requesterId:string, requesterName:string, requesterSocketId:string, expiresAt:number}>} */
    this.controlRequests = new Map();
  }

  get(objectId) {
    return this.locks.get(objectId) ?? null;
  }

  isLockedByOther(objectId, userId) {
    const lock = this.locks.get(objectId);
    return !!lock && lock.userId !== userId;
  }

  /**
   * Atomically acquires every id in `objectIds` for `user`, or none of them — a
   * multi-object drag/style-edit either fully works or is fully denied, never half.
   * Re-acquiring ids you already hold is always fine (refreshes them in place).
   * @returns {{ok:true} | {ok:false, blockedBy:object, objectId:string}}
   */
  tryAcquireMany(objectIds, user, now = Date.now()) {
    for (const id of objectIds) {
      const existing = this.locks.get(id);
      if (existing && existing.userId !== user.userId) {
        return { ok: false, blockedBy: existing, objectId: id };
      }
    }
    for (const id of objectIds) {
      const existing = this.locks.get(id);
      this.locks.set(id, {
        userId: user.userId,
        userName: user.userName,
        socketId: user.socketId,
        acquiredAt: existing?.userId === user.userId ? existing.acquiredAt : now,
        lastHeartbeat: now,
      });
    }
    return { ok: true };
  }

  /** Releases `objectIds` owned by `userId` — ids not owned by them (or not locked at all)
   *  are silently skipped, same "tolerate a partially-stale request" spirit as batchUpdate.
   *  @returns {string[]} the ids actually released */
  release(objectIds, userId) {
    const released = [];
    for (const id of objectIds) {
      const lock = this.locks.get(id);
      if (lock && lock.userId === userId) {
        this.locks.delete(id);
        released.push(id);
      }
    }
    return released;
  }

  /** Refreshes the TTL for every id in `objectIds` this user actually owns.
   *  @returns {string[]} the ids actually refreshed */
  heartbeat(objectIds, userId, now = Date.now()) {
    const touched = [];
    for (const id of objectIds) {
      const lock = this.locks.get(id);
      if (lock && lock.userId === userId) {
        lock.lastHeartbeat = now;
        touched.push(id);
      }
    }
    return touched;
  }

  /** Disconnect cleanup — releases EVERY lock a user holds, no exceptions, no ghost locks. */
  releaseAllForUser(userId) {
    const released = [];
    for (const [id, lock] of this.locks) {
      if (lock.userId === userId) {
        this.locks.delete(id);
        released.push(id);
      }
    }
    return released;
  }

  /** Reaps locks that haven't been refreshed (mutation or heartbeat) within the TTL window. */
  sweepExpiredLocks(now = Date.now(), ttlMs = LIMITS.LOCK_TTL_MS) {
    const expired = [];
    for (const [id, lock] of this.locks) {
      if (now - lock.lastHeartbeat > ttlMs) {
        this.locks.delete(id);
        expired.push(id);
      }
    }
    return expired;
  }

  /** Document-level replace (clear/import/restore) — drops every lock referencing an
   *  object that no longer exists, so nothing is left pointing at a deleted object. */
  releaseForMissingObjects(existingIds) {
    const idSet = new Set(existingIds);
    const released = [];
    for (const [id] of this.locks) {
      if (!idSet.has(id)) {
        this.locks.delete(id);
        released.push(id);
      }
    }
    return released;
  }

  // ---- Request Control (takeover flow) ----

  /**
   * Records a "please release this" request against the current lock holder. Only makes
   * sense against an object someone else actually holds — deliberately NOT an arbitrary
   * force-unlock: the holder always gets to say no. Latest request replaces any pending
   * one for the same object (this is a lightweight nudge, not a queue).
   * @returns {{ok:true, holder:object} | {ok:false, reason:'not-locked'}}
   */
  requestControl(objectId, requester, now = Date.now()) {
    const holder = this.locks.get(objectId);
    if (!holder || holder.userId === requester.userId) return { ok: false, reason: 'not-locked' };
    this.controlRequests.set(objectId, {
      requesterId: requester.userId,
      requesterName: requester.userName,
      requesterSocketId: requester.socketId,
      expiresAt: now + LIMITS.CONTROL_REQUEST_TTL_MS,
    });
    return { ok: true, holder };
  }

  /**
   * The lock holder answers a pending control request. 'release' clears the lock (the
   * caller — handlers.js — is responsible for actually re-granting it to the requester,
   * since that also means broadcasting OBJECT_LOCK_GRANTED). 'keep' just clears the
   * request and leaves the lock exactly as it was.
   * @returns {{ok:true, request:object, action:'release'|'keep'} | {ok:false, reason:string}}
   */
  respondToControl(objectId, responderUserId, action) {
    const request = this.controlRequests.get(objectId);
    if (!request) return { ok: false, reason: 'no-pending-request' };
    const holder = this.locks.get(objectId);
    if (!holder || holder.userId !== responderUserId) return { ok: false, reason: 'not-holder' };
    this.controlRequests.delete(objectId);
    if (action === 'release') this.locks.delete(objectId);
    return { ok: true, request, action };
  }

  /** Reaps control requests the lock holder never answered in time. */
  sweepExpiredControlRequests(now = Date.now()) {
    const expired = [];
    for (const [objectId, request] of this.controlRequests) {
      if (now >= request.expiresAt) {
        this.controlRequests.delete(objectId);
        expired.push({ objectId, ...request });
      }
    }
    return expired;
  }

  count() {
    return this.locks.size;
  }

  /** A snapshot for a joining/reconnecting client — so someone who opens the room mid-
   *  session immediately sees "Arpan is editing this object" instead of finding out only
   *  once the next lock-related broadcast happens to arrive. */
  serialize() {
    return [...this.locks.entries()].map(([objectId, lock]) => ({
      objectId, userId: lock.userId, userName: lock.userName,
    }));
  }
}
