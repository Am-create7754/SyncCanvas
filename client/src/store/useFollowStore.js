import { create } from '../utils/store.js';

/**
 * Whether *I* am following another collaborator's viewport. This is LOCAL STATE by
 * design (per Phase 5's state-category rules) — the server and the followed user never
 * learn that they're being followed; only their already-public viewport broadcasts are
 * consumed. Nothing here is sent over the network.
 */
export const useFollowStore = create((set) => ({
  followingUserId: null,
  followingUsername: null,
  startFollowing: (userId, username) => set({ followingUserId: userId, followingUsername: username }),
  stopFollowing: () => set({ followingUserId: null, followingUsername: null }),
}));
