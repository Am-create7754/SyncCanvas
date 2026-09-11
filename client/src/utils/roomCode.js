import { customAlphabet } from 'nanoid';

// Same unambiguous alphabet as the server's RoomManager — generated client-side purely
// so "Create Room" can navigate instantly without a round trip; the server treats
// whatever room id shows up in join-room as authoritative (creating it if new), so a
// client-picked code is never actually trusted, just proposed.
export const generateRoomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
