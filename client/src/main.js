import './index.css';
import { renderHome } from './ui/home.js';
import { renderRoom } from './ui/room.js';
import { mountToastStack } from './ui/toasts.js';

/**
 * Phase 13A (vanilla JS migration) entry point — replaces the old React
 * (main.jsx -> App.jsx -> react-router-dom) bootstrap with a tiny hand-rolled router.
 * Two routes only, matching the app's actual shape: `/` (Home) and `/room/:roomId`
 * (Room) — History API push/pop, no dependency needed for something this small.
 */

const appRoot = document.getElementById('app');
mountToastStack(document.body);

let currentDestroy = null;

async function route() {
  if (currentDestroy) { currentDestroy(); currentDestroy = null; }

  const path = window.location.pathname;
  const roomMatch = path.match(/^\/room\/([^/]+)/);

  if (roomMatch) {
    const roomId = decodeURIComponent(roomMatch[1]);
    const maybeDestroy = await renderRoom(appRoot, roomId, navigate);
    currentDestroy = typeof maybeDestroy === 'function' ? maybeDestroy : null;
  } else {
    currentDestroy = renderHome(appRoot, navigate);
  }
}

export function navigate(path) {
  if (path !== window.location.pathname) window.history.pushState({}, '', path);
  route();
}

window.addEventListener('popstate', route);
route();
