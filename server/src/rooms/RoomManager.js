import { customAlphabet } from 'nanoid';
import { LIMITS } from '@synccanvas/shared';
import { Room } from './Room.js';

// Unambiguous uppercase alphabet (no 0/O/1/I) so a spoken/typed room code is unmistakable.
const generateRoomId = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', LIMITS.ROOM_ID_LENGTH);

/** Owns every live Room and reclaims rooms once they've had no users for a while. */
export class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
  }

  createRoom() {
    let id = generateRoomId();
    while (this.rooms.has(id)) id = generateRoomId();
    const room = new Room(id);
    this.rooms.set(id, room);
    return room;
  }

  getRoom(id) {
    return this.rooms.get(id);
  }

  getOrCreate(id) {
    return this.rooms.get(id) ?? (() => {
      const room = new Room(id);
      this.rooms.set(id, room);
      return room;
    })();
  }

  deleteIfEmpty(id) {
    const room = this.rooms.get(id);
    if (room && room.isEmpty()) this.rooms.delete(id);
  }

  roomCount() {
    return this.rooms.size;
  }
}
