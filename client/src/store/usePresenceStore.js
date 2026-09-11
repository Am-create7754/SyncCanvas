import { create } from '../utils/store.js';

export const usePresenceStore = create((set) => ({
  selfId: null,
  users: new Map(), // userId -> {id, username, color}

  setSelf: (selfId) => set({ selfId }),
  setUsers: (userList) => set({ users: new Map(userList.map((u) => [u.id, u])) }),
  addUser: (user) => set((s) => ({ users: new Map(s.users).set(user.id, user) })),
  removeUser: (userId) => set((s) => {
    const next = new Map(s.users);
    next.delete(userId);
    return { users: next };
  }),
}));
