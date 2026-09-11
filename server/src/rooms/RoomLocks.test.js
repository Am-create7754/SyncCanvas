import { describe, it, expect } from 'vitest';
import { RoomLocks } from './RoomLocks.js';

const amber = { userId: 'amber', userName: 'Amber', socketId: 's-amber' };
const arpan = { userId: 'arpan', userName: 'Arpan', socketId: 's-arpan' };

describe('RoomLocks', () => {
  describe('tryAcquireMany', () => {
    it('grants a single-object lock to an uncontested id', () => {
      const locks = new RoomLocks();
      const result = locks.tryAcquireMany(['o1'], amber);
      expect(result).toEqual({ ok: true });
      expect(locks.get('o1')).toMatchObject({ userId: 'amber', userName: 'Amber' });
    });

    it('is atomic — a multi-object request is denied wholesale if even one id is already held by someone else', () => {
      const locks = new RoomLocks();
      locks.tryAcquireMany(['o2'], arpan);
      const result = locks.tryAcquireMany(['o1', 'o2', 'o3'], amber);
      expect(result.ok).toBe(false);
      expect(result.objectId).toBe('o2');
      // Neither o1 nor o3 should have been granted either — all-or-nothing.
      expect(locks.get('o1')).toBeNull();
      expect(locks.get('o3')).toBeNull();
    });

    it('re-acquiring ids you already hold is always fine and refreshes them', () => {
      const locks = new RoomLocks();
      locks.tryAcquireMany(['o1'], amber, 1000);
      const result = locks.tryAcquireMany(['o1', 'o2'], amber, 5000);
      expect(result.ok).toBe(true);
      expect(locks.get('o1').lastHeartbeat).toBe(5000);
      expect(locks.get('o1').acquiredAt).toBe(1000); // original acquire time preserved
    });
  });

  describe('isLockedByOther', () => {
    it('is false for an unlocked object, false for your own lock, true for someone else\'s', () => {
      const locks = new RoomLocks();
      expect(locks.isLockedByOther('o1', 'amber')).toBe(false);
      locks.tryAcquireMany(['o1'], amber);
      expect(locks.isLockedByOther('o1', 'amber')).toBe(false);
      expect(locks.isLockedByOther('o1', 'arpan')).toBe(true);
    });
  });

  describe('release', () => {
    it('releases only the ids the caller actually owns', () => {
      const locks = new RoomLocks();
      locks.tryAcquireMany(['o1'], amber);
      locks.tryAcquireMany(['o2'], arpan);
      const released = locks.release(['o1', 'o2', 'o3'], 'amber');
      expect(released).toEqual(['o1']);
      expect(locks.get('o1')).toBeNull();
      expect(locks.get('o2')).not.toBeNull(); // arpan's, untouched
    });
  });

  describe('heartbeat', () => {
    it('refreshes lastHeartbeat only for ids the caller owns', () => {
      const locks = new RoomLocks();
      locks.tryAcquireMany(['o1'], amber, 1000);
      locks.tryAcquireMany(['o2'], arpan, 1000);
      const touched = locks.heartbeat(['o1', 'o2'], 'amber', 9000);
      expect(touched).toEqual(['o1']);
      expect(locks.get('o1').lastHeartbeat).toBe(9000);
      expect(locks.get('o2').lastHeartbeat).toBe(1000); // untouched — not amber's
    });
  });

  describe('releaseAllForUser (disconnect cleanup)', () => {
    it('releases every lock a user holds, none of anyone else\'s', () => {
      const locks = new RoomLocks();
      locks.tryAcquireMany(['o1', 'o2'], amber);
      locks.tryAcquireMany(['o3'], arpan);
      const released = locks.releaseAllForUser('amber');
      expect(released.sort()).toEqual(['o1', 'o2']);
      expect(locks.count()).toBe(1);
      expect(locks.get('o3')).not.toBeNull();
    });
  });

  describe('sweepExpiredLocks (TTL)', () => {
    it('reaps a lock nobody refreshed within the TTL window, leaves a fresh one alone', () => {
      const locks = new RoomLocks();
      locks.tryAcquireMany(['stale'], amber, 0);
      locks.tryAcquireMany(['fresh'], arpan, 9000);
      const expired = locks.sweepExpiredLocks(13000, 12000);
      expect(expired).toEqual(['stale']);
      expect(locks.get('stale')).toBeNull();
      expect(locks.get('fresh')).not.toBeNull();
    });
  });

  describe('releaseForMissingObjects (document replace)', () => {
    it('drops every lock whose object id is no longer in the given existing set', () => {
      const locks = new RoomLocks();
      locks.tryAcquireMany(['o1', 'o2'], amber);
      const released = locks.releaseForMissingObjects(['o2']);
      expect(released).toEqual(['o1']);
      expect(locks.get('o1')).toBeNull();
      expect(locks.get('o2')).not.toBeNull();
    });

    it('an empty existing set (e.g. clear-canvas) drops every lock', () => {
      const locks = new RoomLocks();
      locks.tryAcquireMany(['o1', 'o2'], amber);
      const released = locks.releaseForMissingObjects([]);
      expect(released.sort()).toEqual(['o1', 'o2']);
      expect(locks.count()).toBe(0);
    });
  });

  describe('Request Control flow', () => {
    it('requestControl fails against an object nobody holds', () => {
      const locks = new RoomLocks();
      expect(locks.requestControl('o1', arpan)).toEqual({ ok: false, reason: 'not-locked' });
    });

    it('requestControl fails against your own lock', () => {
      const locks = new RoomLocks();
      locks.tryAcquireMany(['o1'], amber);
      expect(locks.requestControl('o1', amber)).toEqual({ ok: false, reason: 'not-locked' });
    });

    it('respondToControl "release" clears both the lock and the pending request', () => {
      const locks = new RoomLocks();
      locks.tryAcquireMany(['o1'], amber);
      locks.requestControl('o1', arpan, 1000);
      const result = locks.respondToControl('o1', 'amber', 'release');
      expect(result.ok).toBe(true);
      expect(result.action).toBe('release');
      expect(result.request.requesterId).toBe('arpan');
      expect(locks.get('o1')).toBeNull();
      expect(locks.controlRequests.has('o1')).toBe(false);
    });

    it('respondToControl "keep" clears the request but leaves the lock intact', () => {
      const locks = new RoomLocks();
      locks.tryAcquireMany(['o1'], amber);
      locks.requestControl('o1', arpan, 1000);
      const result = locks.respondToControl('o1', 'amber', 'keep');
      expect(result.ok).toBe(true);
      expect(result.action).toBe('keep');
      expect(locks.get('o1')).not.toBeNull();
      expect(locks.controlRequests.has('o1')).toBe(false);
    });

    it('respondToControl rejects a response from anyone but the actual lock holder', () => {
      const locks = new RoomLocks();
      locks.tryAcquireMany(['o1'], amber);
      locks.requestControl('o1', arpan, 1000);
      expect(locks.respondToControl('o1', 'someone-else', 'release')).toEqual({ ok: false, reason: 'not-holder' });
      expect(locks.get('o1')).not.toBeNull(); // untouched by the invalid response
    });

    it('sweepExpiredControlRequests reaps an unanswered request past its TTL', () => {
      const locks = new RoomLocks();
      locks.tryAcquireMany(['o1'], amber, 0);
      locks.requestControl('o1', arpan, 1000);
      const expired = locks.sweepExpiredControlRequests(20000);
      expect(expired).toHaveLength(1);
      expect(expired[0]).toMatchObject({ objectId: 'o1', requesterId: 'arpan' });
      expect(locks.controlRequests.has('o1')).toBe(false);
      expect(locks.get('o1')).not.toBeNull(); // the lock itself is untouched by expiry — only the request is
    });
  });

  describe('serialize', () => {
    it('produces a flat, joinable-client-safe snapshot', () => {
      const locks = new RoomLocks();
      locks.tryAcquireMany(['o1'], amber);
      expect(locks.serialize()).toEqual([{ objectId: 'o1', userId: 'amber', userName: 'Amber' }]);
    });
  });
});
