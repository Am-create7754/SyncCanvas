import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

/** One Socket.IO connection per app session, created lazily and reused across room
 *  navigations so the transport (and its reconnection backoff) isn't torn down and
 *  rebuilt every time the user joins a different room. */
export function createSocket() {
  return io(SOCKET_URL, {
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });
}
