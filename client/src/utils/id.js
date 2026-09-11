import { customAlphabet } from 'nanoid';

const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const generateId = customAlphabet(alphabet, 12);

const USER_ID_KEY = 'synccanvas:userId';

/** Returns this browser's persistent identity, creating one on first visit. Keying
 *  presence by this id (not the transient socket.id) is what lets a reconnect be
 *  recognized as "the same user came back" instead of a duplicate join. */
export function getOrCreateUserId() {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = generateId();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

const USERNAME_KEY = 'synccanvas:username';

export function getSavedUsername() {
  return localStorage.getItem(USERNAME_KEY) ?? '';
}

export function saveUsername(username) {
  localStorage.setItem(USERNAME_KEY, username);
}
