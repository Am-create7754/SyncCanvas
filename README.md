# SyncCanvas

A real-time collaborative drawing/diagramming canvas. Multiple people join a room by
code and draw together — strokes, shapes, and diagrams stream live to everyone, with a
shared **global** undo/redo history, presence (cursors, names, colors), and
conflict-safe editing.

Built for a Frontend R&D internship submission. The assignment requires a **vanilla
JavaScript** frontend (no UI framework) on **raw HTML5 Canvas**, talking to a **Node.js +
Socket.IO** backend — that's exactly what's here.

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Setup](#setup)
- [Testing with multiple users](#testing-with-multiple-users)
- [Global undo/redo](#global-undoredo)
- [Conflict resolution](#conflict-resolution)
- [Performance decisions](#performance-decisions)
- [Known limitations](#known-limitations)
- [Browser/testing notes](#browsertesting-notes)
- [Time spent](#time-spent)
- [Deployment](#deployment)

## Features

**Drawing**
- Freehand brush (pencil) and eraser, with live per-point streaming (not just on release)
- Line, rectangle, circle, connector (anchored diagram lines with straight/elbow
  routing + arrowheads), sticky notes, frames — all as first-class canvas objects
- Adjustable stroke color (palette + custom picker) and stroke width
- Fill color/opacity for closed shapes (rect/circle/sticky/frame)
- Select tool: click/marquee select, drag to move, handle-drag to resize, rotate
  (rect/line/sticky), grouping, layer order — all built into the canvas engine

**Real-time collaboration**
- Strokes/shapes stream to every collaborator while you're still drawing, not just on
  mouse-up
- Live remote cursors with each collaborator's name and a stable, server-assigned color
- Online-user presence list ("Follow" a collaborator's viewport)
- Isolated rooms (join by 6-character code or a room URL)
- Automatic reconnect with authoritative state resync
- **Global, room-wide undo/redo** — see below
- Soft object locking + revision numbers so simultaneous edits never silently clobber
  each other

**Document**
- Export/import as a `.synccanvas.json` file; export the drawing as a PNG
- Local autosave per room, with a restore-or-discard prompt if a browser closes mid-session
- A read-only mini-map with click/drag-to-navigate
- Dark mode

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | **Vanilla JavaScript (ES modules)**, hand-rolled DOM building, HTML5 `<canvas>` 2D context, Tailwind CSS (utility CSS only — no JS framework), Vite (dev server/bundler) |
| Backend | Node.js, Express (health check only), Socket.IO |
| Shared | A `shared` workspace of pure JS validation/constants imported by both client and server, so the two never drift on event names or payload shapes |
| Tests | Vitest (client + server), jsdom for DOM-touching client tests |

**No React/Vue/Angular. No canvas/drawing library** (Fabric, Konva, Paper.js, etc.) — every
stroke, shape, hit-test, and render call is hand-written against the Canvas 2D API in
[`client/src/canvas/`](client/src/canvas/). See [ARCHITECTURE.md](ARCHITECTURE.md) for how
that engine is structured.

## Setup

Requires Node.js 20+.

```bash
npm install
npm start
```

`npm start` launches **both** the Socket.IO server (port 4000) and the Vite dev client
(port 5173) together and prints both logs to one terminal (Ctrl+C stops both). Open
<http://localhost:5173>.

Other useful root scripts:

```bash
npm test    # runs client + server test suites (Vitest)
npm run lint    # ESLint, client + server
npm run build   # production client build (client/dist)
```

To run the pieces individually: `npm run dev:server` / `npm run dev:client`, or
`npm test -w client`, etc. (this is an npm workspaces monorepo — `client/`, `server/`,
`shared/`).

Environment variables (see `.env.example` in `client/` and `server/`):

- `server/.env` — `PORT` (default 4000), `CLIENT_URL` (comma-separated allowed CORS
  origins, default `http://localhost:5173`), `DEBUG_SYNCCANVAS` (verbose logs, default off)
- `client/.env` — `VITE_SOCKET_URL` (which server to connect to, default
  `http://localhost:4000`)

## Testing with multiple users

The fastest way, locally:

1. `npm start`, open <http://localhost:5173> in one browser tab.
2. Click **Create Room** — you land on `/room/<CODE>`.
3. Open a **second tab** (or a private/incognito window — see the note below) at the same
   `/room/<CODE>` URL and join with a different name.
4. Draw in either tab — strokes, cursors, and presence appear live in the other.

**Important:** this browser identifies "you" via a random id stored in `localStorage`
(`synccanvas:userId`), shared by every tab on the same origin. Two *regular* tabs in the
same browser will therefore rejoin as the **same** collaborator on refresh. To test as two
genuinely different users in one browser, either:
- use a private/incognito window for the second user, or
- open the second tab and, in its devtools console, run
  `localStorage.setItem('synccanvas:userId','someone-else'); localStorage.setItem('synccanvas:username','Arpan')`
  **before** navigating to the room URL.

Two separate physical browsers (or two machines) on the same LAN also work — just point
the second one at your machine's IP instead of `localhost` (and set `VITE_SOCKET_URL`
accordingly).

## Global undo/redo

Undo/redo is **one shared history per room**, not per user. If Amber draws A, then Arpan
draws B, then Amber draws C:

- **Either** user clicking Undo removes **C** (the most recent operation in the room),
  for everyone.
- The next Undo (by either user) removes **B**.
- Redo re-applies them in reverse, for everyone, regardless of who clicks it.

This is implemented as a single stack on the server (`Room.undoStack` /
`Room.redoStack` in [`server/src/rooms/Room.js`](server/src/rooms/Room.js)) — the
server is the sole authority on ordering, so every client converges on the same result
without needing a CRDT. Any new action by *anyone* clears the shared redo stack (the
same rule Figma/Google Slides use — a fresh action invalidates the "future" that redo
would otherwise restore to). A user disconnecting does **not** wipe their contributions
from the history; other collaborators can still undo/redo their work. See
[`Room.test.js`](server/src/rooms/Room.test.js) for the exact cross-user scenario tested.

## Conflict resolution

Two independent layers, deliberately not a CRDT/OT:

1. **Soft locks** (`server/src/rooms/RoomLocks.js`) — while you're actively dragging/
   resizing/style-editing an object, the server marks it locked to you (TTL + heartbeat,
   auto-expires if you go away). Other clients see "X is editing this" and can't start
   editing the same object; they can ask to take over ("Request Control"). This prevents
   most conflicts before they happen.
2. **Revision numbers** — every object carries a server-incremented `revision`. A client's
   edit request carries the revision it *thinks* the object is at; if the server's actual
   revision has moved on (e.g. a lock-holder's own reordered/delayed packet, or a race the
   lock didn't catch), the edit is rejected and the client is handed the authoritative
   object to reconcile against — quietly, never a blocking error dialog.

Because Node/Socket.IO processes one room's events strictly one at a time, every check
above is race-free without any explicit locking primitive in the code. Two users drawing
independent, non-overlapping strokes at the same time need no coordination at all and
always both succeed. Malformed or missing Socket.IO payloads are validated (via the
shared `shared/validation/validators.js`) before touching room state — see
`server/src/socket/handlers.js`.

## Performance decisions

- **Streamed, not batched, strokes**: points are appended to the object as the pointer
  moves and re-rendered locally every frame; only the *new* points since the last flush
  are sent over the wire (throttled — see below), not the whole stroke.
- **Rate limiting on ephemeral traffic**: cursor/laser broadcasts ~25/s, viewport ~15/s,
  live drag/resize preview ~25/s (both client-side throttle and a server-side minimum
  interval, so a misbehaving/malicious client can't flood the room).
- **Dirty-flag rendering**: the canvas only repaints when something actually changed
  (`CanvasEngine.markDirty()`), not on every animation frame.
- **Point de-duplication**: freehand points closer than ~2.5 world units to the last
  accepted point are dropped, so a stroke isn't recorded at a resolution far finer than
  it's ever rendered.
- **Spatial hashing** for smart-guide/snap candidate queries during a drag, rebuilt once
  at drag-start rather than maintained incrementally on every mutation.
- **A global, bounded undo stack** (`LIMITS.MAX_UNDO_STACK`, FIFO-trimmed) so a very long
  room session can't grow server memory without bound.
- **Listener/timer hygiene**: every `addEventListener`/`setInterval` the client or server
  sets up has a matching teardown (`CanvasEngine.destroy()`, `RoomConnection.disconnect()`,
  the room UI's `destroy()` chain, socket `disconnect` cleanup on the server) so navigating
  rooms or reconnecting never accumulates duplicate listeners.

## Known limitations

- Several *advanced* editing panels that exist at the engine level are not yet wired into
  the vanilla UI (their underlying logic is fully implemented and unit-tested, just not
  exposed as buttons yet): the Layers panel, Command Palette, right-click context menu,
  the Inspector panel (precise X/Y/W/H and connector/sticky/frame field editing), the
  multi-select align/distribute/group toolbar, the session-history/replay timeline,
  named snapshots, the Performance HUD, and a grid on/off toggle (smart guides and rulers
  *are* on by default and work without a toggle).
- Two-finger pinch-zoom on touch devices isn't implemented (single-finger draw/erase
  works via Pointer Events).
- Reconnection re-syncs by re-fetching the room's authoritative object list rather than
  replaying missed deltas — simpler and always correct, at the cost of a full resync
  instead of an incremental one.

None of the above affects the assignment's core requirements (drawing, real-time sync,
presence, rooms, global undo/redo, conflict safety) — they're intentionally deferred
polish, not bugs.

## Browser/testing notes

Manually verified in Chromium (via the automated browser tooling used during
development) with two simultaneous clients: live stroke streaming, remote cursors,
presence colors, room create/join, and cross-user global undo/redo. Automated test
suites (Vitest) cover the canvas geometry/engine, the server's room/lock/history logic,
and shared validation — run `npm test` for the full pass. Not independently verified on
Safari/Firefox or a physical mobile device.

## Time spent

This project was built incrementally, in a series of scoped phases (core drawing →
real-time sync → shapes/selection → persistence → presence/follow → history/replay →
concurrency/locks → smart canvas tools → diagramming → a compliance pass converting the
UI to vanilla JS → this final correctness/documentation pass). No single continuous
timer was kept across that process, so a precise hour count isn't available here —
replace this section with your own logged time if the assignment requires a specific
number.

## Deployment

Not deployed as part of this submission (no hosting credentials available). To deploy:

1. **Backend** (`server/`): deploy as a standard Node process (Render, Railway, Fly.io,
   a VM, etc.). Set `PORT` (most platforms inject this), `CLIENT_URL` to your deployed
   frontend's exact origin, and start with `npm start -w server` (or `node src/index.js`
   from `server/`).
2. **Frontend** (`client/`): set `VITE_SOCKET_URL` to your deployed backend's URL, then
   `npm run build -w client` and serve `client/dist/` as a static site (Vercel, Netlify,
   Cloudflare Pages, or any static host/CDN).
3. Make sure the backend's CORS `CLIENT_URL` and the frontend's `VITE_SOCKET_URL` point
   at each other's real deployed origins — mismatched values are the most common
   "it works locally but not deployed" cause for a Socket.IO app.
