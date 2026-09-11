import { describe, it, expect } from 'vitest';
import { RoomManager } from './RoomManager.js';

describe('RoomManager', () => {
  it('generates a unique room id on createRoom', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();
    expect(room.id).toHaveLength(6);
    expect(manager.getRoom(room.id)).toBe(room);
  });

  it('getOrCreate returns the same room instance on repeated calls', () => {
    const manager = new RoomManager();
    const first = manager.getOrCreate('ABCDEF');
    const second = manager.getOrCreate('ABCDEF');
    expect(first).toBe(second);
  });

  it('keeps two rooms fully isolated from each other', () => {
    const manager = new RoomManager();
    const roomA = manager.getOrCreate('ROOMAA');
    const roomB = manager.getOrCreate('ROOMBB');

    roomA.addUser({ id: 'u1', username: 'Amber', color: '#f00', socketId: 's1' });
    roomA.addObject({ id: 'o1', type: 'path', userId: 'u1', color: '#f00', width: 2, points: [{ x: 0, y: 0 }], createdAt: Date.now() });

    expect(roomB.users.size).toBe(0);
    expect(roomB.objects.size).toBe(0);
    expect(roomA.users.size).toBe(1);
    expect(roomA.objects.size).toBe(1);
  });

  it('deleteIfEmpty only removes a room with zero users and no pending reconnects', () => {
    const manager = new RoomManager();
    manager.getOrCreate('EMPTYX');
    manager.deleteIfEmpty('EMPTYX');
    expect(manager.getRoom('EMPTYX')).toBeUndefined();

    const room2 = manager.getOrCreate('KEEPME');
    room2.addUser({ id: 'u1', username: 'A', color: '#f00', socketId: 's1' });
    manager.deleteIfEmpty('KEEPME');
    expect(manager.getRoom('KEEPME')).toBe(room2);
  });
});
