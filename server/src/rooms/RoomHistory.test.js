import { describe, it, expect, beforeEach } from 'vitest';
import { LIMITS } from '@synccanvas/shared';
import { RoomHistory } from './RoomHistory.js';

function rect(id) {
  return { id, type: 'rect', userId: 'u1', color: '#111827', width: 4, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], createdAt: 1 };
}

describe('RoomHistory', () => {
  let history;
  let objects;
  const snapshot = () => objects.map((o) => ({ ...o }));

  beforeEach(() => {
    history = new RoomHistory();
    objects = [];
  });

  it('assigns strictly increasing sequence numbers, server-side, regardless of client timestamps', () => {
    const op1 = history.record({ type: 'OBJECT_CREATE', userId: 'u1', username: 'Amber', forward: {} }, snapshot);
    const op2 = history.record({ type: 'OBJECT_CREATE', userId: 'u1', username: 'Amber', forward: {} }, snapshot);
    expect(op1.sequence).toBe(1);
    expect(op2.sequence).toBe(2);
    expect(op1.id).not.toBe(op2.id);
  });

  it('stamps every operation with a server-assigned timestamp', () => {
    const op = history.record({ type: 'OBJECT_CREATE', userId: 'u1', username: 'Amber', forward: {} }, snapshot);
    expect(typeof op.timestamp).toBe('number');
    expect(op.timestamp).toBeGreaterThan(0);
  });

  it('creates an internal checkpoint every HISTORY_CHECKPOINT_INTERVAL operations', () => {
    for (let i = 0; i < LIMITS.HISTORY_CHECKPOINT_INTERVAL; i++) {
      objects.push(rect(`r${i}`));
      history.record({ type: 'OBJECT_CREATE', userId: 'u1', username: 'Amber', forward: { objects: [rect(`r${i}`)] } }, snapshot);
    }
    expect(history.checkpoints).toHaveLength(1);
    expect(history.checkpoints[0].sequence).toBe(LIMITS.HISTORY_CHECKPOINT_INTERVAL);
    expect(history.checkpoints[0].objects).toHaveLength(LIMITS.HISTORY_CHECKPOINT_INTERVAL);
  });

  it('reconstructAt uses the nearest checkpoint rather than replaying everything', () => {
    for (let i = 0; i < LIMITS.HISTORY_CHECKPOINT_INTERVAL + 5; i++) {
      objects.push(rect(`r${i}`));
      history.record({ type: 'OBJECT_CREATE', userId: 'u1', username: 'Amber', forward: { objects: [rect(`r${i}`)] } }, snapshot);
    }
    const atCheckpoint = history.reconstructAt(LIMITS.HISTORY_CHECKPOINT_INTERVAL);
    expect(atCheckpoint).toHaveLength(LIMITS.HISTORY_CHECKPOINT_INTERVAL);
    const beyond = history.reconstructAt(history.latestSequence());
    expect(beyond).toHaveLength(LIMITS.HISTORY_CHECKPOINT_INTERVAL + 5);
  });

  it('compacts the log once it exceeds MAX_HISTORY_OPERATIONS instead of growing forever', () => {
    const original = LIMITS.MAX_HISTORY_OPERATIONS;
    const originalInterval = LIMITS.HISTORY_CHECKPOINT_INTERVAL;
    LIMITS.MAX_HISTORY_OPERATIONS = 20;
    LIMITS.HISTORY_CHECKPOINT_INTERVAL = 5;
    try {
      for (let i = 0; i < 40; i++) {
        objects = [rect(`r${i}`)]; // keep the "live" doc tiny; we only care about log size
        history.record({ type: 'OBJECT_CREATE', userId: 'u1', username: 'Amber', forward: { objects: [rect(`r${i}`)] } }, snapshot);
      }
      expect(history.operations.length).toBeLessThan(40);
      expect(history.baseSequence).toBeGreaterThan(0);
      // reconstruction of the still-available range remains correct after compaction
      const latest = history.reconstructAt(history.latestSequence());
      expect(latest[0].id).toBe('r39');
    } finally {
      LIMITS.MAX_HISTORY_OPERATIONS = original;
      LIMITS.HISTORY_CHECKPOINT_INTERVAL = originalInterval;
    }
  });

  it('creates a named checkpoint pinned to the current document, independent of compaction', () => {
    objects = [rect('a'), rect('b')];
    history.record({ type: 'OBJECT_CREATE', userId: 'u1', username: 'Amber', forward: {} }, snapshot);
    const checkpoint = history.createNamedCheckpoint({ name: 'Before redesign', userId: 'u1', username: 'Amber', objects });
    expect(checkpoint.name).toBe('Before redesign');
    expect(checkpoint.objects).toHaveLength(2);
    expect(history.getNamedCheckpoint(checkpoint.id)).toEqual(checkpoint);
  });

  it('refuses to create more than MAX_NAMED_CHECKPOINTS', () => {
    const original = LIMITS.MAX_NAMED_CHECKPOINTS;
    LIMITS.MAX_NAMED_CHECKPOINTS = 2;
    try {
      history.createNamedCheckpoint({ name: 'A', userId: 'u1', username: 'Amber', objects: [] });
      history.createNamedCheckpoint({ name: 'B', userId: 'u1', username: 'Amber', objects: [] });
      expect(history.createNamedCheckpoint({ name: 'C', userId: 'u1', username: 'Amber', objects: [] })).toBeNull();
    } finally {
      LIMITS.MAX_NAMED_CHECKPOINTS = original;
    }
  });

  it('named checkpoints keep their own object snapshot, unaffected by later log compaction', () => {
    objects = [rect('pinned')];
    const checkpoint = history.createNamedCheckpoint({ name: 'Pinned', userId: 'u1', username: 'Amber', objects });
    const original = LIMITS.MAX_HISTORY_OPERATIONS;
    LIMITS.MAX_HISTORY_OPERATIONS = 5;
    try {
      for (let i = 0; i < 20; i++) history.record({ type: 'OBJECT_CREATE', userId: 'u1', username: 'Amber', forward: {} }, snapshot);
      expect(history.getNamedCheckpoint(checkpoint.id).objects).toEqual([rect('pinned')]);
    } finally {
      LIMITS.MAX_HISTORY_OPERATIONS = original;
    }
  });

  it('serialize() returns a client-safe shape without leaking checkpoint internals unnecessarily', () => {
    history.record({ type: 'OBJECT_CREATE', userId: 'u1', username: 'Amber', forward: { objects: [rect('a')] } }, snapshot);
    const serialized = history.serialize();
    expect(serialized.operations).toHaveLength(1);
    expect(serialized.latestSequence).toBe(1);
    expect(Array.isArray(serialized.namedCheckpoints)).toBe(true);
  });

  it('replaceWith wholesale-replaces the log with freshly re-sequenced operations (import with history)', () => {
    history.record({ type: 'OBJECT_CREATE', userId: 'u1', username: 'Amber', forward: {} }, snapshot);
    history.record({ type: 'OBJECT_CREATE', userId: 'u1', username: 'Amber', forward: {} }, snapshot);
    history.createNamedCheckpoint({ name: 'Old', userId: 'u1', username: 'Amber', objects: [] });

    const imported = [
      { type: 'OBJECT_CREATE', userId: 'attacker-supplied', username: 'Ghost', forward: { objects: [rect('imported1')] } },
    ];
    history.replaceWith(imported, snapshot);

    expect(history.operations).toHaveLength(1);
    expect(history.operations[0].sequence).toBe(1); // re-sequenced fresh, not trusting the original
    expect(history.namedCheckpoints).toHaveLength(0); // stale checkpoints from the old timeline are dropped
  });
});
