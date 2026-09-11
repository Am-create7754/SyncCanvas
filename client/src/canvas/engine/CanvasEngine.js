import { Renderer } from '../rendering/Renderer.js';
import { screenToWorld, zoomAround, clampScale } from '../geometry/viewport.js';
import { shouldAcceptPoint, boundsOfPoints } from '../geometry/points.js';
import { visualBoundsOfObjectList, visualBoundsOfObjects } from '../geometry/objectBounds.js';
import { hitTestScene, hitTestObject } from '../geometry/hitTest.js';
import { getResizeHandles, hitTestHandles, resizePoints, RESIZABLE_TYPES } from '../geometry/resizeHandles.js';
import { cloneObjectsForPaste } from '../clipboard.js';
import { computeAlignPatches, computeDistributePatches } from '../geometry/align.js';
import { LASER_FADE_MS } from '../rendering/drawLaser.js';
import { generateId } from '../../utils/id.js';
import { FREEHAND_TOOLS, SHAPE_TOOLS, FILLABLE_TYPES, LIMITS, TEXT_CAPABLE_TYPES } from '@synccanvas/shared';
import {
  ROTATABLE_TYPES, getObjectCenter, toLocalPoint, angleFromCenter, snapRotation,
  normalizeRotation, getRotationHandlePosition,
} from '../geometry/rotation.js';
import { computeMoveSnap, computeResizeSnap, snapPointToGrid } from '../geometry/snapping.js';
import { SpatialHash } from '../geometry/spatialHash.js';
import { CONNECTABLE_TYPES, nearestAnchor, computeConnectorPoints } from '../geometry/connector.js';

/** Axis-aligned rectangle intersection test — used by marquee selection. Touching edges
 *  count as intersecting (<=/>=), matching how the marquee rectangle itself is drawn. */
function rectsIntersect(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** @returns {{minX,minY,maxX,maxY}} combined bounds of a Map<id, points[]> — used for a
 *  multi-selection move's snap/guide candidate bounds (see dragState.origins). */
function boundsOfManyPoints(pointsById) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const points of pointsById.values()) {
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function translateBounds(bounds, dx, dy) {
  return { minX: bounds.minX + dx, minY: bounds.minY + dy, maxX: bounds.maxX + dx, maxY: bounds.maxY + dy };
}

/** @returns {{x:'minX'|'maxX'|null, y:'minY'|'maxY'|null}} which bounds edge(s) a given
 *  resize handle id actually drags — mirrors resizePoints' own handleId.includes() checks
 *  exactly, so "which edge is moving" is always read the same way snapping is computed as
 *  it already is applied. Only meaningful for the rect/circle bbox-handle model (getResizeHandles'
 *  8-handle set) — a line's 'start'/'end' handles move a whole endpoint, not a box edge,
 *  so callers skip edge-snapping for those (see CanvasEngine's resize pointermove). */
function movingEdgeForHandle(handleId) {
  return {
    x: handleId.includes('w') ? 'minX' : handleId.includes('e') ? 'maxX' : null,
    y: handleId.includes('n') ? 'minY' : handleId.includes('s') ? 'maxY' : null,
  };
}

const MIN_POINT_DISTANCE = 2.5; // world units, before dividing by zoom
const CURSOR_EMIT_INTERVAL_MS = 40; // ~25/s outgoing — see docs/PERFORMANCE.md
const LASER_EMIT_INTERVAL_MS = 40; // ~25/s outgoing, matches cursor cadence
const VIEWPORT_EMIT_INTERVAL_MS = 65; // ~15/s outgoing — follow mode doesn't need more
const TRANSFORM_PREVIEW_EMIT_INTERVAL_MS = 40; // ~25/s outgoing — matches cursor/laser cadence
const SELECT_HIT_TOLERANCE = 6; // screen px, divided by zoom before hit-testing
const HANDLE_HIT_TOLERANCE = 8; // screen px, divided by zoom before hit-testing
const FPS_SAMPLE_INTERVAL_MS = 750; // how often the HUD's FPS number updates
const SNAP_THRESHOLD_SCREEN_PX = 7; // spec suggests ~5-8px — converted to world units by /scale so it feels consistent at any zoom
const DEFAULT_STICKY_FILL_COLOR = '#FEF3C7'; // matches drawSticky.js's own fallback yellow
const DEFAULT_TEXT_WIDTH = 160; // world units — a new standalone text object's default box
const DEFAULT_TEXT_HEIGHT = 44;

/**
 * Owns the canvas element, the scene (object map + viewport), pointer/keyboard input,
 * and the render loop. Framework-agnostic on purpose: React only ever talks to this
 * through `mount`, a handful of imperative methods, and DOM CustomEvents — so the engine
 * can be unit tested without React and never re-renders on every pointermove.
 */
export class CanvasEngine extends EventTarget {
  constructor() {
    super();
    this.canvas = null;
    this.ctx = null;
    this.renderer = new Renderer();

    /** @type {Map<string, object>} canonical finalized + in-progress objects, keyed by id */
    this.objects = new Map();
    /** @type {Map<string, object>} userId -> {x,y,username,color} */
    this.remoteCursors = new Map();
    /** @type {Array<{x,y,t}>} this user's own in-flight laser trail */
    this.localLaserTrail = [];
    /** @type {Map<string, Array<{x,y,t}>>} userId -> their laser trail */
    this.remoteLaserTrails = new Map();
    /** @type {Set<string>} ids of the objects *this* user has selected via the Select tool */
    this.selectedObjectIds = new Set();
    /** @type {Map<string, {objectIds:string[], color:string, username:string}>} */
    this.remoteSelections = new Map();
    /** @type {object[]} LOCAL clipboard (Ctrl+C/Ctrl+V) — plain object snapshots, never networked */
    this.clipboard = [];
    /** @type {object|null} in-progress move/resize drag — see _beginMoveDrag/_beginResizeDrag */
    this.dragState = null;
    /** @type {{x,y}|null} world-space anchor of an in-progress marquee-select drag */
    this.marqueeStart = null;
    /** @type {{minX,minY,maxX,maxY}|null} current marquee rectangle, for overlay rendering */
    this.marqueeRect = null;
    this.marqueeMoved = false;
    this.lastTransformPreviewEmitAt = 0;

    /** @type {Map<string,object>|null} Phase 9 — when set, rendering (and the mini-map)
     *  shows THIS derived, read-only historical state instead of `this.objects`. The live
     *  document is never touched while previewing: this is a completely separate map, and
     *  every input handler below refuses to start an edit while it's set (see
     *  _onPointerDown's early-return) — see docs "Replay Mode Must Be Read-Only". */
    this.historicalPreview = null;

    // ---- Phase 10: soft object locking / conflict safety ----
    // Ephemeral, presence-style state kept directly on the engine (same treatment as
    // remoteCursors/remoteSelections above) rather than in a Zustand store, so rendering
    // can read it synchronously on the hot path. RoomConnection keeps these in sync from
    // OBJECT_LOCK_GRANTED/RELEASED broadcasts + the join-time lock snapshot.
    /** @type {Map<string,{userId:string,userName:string}>} objectId -> current lock owner */
    this.remoteLocks = new Map();
    /** @type {Set<string>} ids WE currently hold the lock for */
    this.myLockedIds = new Set();
    this.selfUserId = null;
    /** @type {Map<string,number>} objectId -> performance.now() expiry of a brief
     *  "updated remotely" flash, shown after a server-rejected update is reconciled. */
    this.conflictFlashIds = new Map();
    this._styleLockObjectId = null;
    this._styleLockReleaseTimer = null;

    // ---- Phase 11: smart canvas & precision tools ----
    // Grid/rulers/snap preferences are LOCAL UI state bridged in from React (see
    // Room.jsx <-> useCanvasSettingsStore), same pattern as tool/color/theme above —
    // never synchronized, never sent over the socket.
    this.gridEnabled = false;
    this.gridSize = 16;
    this.snapToGridEnabled = false;
    this.smartGuidesEnabled = true;
    this.rulersEnabled = true;
    /** @type {Array} ephemeral smart-guide lines for the CURRENT drag only — never saved,
     *  exported, or synced; cleared the instant a drag ends. */
    this.activeGuides = [];
    /** @type {Array} ephemeral distance-callout measurements for the CURRENT drag only. */
    this.activeMeasurements = [];
    /** @type {{objectId:string, degrees:number}|null} live angle readout while actively
     *  dragging the rotation handle — cleared on drag end. */
    this.rotationPreview = null;
    /** Rebuilt fresh at the start of each move drag (see _beginMoveDrag) rather than kept
     *  incrementally in sync with every mutation — see SpatialHash's own doc comment for
     *  why that's the right tradeoff here. */
    this._spatialHash = new SpatialHash();

    // ---- Phase 12: connector tool (ephemeral creation state — never persisted, never
    // networked; only the FINISHED connector object, created via commitCreateObjects,
    // becomes shared state, same split as marqueeRect/activeGuides above). ----
    this.connectorRouting = 'straight'; // LOCAL UI preference, same treatment as color/strokeWidth
    /** @type {{startObjectId:string, startAnchor:string, currentPoint:{x,y}}|null}
     *  in-progress connector drag from a grabbed anchor. */
    this.connectorDraft = null;
    /** @type {{objectId:string, anchor:string, point:{x,y}}|null} the anchor currently
     *  snapped-to while dragging a connector — null means "no valid target", in which case
     *  releasing cancels instead of creating a connector. */
    this.connectorHoverTarget = null;
    /** @type {string|null} id of the connectable shape whose anchor dots should render as
     *  a hover affordance (connector tool active, no drag yet). */
    this.connectorHoverShapeId = null;

    this.viewport = { x: 0, y: 0, scale: 1 };
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.dpr = window.devicePixelRatio || 1;

    this.tool = 'path';
    this.color = '#111827';
    this.strokeWidth = 4;
    this.fillEnabled = false;
    this.fillColor = '#F97316';
    this.fillOpacity = 1;
    this.selfColor = '#6366F1'; // presentation color for laser — distinct from drawing `color`
    this.isDarkMode = false;

    // ---- Final polish phase: text tool defaults (LOCAL "next text object" preferences,
    // same treatment as color/fillColor above — never networked by themselves, only baked
    // into an object at the moment one is created/edited). ----
    this.textFontSize = 16;
    this.textFontFamily = 'sans-serif';
    this.textBold = false;
    this.textItalic = false;
    this.textUnderline = false;
    this.textAlign = 'left';
    this.textColor = '#1F2937';

    this.activeStrokeId = null; // freehand in progress
    this.pendingOutgoingPoints = [];
    this.lastAcceptedPoint = null;

    this.shapeStart = null; // shape drag in progress
    this.previewObject = null;

    this.isPanning = false;
    this.isSpaceDown = false;
    this.panStartScreen = null;
    this.panStartViewport = null;

    this.isLasering = false;

    this.dirty = true;
    this.rafId = null;
    this.lastCursorEmitAt = 0;
    this.lastLaserEmitAt = 0;
    this.lastViewportBroadcastAt = 0;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onDoubleClick = this._onDoubleClick.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._loop = this._loop.bind(this);
  }

  mount(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    canvas.addEventListener('dblclick', this._onDoubleClick);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    this.rafId = requestAnimationFrame(this._loop);
  }

  destroy() {
    if (!this.canvas) return;
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('dblclick', this._onDoubleClick);
    this.canvas.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  resize(cssWidth, cssHeight) {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(cssWidth * this.dpr);
    this.canvas.height = Math.round(cssHeight * this.dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.markDirty();
    // Resizing changes how much world-space is visible even if x/y/scale don't move —
    // the mini-map's viewport rectangle depends on cssWidth/cssHeight, so it needs to
    // know. Not a real pan/zoom, so no _broadcastViewport (that would wrongly cancel
    // Follow Mode or echo a resize to other clients).
    this._emitViewport();
  }

  markDirty() {
    this.dirty = true;
  }

  // ---- tool state ----
  setTool(tool) {
    // Selection only means something while the Select tool is active — leaving it
    // implicitly deselects, so switching to Pencil never leaves a stale highlight behind.
    if (this.tool === 'select' && tool !== 'select' && this.selectedObjectIds.size > 0) {
      this.clearSelection();
    }
    // Same treatment for connector-drag ephemera — leaving the Connector tool mid-drag
    // (e.g. a keyboard shortcut) cancels it rather than leaving a dangling draft/hover.
    if (this.tool === 'connector' && tool !== 'connector') {
      this.connectorDraft = null;
      this.connectorHoverTarget = null;
      this.connectorHoverShapeId = null;
    }
    this.tool = tool;
    this.markDirty();
    // A sensible default cursor per tool (QoL) — the Select tool is the one exception,
    // since its cursor is hover-dependent (see _updateSelectHoverCursor) and would just
    // get overwritten on the next pointermove anyway.
    if (this.canvas && tool !== 'select') this.canvas.style.cursor = tool === 'text' ? 'text' : 'crosshair';
    else if (this.canvas) this.canvas.style.cursor = '';
  }
  /** LOCAL UI preference for newly-created connectors, and what a "Toggle Connector
   *  Routing" command flips — reusing this straight/elbow split, not a per-connector
   *  authoring choice made some other way. */
  setConnectorRouting(routing) { this.connectorRouting = routing; }
  setColor(color) { this.color = color; }
  setStrokeWidth(width) { this.strokeWidth = width; }
  setFillEnabled(fillEnabled) { this.fillEnabled = fillEnabled; }
  setFillColor(fillColor) { this.fillColor = fillColor; }
  setFillOpacity(fillOpacity) { this.fillOpacity = fillOpacity; }
  /** The user's collaboration presence color — used for laser + selection badges, never
   *  the drawing `color` (setColor), which is a completely separate concern. */
  setSelfColor(color) { this.selfColor = color; }
  /** Theme is LOCAL STATE (see Room.jsx) — the engine only needs to know it to pick a
   *  visible dot-grid color; it never affects anything sent over the network. */
  setDarkMode(isDark) { this.isDarkMode = isDark; this.markDirty(); }

  // ---- Final polish phase: "next text object" defaults (LOCAL, see constructor) ----
  setTextFontSize(size) { this.textFontSize = size; }
  setTextFontFamily(family) { this.textFontFamily = family; }
  setTextBold(bold) { this.textBold = bold; }
  setTextItalic(italic) { this.textItalic = italic; }
  setTextUnderline(underline) { this.textUnderline = underline; }
  setTextAlign(align) { this.textAlign = align; }
  setTextColor(color) { this.textColor = color; }

  // ---- Phase 11: smart canvas settings (all LOCAL — see useCanvasSettingsStore) ----
  setGridEnabled(enabled) { this.gridEnabled = enabled; this.markDirty(); }
  setGridSize(size) { this.gridSize = size; this.markDirty(); }
  setSnapToGridEnabled(enabled) { this.snapToGridEnabled = enabled; }
  setSmartGuidesEnabled(enabled) { this.smartGuidesEnabled = enabled; }
  setRulersEnabled(enabled) { this.rulersEnabled = enabled; this.markDirty(); }

  // ---- scene mutation (local + applying remote ops) ----
  applyObjectStart(object) {
    this.objects.set(object.id, { ...object, points: [...object.points] });
    this.markDirty();
    this._emitObjectCount();
  }

  applyObjectPoints(id, points) {
    const obj = this.objects.get(id);
    if (!obj) return;
    obj.points.push(...points);
    this.markDirty();
  }

  /** Merges a style patch (color/width/fill*) into an existing object. Used for both
   *  directions: applying our own edit optimistically, and applying one that arrived
   *  from the network (OBJECT_UPDATE, or an undo/redo that reverted a style edit). */
  applyObjectUpdate(id, patch) {
    const obj = this.objects.get(id);
    if (!obj) return;
    Object.assign(obj, patch);
    this.markDirty();
    this.dispatchEvent(new CustomEvent('object-style-change', { detail: { id } }));
  }

  /** Edits the currently-selected object's style: applies it locally right away (so the
   *  editor sees the change with zero latency, same optimistic-render principle as
   *  drawing) and dispatches an event RoomConnection relays to the server as PERSISTENT
   *  collaborative state — unlike the toolbar's own fill defaults, which never leave
   *  this browser until they're baked into a newly-created object. Only meaningful for a
   *  single selected object — StylePanel only shows for exactly one selection. */
  editSelectedObjectStyle(patch) {
    if (this.selectedObjectIds.size !== 1) return;
    const [id] = this.selectedObjectIds;
    // A style edit is a discrete click/tick, not an in-progress gesture like a drag — so
    // unlike move/resize (which stays optimistic even when locked, see _beginMoveDrag),
    // this refuses outright and just notifies, giving the clearest possible feedback for
    // the cheapest case to get right ("don't lock merely because they selected it — only
    // when they actually begin changing style", which this call IS).
    if (this.isLockedByOther(id)) { this._notifyLockConflict(id); return; }
    const baseRevision = this.objects.get(id)?.revision ?? 0;
    this.applyObjectUpdate(id, patch);
    this.dispatchEvent(new CustomEvent('local-object-update', { detail: { id, patch, baseRevision } }));
    this._touchStyleLock(id);
  }

  /**
   * Edits fields exclusive to connectors — routing/arrowStart/arrowEnd/label (shared
   * CONNECTOR_PATCH_FIELDS). Unlike editSelectedObjectStyle's color/width/fill* (the
   * single-object OBJECT_UPDATE path, validated against shared STYLE_FIELDS), these
   * fields are only accepted on a BATCH_UPDATE patch (see shared isValidBatchPatch) — so
   * this goes through commitBatchUpdate even for exactly one object, same lock-acquisition
   * contract as editSelectedObjectStyle otherwise. A routing change also recomputes
   * `points` in the SAME patch (Phase 12: a connector's points are a CACHED polyline
   * derived from routing+endpoints — see connector.js — so routing and points must never
   * transiently disagree).
   */
  editSelectedConnector(patch) {
    const obj = this.getSelectedObject();
    if (!obj || obj.type !== 'connector') return;
    if (this.isLockedByOther(obj.id)) { this._notifyLockConflict(obj.id); return; }
    const fullPatch = { ...patch };
    if (patch.routing !== undefined) {
      const startShape = this.objects.get(obj.start.objectId);
      const endShape = this.objects.get(obj.end.objectId);
      if (startShape && endShape) {
        fullPatch.points = computeConnectorPoints(startShape, obj.start.anchor, endShape, obj.end.anchor, patch.routing);
      }
    }
    const opType = fullPatch.points ? 'OBJECT_RESIZE' : 'OBJECT_STYLE_CHANGE';
    this.commitBatchUpdate([{ id: obj.id, patch: fullPatch }], opType);
    this._touchStyleLock(obj.id);
  }

  /** Flips the single selected connector between straight/elbow routing (spec #6). */
  toggleConnectorRouting() {
    const obj = this.getSelectedObject();
    if (!obj || obj.type !== 'connector') return;
    this.editSelectedConnector({ routing: obj.routing === 'elbow' ? 'straight' : 'elbow' });
  }

  /** Edits `text` on the selected sticky note — `text` is also a BATCH_UPDATE-only field
   *  (not in STYLE_FIELDS), same treatment as editSelectedConnector above. */
  editSelectedStickyText(text) {
    const obj = this.getSelectedObject();
    if (!obj || obj.type !== 'sticky') return;
    if (this.isLockedByOther(obj.id)) { this._notifyLockConflict(obj.id); return; }
    this.commitBatchUpdate([{ id: obj.id, patch: { text } }], 'OBJECT_STYLE_CHANGE');
    this._touchStyleLock(obj.id);
  }

  /** Edits `title` on the selected frame — same BATCH_UPDATE-only field treatment. */
  editSelectedFrameTitle(title) {
    const obj = this.getSelectedObject();
    if (!obj || obj.type !== 'frame') return;
    if (this.isLockedByOther(obj.id)) { this._notifyLockConflict(obj.id); return; }
    this.commitBatchUpdate([{ id: obj.id, patch: { title } }], 'OBJECT_STYLE_CHANGE');
    this._touchStyleLock(obj.id);
  }

  /**
   * Final polish phase — edits text CONTENT and/or FORMATTING (text/fontSize/fontFamily/
   * bold/italic/underline/textAlign/textColor) on the selected object. Valid on a
   * standalone text object and on any shape that can carry embedded text (rect/circle/
   * sticky — see shared TEXT_CAPABLE_TYPES). Same BATCH_UPDATE-only field treatment as
   * editSelectedConnector/editSelectedStickyText/editSelectedFrameTitle above — these
   * fields live in TEXT_PATCH_FIELDS, not STYLE_FIELDS, so a single-object edit still
   * goes through commitBatchUpdate rather than the color/width/fill* OBJECT_UPDATE path.
   * One call handles BOTH the inline text editor's content commit (`{text}`) and the
   * properties panel's formatting toggles (`{bold: true}`, `{textAlign: 'center'}`, ...).
   */
  editSelectedText(patch) {
    const obj = this.getSelectedObject();
    if (!obj || !TEXT_CAPABLE_TYPES.has(obj.type)) return;
    if (this.isLockedByOther(obj.id)) { this._notifyLockConflict(obj.id); return; }
    this.commitBatchUpdate([{ id: obj.id, patch }], 'OBJECT_STYLE_CHANGE');
    this._touchStyleLock(obj.id);
  }

  /**
   * Creates a brand-new standalone text object centered on `worldPoint`, stamped with the
   * current "next text" formatting defaults (see constructor / setText* methods) — the
   * click-to-create counterpart to a shape tool's drag-to-create. Deliberately does
   * NOTHING (no object, no network traffic) for blank/whitespace-only text — the click-
   * then-immediately-cancel path a text tool naturally has (spec: "prevent accidental
   * text creation"), same discipline connector-draft-cancel already follows for its tool.
   * @returns {object|null} the created object, or null if `text` was empty
   */
  createTextObject(worldPoint, text) {
    if (!text || !text.trim()) return null;
    const halfW = DEFAULT_TEXT_WIDTH / 2;
    const halfH = DEFAULT_TEXT_HEIGHT / 2;
    const object = {
      id: generateId(), type: 'text', color: this.textColor, width: 1,
      points: [
        { x: worldPoint.x - halfW, y: worldPoint.y - halfH },
        { x: worldPoint.x + halfW, y: worldPoint.y + halfH },
      ],
      text,
      fontSize: this.textFontSize, fontFamily: this.textFontFamily,
      bold: this.textBold, italic: this.textItalic, underline: this.textUnderline,
      textAlign: this.textAlign, textColor: this.textColor,
      createdAt: Date.now(),
    };
    this.commitCreateObjects([object]);
    this.selectOnly(object.id);
    return object;
  }

  /** @returns {object|null} the selected object, only when exactly one is selected. */
  getSelectedObject() {
    if (this.selectedObjectIds.size !== 1) return null;
    const [id] = this.selectedObjectIds;
    return this.objects.get(id) ?? null;
  }

  /** @returns {object[]} every currently-selected object that still exists. */
  getSelectedObjects() {
    const result = [];
    for (const id of this.selectedObjectIds) {
      const obj = this.objects.get(id);
      if (obj) result.push(obj);
    }
    return result;
  }

  isSelected(id) {
    return this.selectedObjectIds.has(id);
  }

  /** @returns {{minX,minY,maxX,maxY}|null} combined world-space bounds of the current
   *  selection — rotation-aware, so a tilted object contributes its true visual extent. */
  getSelectionBounds() {
    return visualBoundsOfObjectList(this.getSelectedObjects());
  }

  /** @returns {string[]} every id sharing `id`'s group, or just `[id]` if it isn't grouped. */
  _groupMembers(id) {
    const obj = this.objects.get(id);
    if (!obj?.groupId) return [id];
    const members = [];
    for (const o of this.objects.values()) if (o.groupId === obj.groupId) members.push(o.id);
    return members;
  }

  _setSelection(ids) {
    this.selectedObjectIds = new Set(ids);
    // A held style-lock only makes sense while its object stays selected — moving on to
    // something else (or deselecting) is as clear an "I'm done editing" signal as the
    // debounce timer in _touchStyleLock, so don't make the room wait out the full 1.5s.
    if (this._styleLockObjectId && !this.selectedObjectIds.has(this._styleLockObjectId)) {
      clearTimeout(this._styleLockReleaseTimer);
      this._releaseLocks([this._styleLockObjectId]);
      this._styleLockObjectId = null;
    }
    this.markDirty();
    this.dispatchEvent(new CustomEvent('local-selection-change', { detail: { objectIds: [...this.selectedObjectIds] } }));
  }

  /** Replaces the selection with exactly `id` (and its group, if any). */
  selectOnly(id) {
    if (id === null) return this.clearSelection();
    this._setSelection(this._groupMembers(id));
  }

  /** Replaces the selection with exactly this set of ids (marquee, Select All, Layers panel). */
  selectMany(ids) {
    this._setSelection(ids);
  }

  /** Shift-click: toggles `id`'s whole group in/out of the current selection. */
  toggleSelection(id) {
    const group = this._groupMembers(id);
    const next = new Set(this.selectedObjectIds);
    if (group.some((gid) => next.has(gid))) {
      for (const gid of group) next.delete(gid);
    } else {
      for (const gid of group) next.add(gid);
    }
    this._setSelection(next);
  }

  selectAll() {
    this._setSelection([...this.objects.keys()]);
  }

  clearSelection() {
    if (this.selectedObjectIds.size === 0) return;
    this._setSelection([]);
  }

  deselect() {
    this.clearSelection();
  }

  removeObject(id) {
    if (this.objects.delete(id)) {
      this.markDirty();
      this._emitObjectCount();
    }
  }

  restoreObject(object) {
    this.objects.set(object.id, { ...object, points: [...object.points] });
    this.markDirty();
    this._emitObjectCount();
  }

  clearAll() {
    this.objects.clear();
    this.markDirty();
    this._emitObjectCount();
  }

  /**
   * Wholesale-replaces the scene (Phase 7: import / snapshot restore / crash recovery /
   * initial room join are all "load a document" at heart). Unlike `applyObjectStart`
   * called object-by-object, this also drops any selection — local or remote — that
   * points at an object the new document doesn't have, so nothing is left highlighting
   * a shape that no longer exists.
   */
  loadDocument(objects) {
    this.objects.clear();
    for (const obj of objects) this.objects.set(obj.id, { ...obj, points: [...obj.points] });

    for (const id of [...this.selectedObjectIds]) {
      if (!this.objects.has(id)) this.selectedObjectIds.delete(id);
    }
    for (const [userId, sel] of this.remoteSelections) {
      const stillValid = sel.objectIds.filter((id) => this.objects.has(id));
      if (stillValid.length === 0) this.remoteSelections.delete(userId);
      else if (stillValid.length !== sel.objectIds.length) this.remoteSelections.set(userId, { ...sel, objectIds: stillValid });
    }

    this.markDirty();
    this._emitObjectCount();
  }

  // ---- Phase 9: session replay / time travel (read-only historical preview) ----

  /**
   * Shows a derived, historical document instead of the live one — or clears the preview
   * (pass null/undefined) to return to showing `this.objects` again. Never mutates
   * `this.objects`, never touches undo history, never triggers autosave (those all key off
   * events `applyObjectUpdate`/`applyObjectStart`/etc. dispatch, none of which this calls).
   * Clears the local selection on entry so nothing highlights a shape the historical
   * moment may not even contain.
   * @param {object[]|null} objects
   */
  setHistoricalPreview(objects) {
    this.historicalPreview = objects ? new Map(objects.map((o) => [o.id, { ...o, points: o.points.map((p) => ({ ...p })) }])) : null;
    if (this.historicalPreview) this.clearSelection();
    this.markDirty();
    this.dispatchEvent(new CustomEvent('historical-preview-change', { detail: { active: !!this.historicalPreview } }));
  }

  isReplaying() {
    return this.historicalPreview !== null;
  }

  /** @returns {Map<string,object>} whichever document should currently be RENDERED — the
   *  historical preview while replaying, otherwise the live one. Read-only consumers
   *  (Renderer, MiniMap) should always go through this rather than `this.objects` directly
   *  so they automatically show the right thing in both modes. */
  getDisplayObjects() {
    return this.historicalPreview ?? this.objects;
  }

  // ---- Phase 8: batch transactions (move/resize/align/distribute/group/ungroup) ----

  /** Applies a batch of {id, patch} pairs (geometry/grouping/style) by reusing the exact
   *  same applyObjectUpdate path a single style edit already goes through — mini-map,
   *  StylePanel, and autosave all react identically whether one object changed or fifty did. */
  applyBatchUpdate(patches) {
    for (const { id, patch } of patches) this.applyObjectUpdate(id, patch);
  }

  /** Applies a batch update AND originates it: local apply first (zero-latency), then a
   *  'local-batch-update' event RoomConnection relays to the server as ONE undoable
   *  transaction. Used by move/resize/align/distribute/group/ungroup alike. `opType` is a
   *  Phase 9 history-log display label (see shared HISTORY_OP_TYPES/BATCH_OP_TYPES) —
   *  purely cosmetic, never affects the actual patch application. */
  commitBatchUpdate(patches, opType) {
    if (patches.length === 0) return;
    // baseRevision is captured from each object's CURRENT local revision before this
    // patch is applied — the server compares it against its own authoritative counter to
    // catch a stale packet (Phase 10). Computed here, not in RoomConnection, since only
    // the engine knows the object's revision at the exact moment this commits.
    const withRevisions = patches.map(({ id, patch }) => ({ id, patch, baseRevision: this.objects.get(id)?.revision ?? 0 }));
    this.applyBatchUpdate(patches);
    this.dispatchEvent(new CustomEvent('local-batch-update', { detail: { patches: withRevisions, opType } }));
  }

  /** Applies N brand-new objects (paste/duplicate/redo-of-delete) by reusing applyObjectStart per object. */
  createObjects(objects) {
    for (const obj of objects) this.applyObjectStart(obj);
  }

  commitCreateObjects(objects) {
    if (objects.length === 0) return;
    this.createObjects(objects);
    this.dispatchEvent(new CustomEvent('local-objects-create', { detail: { objects } }));
  }

  /** Removes N existing objects, dropping any of them from the current selection too so
   *  nothing highlights a now-deleted object. */
  deleteObjectsBatch(ids) {
    for (const id of ids) {
      this.removeObject(id);
      this.selectedObjectIds.delete(id);
    }
  }

  /** Filters out ids we can already tell (from the last broadcast we saw) are locked by
   *  someone else — "Amber is editing this object" — and notifies for each of them
   *  instead of silently dropping them, before optimistically deleting the rest. A lock
   *  we don't know about yet (a race) is still caught authoritatively server-side and
   *  restored via UPDATE_REJECTED's kind:'delete' path — this is just the fast path. */
  commitDeleteObjects(ids) {
    if (ids.length === 0) return;
    // Cascade: deleting a connected shape must also delete any connector attached to it —
    // a connector with a dangling endpoint (pointing at an object that no longer exists)
    // is never a valid state, so the delete set is expanded the same way group membership
    // already is (see _groupMembers), one atomic delete covering everything (spec #10).
    const expanded = new Set(ids);
    for (const connectorId of this._connectorIdsAttachedTo(ids)) expanded.add(connectorId);
    const deletable = [];
    for (const id of expanded) {
      if (this.isLockedByOther(id)) this._notifyLockConflict(id);
      else deletable.push(id);
    }
    if (deletable.length === 0) return;
    this.deleteObjectsBatch(deletable);
    this.markDirty();
    this.dispatchEvent(new CustomEvent('local-objects-delete', { detail: { ids: deletable } }));
  }

  /** Applies a server-authoritative layer reorder — full replacement of Map iteration
   *  order (the one and only ordering system; see server/src/rooms/Room.js). Never applied
   *  optimistically client-side: it always round-trips through the server so every client
   *  converges on an identical order, the same treatment CLEAR_CANVAS already gets. */
  applyReorder(order) {
    const next = new Map();
    for (const id of order) {
      const obj = this.objects.get(id);
      if (obj) next.set(id, obj);
    }
    this.objects = next;
    this.markDirty();
    this.dispatchEvent(new CustomEvent('object-style-change', { detail: { ids: order } }));
  }

  /** Requests a layer-order change (front/back/forward/backward) for the given ids — pure
   *  network request; the reorder itself is only ever applied via applyReorder, once the
   *  server's authoritative broadcast comes back. */
  requestReorder(ids, op) {
    if (ids.length === 0) return;
    this.dispatchEvent(new CustomEvent('local-reorder-request', { detail: { ids, op } }));
  }

  // ---- Phase 8: clipboard (LOCAL — never networked; only what gets pasted becomes shared state) ----

  copySelectionToClipboard() {
    const objects = this.getSelectedObjects();
    if (objects.length === 0) return;
    this.clipboard = objects.map((o) => ({ ...o, points: o.points.map((p) => ({ ...p })) }));
  }

  pasteFromClipboard() {
    if (this.clipboard.length === 0) return;
    const clones = cloneObjectsForPaste(this.clipboard);
    this.commitCreateObjects(clones);
    this.selectMany(clones.map((c) => c.id));
  }

  duplicateSelection() {
    const objects = this.getSelectedObjects();
    if (objects.length === 0) return;
    const clones = cloneObjectsForPaste(objects);
    this.commitCreateObjects(clones);
    this.selectMany(clones.map((c) => c.id));
  }

  deleteSelection() {
    const ids = [...this.selectedObjectIds];
    if (ids.length === 0) return;
    this.commitDeleteObjects(ids);
  }

  // ---- Phase 8: group / ungroup ----

  groupSelection() {
    const objects = this.getSelectedObjects();
    if (objects.length < 2) return;
    const groupId = generateId();
    this.commitBatchUpdate(objects.map((o) => ({ id: o.id, patch: { groupId } })), 'GROUP');
  }

  ungroupSelection() {
    const objects = this.getSelectedObjects().filter((o) => o.groupId);
    if (objects.length === 0) return;
    this.commitBatchUpdate(objects.map((o) => ({ id: o.id, patch: { groupId: null } })), 'UNGROUP');
  }

  /** Shared tail end for every "compute a set of geometry/rotation patches, then commit
   *  them" command below (align/distribute/rotate/reset-rotation, plus setObjectGeometry) —
   *  applies `shapePatches` to `this.objects` FIRST (so _connectorPatchesFor recomputes
   *  attached connectors from the NEW geometry, not the stale one), then commits the
   *  shape patches and the connector patches together as ONE transaction: one undo entry,
   *  one history event, one revision bump each (Phase 12 spec: never a separate
   *  connector-update cascade from a single shape edit). */
  _commitGeometryPatches(shapePatches, opType) {
    if (shapePatches.length === 0) return;
    for (const { id, patch } of shapePatches) {
      const obj = this.objects.get(id);
      if (obj) Object.assign(obj, patch);
    }
    const connectorIds = this._connectorIdsAttachedTo(shapePatches.map((p) => p.id));
    this.commitBatchUpdate([...shapePatches, ...this._connectorPatchesFor(connectorIds)], opType);
  }

  // ---- Phase 8: align / distribute ----

  alignSelection(mode) {
    this._commitGeometryPatches(computeAlignPatches(this.getSelectedObjects(), mode), 'ALIGN');
  }

  distributeSelection(axis) {
    this._commitGeometryPatches(computeDistributePatches(this.getSelectedObjects(), axis), 'DISTRIBUTE');
  }

  // ---- Phase 11: rotation commands (Command Palette / context menu quick actions) ----
  // Instant one-shot edits, same treatment as align/distribute above — no client-side lock
  // pre-check needed since batchUpdate's server-side partial-tolerance already skips any
  // object locked by someone else and reconciles it via the normal UPDATE_REJECTED path.

  rotateSelectionBy(deltaDegrees) {
    const objects = this.getSelectedObjects().filter((o) => ROTATABLE_TYPES.has(o.type));
    if (objects.length === 0) return;
    const patches = objects.map((o) => ({ id: o.id, patch: { rotation: normalizeRotation((o.rotation ?? 0) + deltaDegrees) } }));
    this._commitGeometryPatches(patches, 'OBJECT_ROTATE');
  }

  resetSelectionRotation() {
    const objects = this.getSelectedObjects().filter((o) => ROTATABLE_TYPES.has(o.type) && (o.rotation ?? 0) !== 0);
    if (objects.length === 0) return;
    this._commitGeometryPatches(objects.map((o) => ({ id: o.id, patch: { rotation: 0 } })), 'OBJECT_ROTATE');
  }

  // ---- Phase 8: live drag/resize preview (ephemeral — never persisted, never undoable) ----

  /** Applies a live drag/resize preview that arrived from another collaborator — mutates
   *  points directly, same visual effect as a locally-dragged object, but touches neither
   *  undo history nor autosave. */
  applyTransformPreview(patches) {
    for (const { id, points, rotation } of patches) {
      const obj = this.objects.get(id);
      if (!obj) continue;
      obj.points = points.map((p) => ({ ...p }));
      if (rotation !== undefined) obj.rotation = rotation; // live rotation preview from another collaborator's in-progress drag
    }
    this.markDirty();
    this.dispatchEvent(new CustomEvent('transform-preview', { detail: { patches } }));
  }

  _maybeEmitTransformPreview(patches) {
    const now = performance.now();
    if (now - this.lastTransformPreviewEmitAt < TRANSFORM_PREVIEW_EMIT_INTERVAL_MS) return;
    this.lastTransformPreviewEmitAt = now;
    this.dispatchEvent(new CustomEvent('local-transform-preview', { detail: { patches } }));
  }

  setRemoteCursor(userId, cursor) {
    this.remoteCursors.set(userId, cursor);
    this.markDirty();
  }

  removeRemoteCursor(userId) {
    if (this.remoteCursors.delete(userId)) this.markDirty();
  }

  getObjectCount() {
    return this.objects.size;
  }

  // ---- remote laser (ephemeral — never touches this.objects) ----
  applyRemoteLaserPoint(userId, point, color) {
    const entry = this.remoteLaserTrails.get(userId) ?? { points: [], color };
    entry.points.push({ x: point.x, y: point.y, t: performance.now() });
    entry.color = color ?? entry.color;
    this.remoteLaserTrails.set(userId, entry);
    this.markDirty();
  }

  clearRemoteLaser(userId) {
    if (this.remoteLaserTrails.delete(userId)) this.markDirty();
  }

  // ---- remote selection (ephemeral — never touches this.objects) ----
  setRemoteSelection(userId, selection) {
    if (!selection.objectIds || selection.objectIds.length === 0) {
      if (this.remoteSelections.delete(userId)) this.markDirty();
      return;
    }
    this.remoteSelections.set(userId, selection);
    this.markDirty();
  }

  clearRemoteSelection(userId) {
    if (this.remoteSelections.delete(userId)) this.markDirty();
  }

  // ---- Phase 10: soft object locking / conflict safety ----

  setSelfUserId(userId) { this.selfUserId = userId; }

  /** Full lock-registry snapshot — used on join/reconnect. Reconnecting never reclaims
   *  OUR own prior locks (the server already dropped them the moment we disconnected),
   *  so this always starts fresh from whatever the server says is currently true rather
   *  than merging with stale local state. */
  setLockSnapshot(locks) {
    this.remoteLocks.clear();
    this.myLockedIds.clear();
    for (const { objectId, userId, userName, color } of locks) {
      this.remoteLocks.set(objectId, { userId, userName, color });
      if (userId === this.selfUserId) this.myLockedIds.add(objectId);
    }
    this.markDirty();
    this.dispatchEvent(new CustomEvent('lock-change'));
  }

  applyLockGranted(objectIds, userId, userName, color) {
    for (const id of objectIds) {
      this.remoteLocks.set(id, { userId, userName, color });
      if (userId === this.selfUserId) this.myLockedIds.add(id);
      else this.myLockedIds.delete(id); // e.g. a control-transfer moved it to someone else
    }
    this.markDirty();
    this.dispatchEvent(new CustomEvent('lock-change'));
  }

  applyLockReleased(objectIds) {
    for (const id of objectIds) {
      this.remoteLocks.delete(id);
      this.myLockedIds.delete(id);
    }
    this.markDirty();
    this.dispatchEvent(new CustomEvent('lock-change'));
  }

  isLockedByOther(objectId) {
    const lock = this.remoteLocks.get(objectId);
    return !!lock && lock.userId !== this.selfUserId;
  }

  lockOwnerOf(objectId) {
    return this.remoteLocks.get(objectId) ?? null;
  }

  /** Fire-and-forget from the engine's own point of view — RoomConnection does the real
   *  round trip. Never blocks whatever local interaction triggered it (spec: don't freeze
   *  pointer interaction waiting on the network); a denial just means the optimistic
   *  drag/edit already under way may get reverted at commit time via the revision check,
   *  which is the actual safety net either way. */
  _requestLocks(objectIds) {
    if (objectIds.length > 0) this.dispatchEvent(new CustomEvent('local-lock-request', { detail: { objectIds } }));
  }

  _releaseLocks(objectIds) {
    if (objectIds.length > 0) this.dispatchEvent(new CustomEvent('local-lock-release', { detail: { objectIds } }));
  }

  /** A brief, non-blocking "this is already locked" notice — fired when we synchronously
   *  already know (from a prior broadcast) that an object just interacted with belongs to
   *  someone else, so the user gets immediate feedback instead of silence. */
  _notifyLockConflict(objectId) {
    const owner = this.lockOwnerOf(objectId);
    this.dispatchEvent(new CustomEvent('local-lock-conflict', { detail: { objectId, ownerUserId: owner?.userId, ownerUserName: owner?.userName } }));
  }

  /** Style edits acquire on the FIRST patch after not already holding the lock, then
   *  auto-release after ~1.5s of inactivity — approximating "begin edit -> preview ->
   *  commit -> release" without needing per-input pointerup instrumentation, and without
   *  acquiring/releasing a lock for every single color-picker tick (spec explicitly warns
   *  against that). Switching which object is being style-edited releases the old one
   *  immediately rather than waiting out its timer. */
  _touchStyleLock(id) {
    if (this._styleLockObjectId !== id) {
      if (this._styleLockObjectId) this._releaseLocks([this._styleLockObjectId]);
      this._styleLockObjectId = id;
    }
    if (!this.myLockedIds.has(id)) this._requestLocks([id]);
    clearTimeout(this._styleLockReleaseTimer);
    this._styleLockReleaseTimer = setTimeout(() => {
      this._releaseLocks([id]);
      if (this._styleLockObjectId === id) this._styleLockObjectId = null;
    }, 1500);
  }

  /**
   * Server-authoritative reconciliation after a rejected update (Phase 10's real safety
   * net, independent of locks) — replaces the ONE affected object with what the server
   * says is actually true, drops any in-progress drag touching it, and flags a brief
   * visual "updated remotely" indicator. Deliberately does nothing scarier than that: no
   * modal, no blocking dialog — see Room.jsx for the accompanying toast.
   */
  reconcileRejectedObject(authoritativeObject) {
    const id = authoritativeObject.id;
    this.objects.set(id, { ...authoritativeObject, points: authoritativeObject.points.map((p) => ({ ...p })) });
    if (this.dragState && (this.dragState.objectId === id || this.dragState.origins?.has(id))) this.dragState = null;
    this.flagConflict(id);
    this.dispatchEvent(new CustomEvent('object-style-change', { detail: { id } }));
  }

  /** A rejected change with no authoritative replacement to apply (e.g. a delete denied
   *  by someone else's lock, restored separately via restoreObject) — just the flash. */
  flagConflict(objectId) {
    this.conflictFlashIds.set(objectId, performance.now() + 1500);
    this.markDirty();
  }

  // ---- Phase 11: X/Y/W/H inspector ----

  /**
   * Applies a precise position/size edit from the inspector panel — moves the object (any
   * X/Y change) and/or scales its LOCAL (unrotated) bounding box from its top-left corner
   * (any W/H change), then commits it exactly like a drag would: through
   * commitBatchUpdate, so it picks up baseRevision/lock-safety/undo/history/autosave for
   * free rather than needing a second code path (spec #15: "must integrate with" all of
   * that — the integration IS reusing this one call). Only fires for a value that's
   * actually different (never a spurious undo entry for re-typing the same number).
   * @param {string} id
   * @param {{x?:number, y?:number, w?:number, h?:number}} values - already-validated finite numbers
   */
  setObjectGeometry(id, { x, y, w, h }) {
    const obj = this.objects.get(id);
    if (!obj) return;
    if (this.isLockedByOther(id)) { this._notifyLockConflict(id); return; }

    const bounds = boundsOfPoints(obj.points);
    const curW = bounds.maxX - bounds.minX;
    const curH = bounds.maxY - bounds.minY;
    const dx = x !== undefined ? x - bounds.minX : 0;
    const dy = y !== undefined ? y - bounds.minY : 0;
    const scaleX = w !== undefined && curW > 0 ? Math.max(w, 1) / curW : 1;
    const scaleY = h !== undefined && curH > 0 ? Math.max(h, 1) / curH : 1;
    if (dx === 0 && dy === 0 && scaleX === 1 && scaleY === 1) return;

    const newPoints = obj.points.map((p) => ({
      x: bounds.minX + dx + (p.x - bounds.minX) * scaleX,
      y: bounds.minY + dy + (p.y - bounds.minY) * scaleY,
    }));
    const opType = scaleX !== 1 || scaleY !== 1 ? 'OBJECT_RESIZE' : 'OBJECT_MOVE';
    this._commitGeometryPatches([{ id, patch: { points: newPoints } }], opType);
  }

  // ---- viewport ----
  zoomBy(factor, screenAnchor) {
    const anchor = screenAnchor ?? { x: this.cssWidth / 2, y: this.cssHeight / 2 };
    this.viewport = zoomAround(this.viewport, anchor, this.viewport.scale * factor);
    this.markDirty();
    this._emitViewport();
    this._broadcastViewport();
  }

  setZoom(scale, screenAnchor) {
    const anchor = screenAnchor ?? { x: this.cssWidth / 2, y: this.cssHeight / 2 };
    this.viewport = zoomAround(this.viewport, anchor, scale);
    this.markDirty();
    this._emitViewport();
    this._broadcastViewport();
  }

  resetView() {
    this.viewport = { x: 0, y: 0, scale: 1 };
    this.markDirty();
    this._emitViewport();
    this._broadcastViewport();
  }

  /** Pans (keeping current zoom) so `worldPoint` lands at the center of the viewport —
   *  what the mini-map uses for click/drag-to-navigate. A real local navigation action,
   *  so it broadcasts and can cancel Follow Mode, same as any other manual pan/zoom. */
  centerOn(worldPoint) {
    this.viewport = {
      scale: this.viewport.scale,
      x: this.cssWidth / 2 - worldPoint.x * this.viewport.scale,
      y: this.cssHeight / 2 - worldPoint.y * this.viewport.scale,
    };
    this.markDirty();
    this._emitViewport();
    this._broadcastViewport();
  }

  /** Applies a viewport that came from the person we're following. Deliberately does NOT
   *  call _broadcastViewport — re-broadcasting a followed viewport as if it were our own
   *  pan/zoom would just echo it back into the room under our name, and would also (via
   *  Room.jsx's 'local-viewport-broadcast' listener) look like a manual pan and cancel
   *  Follow Mode. _emitViewport still fires so the zoom% UI stays accurate. */
  applyRemoteViewport(viewport) {
    this.viewport = { ...viewport };
    this.markDirty();
    this._emitViewport();
  }

  fitToScreen() {
    // visualBoundsOfObjects (not boundsOfObjects) so a rotated shape's true on-screen
    // extent is what gets fit — otherwise a large rotated rectangle could render clipped
    // just outside the viewport after "Fit to Content" (Phase 11).
    const bounds = visualBoundsOfObjects(this.getDisplayObjects());
    if (!bounds) return this.resetView();

    const { minX, minY, maxX, maxY } = bounds;
    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    const padding = 80;
    const scale = clampScale(
      Math.min((this.cssWidth - padding) / width, (this.cssHeight - padding) / height),
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.viewport = {
      scale,
      x: this.cssWidth / 2 - cx * scale,
      y: this.cssHeight / 2 - cy * scale,
    };
    this.markDirty();
    this._emitViewport();
    this._broadcastViewport();
  }

  // ---- input ----
  _screenPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _onPointerDown(e) {
    if (e.button === 2) return;
    const screenPoint = this._screenPoint(e);

    if (this.isSpaceDown || e.button === 1) {
      this.isPanning = true;
      this.panStartScreen = screenPoint;
      this.panStartViewport = { ...this.viewport };
      return;
    }

    // Phase 9: while previewing historical state, panning/zooming (harmless — pure
    // viewport, no document mutation) still works, but every editing interaction is
    // refused here — the single chokepoint that makes Replay Mode read-only by
    // construction rather than by remembering to guard every tool individually.
    if (this.historicalPreview) return;

    const worldPoint = screenToWorld(screenPoint, this.viewport);

    if (this.tool === 'laser') {
      this.isLasering = true;
      this._pushLocalLaserPoint(worldPoint);
      return;
    }

    if (this.tool === 'select') {
      this._handleSelectPointerDown(worldPoint, e);
      return;
    }

    if (this.tool === 'connector') {
      const anchorHit = this._findAnchorNear(worldPoint, this.viewport.scale);
      if (anchorHit) {
        this.connectorDraft = { startObjectId: anchorHit.objectId, startAnchor: anchorHit.anchor, currentPoint: worldPoint };
        this.connectorHoverTarget = null;
        this.markDirty();
      }
      return;
    }

    if (this.tool === 'text') {
      // The text-edit overlay (ui/textEditor.js) focuses a <textarea> synchronously in
      // response to the request-text-edit event this dispatches. Without preventDefault
      // here, the canvas (not focusable) still runs its native mousedown default action
      // right after, which blurs whatever just took focus back to <body> — destroying the
      // overlay before a single character can be typed. dblclick-triggered editing never
      // hit this because dblclick fires after that default action has already settled.
      e.preventDefault();
      this._handleTextPointerDown(worldPoint);
      return;
    }

    if (FREEHAND_TOOLS.has(this.tool)) {
      const id = generateId();
      this.activeStrokeId = id;
      this.lastAcceptedPoint = worldPoint;
      this.pendingOutgoingPoints = [];
      const object = { id, type: this.tool, color: this.color, width: this.strokeWidth, points: [worldPoint], createdAt: Date.now() };
      this.objects.set(id, object);
      this.markDirty();
      this._emitObjectCount();
      this.dispatchEvent(new CustomEvent('draw-start', { detail: { id, type: this.tool, color: this.color, width: this.strokeWidth, point: worldPoint } }));
    } else if (SHAPE_TOOLS.has(this.tool)) {
      const id = generateId();
      const fillFields = this._fillFieldsForNewShape();
      this.activeStrokeId = id;
      this.shapeStart = worldPoint;
      this.previewObject = { id, type: this.tool, color: this.color, width: this.strokeWidth, points: [worldPoint, worldPoint], ...fillFields };
      this.markDirty();
      this.dispatchEvent(new CustomEvent('draw-start', { detail: { id, type: this.tool, color: this.color, width: this.strokeWidth, point: worldPoint, ...fillFields } }));
    }
  }

  /**
   * Pointerdown routing for the Select tool, in priority order:
   *  1. The rotation handle of the (single) currently-selected rotatable shape.
   *  2. A resize handle of the (single) currently-selected shape — starts a resize drag.
   *  3. An object under the pointer — selects its whole group (topmost wins, via
   *     hitTestScene's reverse iteration = z-order) and starts a move drag.
   *  4. Empty space — clears the selection (unless shift, which is additive) and starts a
   *     marquee-select drag.
   */
  _handleSelectPointerDown(worldPoint, e) {
    const scale = this.viewport.scale;

    if (this.selectedObjectIds.size === 1) {
      const [id] = this.selectedObjectIds;
      const obj = this.objects.get(id);

      if (obj && ROTATABLE_TYPES.has(obj.type)) {
        const handlePos = getRotationHandlePosition(obj, scale);
        if (Math.hypot(worldPoint.x - handlePos.x, worldPoint.y - handlePos.y) <= HANDLE_HIT_TOLERANCE / scale) {
          if (this.isLockedByOther(id)) { this._notifyLockConflict(id); return; }
          const center = getObjectCenter(obj);
          this.dragState = {
            mode: 'rotate', objectId: id, center,
            startAngle: angleFromCenter(center, worldPoint),
            startRotation: obj.rotation ?? 0,
            affectedConnectorIds: this._connectorIdsAttachedTo([id]),
          };
          this._requestLocks([id]);
          return;
        }
      }

      if (obj && RESIZABLE_TYPES.has(obj.type)) {
        // A rotated shape's resize handles are computed in LOCAL space (getResizeHandles
        // always has been — it only ever reads obj.points, which is always the unrotated
        // definition, see canvas/geometry/rotation.js) and rendered rotated — so hit-testing
        // them means inverse-rotating the pointer INTO that same local space first, the
        // "transform pointer into object-local coordinates" approach the spec calls for.
        const rotation = obj.rotation ?? 0;
        const center = getObjectCenter(obj);
        const localPoint = rotation ? toLocalPoint(worldPoint, center, rotation) : worldPoint;
        const handle = hitTestHandles(getResizeHandles(obj), localPoint, HANDLE_HIT_TOLERANCE / scale);
        if (handle) {
          // Known-locked-by-someone-else (from the last broadcast we saw) — don't even
          // start the resize; notify instead of silently doing nothing (spec: show
          // "Arpan is editing this object", never fail silently).
          if (this.isLockedByOther(id)) { this._notifyLockConflict(id); return; }
          this.dragState = {
            mode: 'resize', objectId: id, handleId: handle.id, startPoints: obj.points.map((p) => ({ ...p })),
            rotation, rotationCenter: center,
            affectedConnectorIds: this._connectorIdsAttachedTo([id]),
          };
          this._requestLocks([id]);
          // Same rationale as a move drag (see _beginMoveDrag) — one O(n) rebuild here,
          // then every pointermove's smart-guide query is O(candidates) for the rest of
          // this resize.
          this._spatialHash.rebuild(this.objects, id);
          return;
        }
      }
    }

    const hitId = hitTestScene(this.objects, worldPoint, SELECT_HIT_TOLERANCE / scale);
    if (hitId) {
      if (e.shiftKey) {
        this.toggleSelection(hitId);
      } else if (!this.isSelected(hitId)) {
        this.selectOnly(hitId);
      }
      // A shift-click that just removed this object from the selection shouldn't also
      // start dragging it (or whatever else remains selected).
      if (this.isSelected(hitId)) {
        const lockedId = [...this.selectedObjectIds].find((id) => this.isLockedByOther(id));
        if (lockedId) this._notifyLockConflict(lockedId);
        else this._beginMoveDrag(worldPoint);
      }
      return;
    }

    if (!e.shiftKey) this.clearSelection();
    this.marqueeStart = worldPoint;
    this.marqueeRect = { minX: worldPoint.x, minY: worldPoint.y, maxX: worldPoint.x, maxY: worldPoint.y };
    this.markDirty();
  }

  _beginMoveDrag(worldPoint) {
    const origins = new Map();
    for (const id of this.selectedObjectIds) {
      const obj = this.objects.get(id);
      if (obj) origins.set(id, obj.points.map((p) => ({ ...p })));
    }
    this.dragState = {
      mode: 'move', startWorld: worldPoint, origins, moved: false,
      // Cached ONCE here (not rescanned every pointermove) — see _connectorIdsAttachedTo.
      affectedConnectorIds: this._connectorIdsAttachedTo(origins.keys()),
    };
    // Multi-object/group locking is automatic here: `origins` already covers the whole
    // current selection (which selectOnly/toggleSelection already expand to a full group
    // via _groupMembers) — one atomic OBJECTS_LOCK_REQUEST for every object about to move.
    this._requestLocks([...origins.keys()]);
    // Smart-guide/snap candidates are every OTHER object — rebuilt once here (O(n)) rather
    // than scanned fresh on every pointermove for the rest of the drag (see SpatialHash).
    this._spatialHash.rebuild(this.objects, this.selectedObjectIds);
  }

  // ---- Final polish phase: text tool ----

  /**
   * Pointerdown routing for the Text tool: clicking an EXISTING text-capable object
   * (rect/circle/sticky/text — see TEXT_CAPABLE_TYPES) selects it and asks the UI layer to
   * open its inline editor (the DOM-overlay editing surface lives outside the engine —
   * see ui/textEditor.js — so this just dispatches a request, same "engine proposes, UI
   * layer handles DOM" split every other framework-facing concern here already follows).
   * Clicking EMPTY canvas asks for a brand-new text object at that point instead — nothing
   * is actually created here; see createTextObject, called once the UI layer's editor
   * commits non-empty text (never on cancel/empty, so a stray click never litters the room
   * with a blank text object).
   */
  _handleTextPointerDown(worldPoint) {
    const hitId = hitTestScene(this.objects, worldPoint, SELECT_HIT_TOLERANCE / this.viewport.scale);
    if (hitId) {
      const obj = this.objects.get(hitId);
      if (obj && TEXT_CAPABLE_TYPES.has(obj.type)) {
        if (this.isLockedByOther(hitId)) { this._notifyLockConflict(hitId); return; }
        this.selectOnly(hitId);
        this.dispatchEvent(new CustomEvent('request-text-edit', { detail: { id: hitId, isNew: false } }));
      }
      return;
    }
    this.dispatchEvent(new CustomEvent('request-text-edit', { detail: { id: null, isNew: true, point: worldPoint } }));
  }

  /** Double-clicking any text-capable object (regardless of active tool) opens its inline
   *  editor — the "double-click text to edit" affordance every canvas editor has, reusing
   *  the exact same request-text-edit path the Text tool itself uses. */
  _onDoubleClick(e) {
    if (this.historicalPreview) return;
    const worldPoint = screenToWorld(this._screenPoint(e), this.viewport);
    const hitId = hitTestScene(this.objects, worldPoint, SELECT_HIT_TOLERANCE / this.viewport.scale);
    if (!hitId) return;
    const obj = this.objects.get(hitId);
    if (!obj || !TEXT_CAPABLE_TYPES.has(obj.type)) return;
    if (this.isLockedByOther(hitId)) { this._notifyLockConflict(hitId); return; }
    this.selectOnly(hitId);
    this.dispatchEvent(new CustomEvent('request-text-edit', { detail: { id: hitId, isNew: false } }));
  }

  // ---- Phase 12: connector tool (anchor hit-testing — see connector.js for the geometry) ----

  /** @returns {object|null} the topmost connectable object under/near `worldPoint` — the
   *  broad "hovering over this shape" test that reveals its anchor dots, NOT a precise
   *  anchor grab (see _findAnchorNear for that). Same reverse z-order + tolerance-by-scale
   *  treatment as hitTestScene. */
  _findConnectableShapeNear(worldPoint, scale) {
    const objects = [...this.objects.values()];
    const tolerance = SELECT_HIT_TOLERANCE / scale;
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (CONNECTABLE_TYPES.has(obj.type) && hitTestObject(obj, worldPoint, tolerance)) return obj;
    }
    return null;
  }

  /** @returns {{objectId:string, anchor:string, point:{x,y}, dist:number}|null} the closest
   *  anchor point (across EVERY connectable object, not just one shape) within grab
   *  tolerance of `worldPoint` — a fresh O(n) scan, same "on-demand, not incrementally
   *  maintained" tradeoff as the rest of Phase 12's connector lookups. Used both to start a
   *  connector drag and, during one, to decide the current snap target. */
  _findAnchorNear(worldPoint, scale) {
    const tolerance = LIMITS.CONNECTOR_ANCHOR_HIT_RADIUS / scale;
    let best = null;
    for (const obj of this.objects.values()) {
      if (!CONNECTABLE_TYPES.has(obj.type)) continue;
      const candidate = nearestAnchor(obj, worldPoint);
      if (candidate.dist <= tolerance && (!best || candidate.dist < best.dist)) {
        best = { objectId: obj.id, anchor: candidate.anchor, point: candidate.point, dist: candidate.dist };
      }
    }
    return best;
  }

  /** @returns {string[]} ids of every connector with EITHER endpoint touching an object in
   *  `objectIds` — a fresh O(n) scan over the scene, deliberately not maintained
   *  incrementally (same "rebuild on demand" tradeoff SpatialHash documents), since
   *  connectors are a small fraction of a typical diagram. Drag-based callers cache this
   *  ONCE at drag-start rather than calling it every pointermove (see _beginMoveDrag). */
  _connectorIdsAttachedTo(objectIds) {
    const idSet = objectIds instanceof Set ? objectIds : new Set(objectIds);
    const ids = [];
    for (const obj of this.objects.values()) {
      if (obj.type === 'connector' && (idSet.has(obj.start?.objectId) || idSet.has(obj.end?.objectId))) ids.push(obj.id);
    }
    return ids;
  }

  /** Recomputes `points` for each connector id in `connectorIds` from its endpoints'
   *  CURRENT geometry in `this.objects` — the one shared building block behind both the
   *  live drag preview (_applyConnectorPreview) and every commit path, so "how a
   *  connector's points get recalculated" exists in exactly one place.
   *  @returns {Array<{id:string, points:Array<{x,y}>}>} */
  _computeConnectorPointsFor(connectorIds) {
    const results = [];
    for (const id of connectorIds) {
      const connector = this.objects.get(id);
      if (!connector) continue;
      const startShape = this.objects.get(connector.start.objectId);
      const endShape = this.objects.get(connector.end.objectId);
      if (!startShape || !endShape) continue; // dangling endpoint — cascade-delete should prevent this
      const points = computeConnectorPoints(startShape, connector.start.anchor, endShape, connector.end.anchor, connector.routing ?? 'straight');
      results.push({ id, points });
    }
    return results;
  }

  /** Live per-frame drag preview: mutates each connector's points directly (same
   *  optimistic treatment the dragged shape itself already gets) and returns patches
   *  shaped for the 'transform-preview' event / _maybeEmitTransformPreview. */
  _applyConnectorPreview(connectorIds) {
    const results = this._computeConnectorPointsFor(connectorIds);
    for (const { id, points } of results) this.objects.get(id).points = points;
    return results;
  }

  /** Patches shaped for commitBatchUpdate — bundles attached-connector recomputation into
   *  the SAME transaction as the shape's own geometry patch (one undo entry, one revision
   *  bump each, one history event — never a separate connector-update per drag). */
  _connectorPatchesFor(connectorIds) {
    return this._computeConnectorPointsFor(connectorIds).map(({ id, points }) => ({ id, patch: { points } }));
  }

  /** Only rect/circle/sticky/frame carry fill — a line drawn with the fill toolbar section
   *  left open simply ignores it, since FILLABLE_TYPES excludes it. A Sticky Note is
   *  special-cased: it's always filled (a blank note isn't meaningful, spec #24), defaulting
   *  to the classic yellow unless the user already turned on a fill color of their own via
   *  the Fill panel — in which case that explicit choice wins, same as any other shape. */
  _fillFieldsForNewShape() {
    if (this.tool === 'sticky') {
      return {
        fillEnabled: true,
        fillColor: this.fillEnabled && this.fillColor ? this.fillColor : DEFAULT_STICKY_FILL_COLOR,
        fillOpacity: this.fillOpacity,
      };
    }
    if (!FILLABLE_TYPES.has(this.tool)) return {};
    return { fillEnabled: this.fillEnabled, fillColor: this.fillColor, fillOpacity: this.fillOpacity };
  }

  _onPointerMove(e) {
    const screenPoint = this._screenPoint(e);
    const isTransforming = !!this.dragState || !!this.marqueeStart || !!this.connectorDraft;
    if (!this._isInsideCanvas(screenPoint) && !this.isPanning && !this.activeStrokeId && !this.isLasering && !isTransforming) return;

    if (this.isPanning) {
      const dx = screenPoint.x - this.panStartScreen.x;
      const dy = screenPoint.y - this.panStartScreen.y;
      this.viewport = { ...this.panStartViewport, x: this.panStartViewport.x + dx, y: this.panStartViewport.y + dy };
      this.markDirty();
      this._emitViewport();
      this._broadcastViewport();
      return;
    }

    const worldPoint = screenToWorld(screenPoint, this.viewport);
    this._maybeEmitCursor(worldPoint);

    if (this.isLasering) {
      this._pushLocalLaserPoint(worldPoint);
      return;
    }

    if (this.tool === 'connector') {
      if (this.connectorDraft) {
        this.connectorDraft.currentPoint = worldPoint;
        const target = this._findAnchorNear(worldPoint, this.viewport.scale);
        // Never let a connector snap back onto its own starting shape.
        this.connectorHoverTarget = target && target.objectId !== this.connectorDraft.startObjectId ? target : null;
      } else {
        const shape = this._findConnectableShapeNear(worldPoint, this.viewport.scale);
        this.connectorHoverShapeId = shape ? shape.id : null;
      }
      this.markDirty();
      return;
    }

    if (this.dragState?.mode === 'move') {
      let dx = worldPoint.x - this.dragState.startWorld.x;
      let dy = worldPoint.y - this.dragState.startWorld.y;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) this.dragState.moved = true;

      // Alt/Option temporarily bypasses BOTH smart guides and snap-to-grid for precision
      // manual positioning (spec #4) — checked fresh every frame (not just at drag start)
      // so holding/releasing Alt mid-drag takes effect immediately.
      this.activeGuides = [];
      this.activeMeasurements = [];
      if (!e.altKey && (this.smartGuidesEnabled || this.snapToGridEnabled)) {
        const movedBounds = translateBounds(boundsOfManyPoints(this.dragState.origins), dx, dy);
        const threshold = SNAP_THRESHOLD_SCREEN_PX / this.viewport.scale;
        const candidateIds = this._spatialHash.queryBounds(movedBounds, threshold);
        const candidates = [];
        for (const id of candidateIds) {
          const cand = this.objects.get(id);
          if (cand) candidates.push({ id, bounds: boundsOfPoints(cand.points) });
        }
        const snap = computeMoveSnap(movedBounds, candidates, {
          threshold, smartGuidesEnabled: this.smartGuidesEnabled,
          snapToGridEnabled: this.snapToGridEnabled, gridSize: this.gridSize,
        });
        dx += snap.dx;
        dy += snap.dy;
        this.activeGuides = snap.guides;
        this.activeMeasurements = snap.measurements;
      }

      const patches = [];
      for (const [id, origPoints] of this.dragState.origins) {
        const obj = this.objects.get(id);
        if (!obj) continue;
        obj.points = origPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        patches.push({ id, points: obj.points });
      }
      if (this.dragState.affectedConnectorIds.length > 0) {
        patches.push(...this._applyConnectorPreview(this.dragState.affectedConnectorIds));
      }
      this.markDirty();
      this.dispatchEvent(new CustomEvent('transform-preview', { detail: { patches } }));
      this._maybeEmitTransformPreview(patches);
      return;
    }

    if (this.dragState?.mode === 'resize') {
      const obj = this.objects.get(this.dragState.objectId);
      if (obj) {
        // Rotated shapes store LOCAL (unrotated) points, so the incoming WORLD pointer is
        // transformed into that same local frame — around the CENTER captured at drag
        // start, which stays a stable pivot for the whole gesture even though the bbox
        // (and thus its true center) shifts as the resize progresses — before handing it
        // to the exact same resizePoints() math a non-rotated resize already uses.
        let localPoint = this.dragState.rotation
          ? toLocalPoint(worldPoint, this.dragState.rotationCenter, this.dragState.rotation)
          : worldPoint;

        this.activeGuides = [];
        // Edge/center smart guides for the moving edge — only for the bbox-handle model
        // (rect/circle) on an UNROTATED shape: a rotated shape's local frame isn't
        // axis-aligned in world space, so "compare my local edge to another object's world
        // edge" isn't meaningful without a much larger geometry rewrite (see snapping.js's
        // computeResizeSnap doc comment) — grid snapping alone still applies regardless of
        // rotation below, since rounding a local coordinate is rotation-agnostic.
        const movingEdge = !this.dragState.rotation && obj.type !== 'line' ? movingEdgeForHandle(this.dragState.handleId) : null;
        if (movingEdge && !e.altKey && (this.smartGuidesEnabled || this.snapToGridEnabled)) {
          const tentativePoints = resizePoints(obj.type, this.dragState.startPoints, this.dragState.handleId, localPoint);
          const tentativeBounds = boundsOfPoints(tentativePoints);
          const threshold = SNAP_THRESHOLD_SCREEN_PX / this.viewport.scale;
          const candidateIds = this._spatialHash.queryBounds(tentativeBounds, threshold);
          const candidates = [];
          for (const id of candidateIds) {
            const candidate = this.objects.get(id);
            if (candidate) candidates.push({ id, bounds: boundsOfPoints(candidate.points) });
          }
          const snap = computeResizeSnap(tentativeBounds, movingEdge, candidates, {
            threshold, smartGuidesEnabled: this.smartGuidesEnabled,
            snapToGridEnabled: this.snapToGridEnabled, gridSize: this.gridSize,
          });
          localPoint = { x: localPoint.x + snap.dx, y: localPoint.y + snap.dy };
          this.activeGuides = snap.guides;
        } else if (this.snapToGridEnabled && !e.altKey) {
          localPoint = snapPointToGrid(localPoint, this.gridSize);
        }

        obj.points = resizePoints(obj.type, this.dragState.startPoints, this.dragState.handleId, localPoint);
        this.markDirty();
        const patches = [{ id: obj.id, points: obj.points }];
        if (this.dragState.affectedConnectorIds.length > 0) {
          patches.push(...this._applyConnectorPreview(this.dragState.affectedConnectorIds));
        }
        this.dispatchEvent(new CustomEvent('transform-preview', { detail: { patches } }));
        this._maybeEmitTransformPreview(patches);
      }
      return;
    }

    if (this.dragState?.mode === 'rotate') {
      const obj = this.objects.get(this.dragState.objectId);
      if (obj) {
        const currentAngle = angleFromCenter(this.dragState.center, worldPoint);
        let newRotation = normalizeRotation(this.dragState.startRotation + (currentAngle - this.dragState.startAngle));
        // Shift snaps to 15-degree increments (spec #18) — Alt has no special meaning here.
        if (e.shiftKey) newRotation = snapRotation(newRotation, 15);
        obj.rotation = newRotation;
        this.rotationPreview = { objectId: obj.id, degrees: newRotation };
        this.markDirty();
        const patches = [{ id: obj.id, points: obj.points, rotation: newRotation }];
        if (this.dragState.affectedConnectorIds.length > 0) {
          patches.push(...this._applyConnectorPreview(this.dragState.affectedConnectorIds));
        }
        this.dispatchEvent(new CustomEvent('transform-preview', { detail: { patches } }));
        this._maybeEmitTransformPreview(patches);
      }
      return;
    }

    if (this.marqueeStart) {
      const minMarquee = 2 / this.viewport.scale;
      this.marqueeRect = {
        minX: Math.min(this.marqueeStart.x, worldPoint.x),
        minY: Math.min(this.marqueeStart.y, worldPoint.y),
        maxX: Math.max(this.marqueeStart.x, worldPoint.x),
        maxY: Math.max(this.marqueeStart.y, worldPoint.y),
      };
      this.marqueeMoved = this.marqueeRect.maxX - this.marqueeRect.minX > minMarquee || this.marqueeRect.maxY - this.marqueeRect.minY > minMarquee;
      this.markDirty();
      return;
    }

    if (this.tool === 'select') this._updateSelectHoverCursor(worldPoint);

    if (this.activeStrokeId && FREEHAND_TOOLS.has(this.tool)) {
      const minDist = MIN_POINT_DISTANCE / this.viewport.scale;
      if (shouldAcceptPoint(this.lastAcceptedPoint, worldPoint, minDist)) {
        this.lastAcceptedPoint = worldPoint;
        const obj = this.objects.get(this.activeStrokeId);
        if (obj) obj.points.push(worldPoint);
        this.pendingOutgoingPoints.push(worldPoint);
        this.markDirty();
      }
    } else if (this.activeStrokeId && this.shapeStart) {
      // QoL: Shift constrains a rectangle/circle to a square/perfect circle while
      // drawing — the diagonal's larger axis wins, same "hold Shift to constrain"
      // convention the rotation handle's 15° snap already uses elsewhere.
      let endPoint = worldPoint;
      if (e.shiftKey && (this.tool === 'rect' || this.tool === 'circle')) {
        const dx = worldPoint.x - this.shapeStart.x;
        const dy = worldPoint.y - this.shapeStart.y;
        const size = Math.max(Math.abs(dx), Math.abs(dy));
        endPoint = {
          x: this.shapeStart.x + (dx < 0 ? -size : size),
          y: this.shapeStart.y + (dy < 0 ? -size : size),
        };
      }
      this.previewObject = { ...this.previewObject, points: [this.shapeStart, endPoint] };
      this.markDirty();
    }
  }

  /** Hover-only cursor feedback for the Select tool: a resize handle wins (with its
   *  direction-specific cursor), otherwise 'move' over a selectable object, otherwise the
   *  default arrow. Screen-constant handle size — HANDLE_HIT_TOLERANCE is divided by zoom
   *  the same way the drawn handles are, so hit area always matches what's on screen. */
  _updateSelectHoverCursor(worldPoint) {
    if (!this.canvas) return;
    const scale = this.viewport.scale;
    if (this.selectedObjectIds.size === 1) {
      const [id] = this.selectedObjectIds;
      const obj = this.objects.get(id);

      if (obj && ROTATABLE_TYPES.has(obj.type)) {
        const handlePos = getRotationHandlePosition(obj, scale);
        if (Math.hypot(worldPoint.x - handlePos.x, worldPoint.y - handlePos.y) <= HANDLE_HIT_TOLERANCE / scale) {
          this.canvas.style.cursor = 'grab';
          return;
        }
      }

      if (obj && RESIZABLE_TYPES.has(obj.type)) {
        const rotation = obj.rotation ?? 0;
        const localPoint = rotation ? toLocalPoint(worldPoint, getObjectCenter(obj), rotation) : worldPoint;
        const handle = hitTestHandles(getResizeHandles(obj), localPoint, HANDLE_HIT_TOLERANCE / scale);
        if (handle) {
          this.canvas.style.cursor = handle.cursor;
          return;
        }
      }
    }
    const hitId = hitTestScene(this.objects, worldPoint, SELECT_HIT_TOLERANCE / scale);
    this.canvas.style.cursor = hitId ? 'move' : '';
  }

  _finishDrag() {
    const drag = this.dragState;
    this.dragState = null;
    this.activeGuides = [];
    this.activeMeasurements = [];
    this.rotationPreview = null;
    this.markDirty();
    if (drag.mode === 'move') {
      const ids = [...drag.origins.keys()];
      if (!drag.moved) { this._releaseLocks(ids); return; } // a plain click — nothing to commit, done editing
      const patches = [];
      for (const id of ids) {
        const obj = this.objects.get(id);
        if (obj) patches.push({ id, patch: { points: obj.points.map((p) => ({ ...p })) } });
      }
      // Bundled into the SAME commit — one undo entry, one history event, one revision
      // bump each, covers the shape's own move AND every attached connector's re-route.
      patches.push(...this._connectorPatchesFor(drag.affectedConnectorIds));
      this.commitBatchUpdate(patches, 'OBJECT_MOVE');
      this._releaseLocks(ids); // commit == done editing — release right away, no debounce needed for a drag
    } else if (drag.mode === 'resize') {
      const obj = this.objects.get(drag.objectId);
      if (obj) {
        const patches = [{ id: obj.id, patch: { points: obj.points.map((p) => ({ ...p })) } }];
        patches.push(...this._connectorPatchesFor(drag.affectedConnectorIds));
        this.commitBatchUpdate(patches, 'OBJECT_RESIZE');
      }
      this._releaseLocks([drag.objectId]);
    } else if (drag.mode === 'rotate') {
      // ONE logical history operation per rotation drag (spec #22) — every intermediate
      // angle only ever lived in the optimistic preview above; this is the single commit.
      // A plain click with no actual pointermove (rotation unchanged from drag-start)
      // commits nothing, same "no-op click" tolerance move/resize already have.
      const obj = this.objects.get(drag.objectId);
      if (obj && (obj.rotation ?? 0) !== drag.startRotation) {
        const patches = [{ id: obj.id, patch: { rotation: obj.rotation ?? 0 } }];
        patches.push(...this._connectorPatchesFor(drag.affectedConnectorIds));
        this.commitBatchUpdate(patches, 'OBJECT_ROTATE');
      }
      this._releaseLocks([drag.objectId]);
    }
  }

  /** Finalizes (or cancels) an in-progress connector drag on pointerup. Releasing over a
   *  valid, different-shape anchor (this.connectorHoverTarget, kept live by pointermove)
   *  creates the connector via the exact same commitCreateObjects path any other new
   *  object uses; releasing anywhere else silently cancels — no partial/dangling connector
   *  is ever created. */
  _finishConnectorDraft() {
    const draft = this.connectorDraft;
    const target = this.connectorHoverTarget;
    this.connectorDraft = null;
    this.connectorHoverTarget = null;
    this.markDirty();
    if (!target) return;

    const startShape = this.objects.get(draft.startObjectId);
    const endShape = this.objects.get(target.objectId);
    if (!startShape || !endShape) return;

    const points = computeConnectorPoints(startShape, draft.startAnchor, endShape, target.anchor, this.connectorRouting);
    const connector = {
      id: generateId(), type: 'connector', color: this.color, width: this.strokeWidth, points,
      start: { objectId: draft.startObjectId, anchor: draft.startAnchor },
      end: { objectId: target.objectId, anchor: target.anchor },
      routing: this.connectorRouting, arrowEnd: true, createdAt: Date.now(),
    };
    this.commitCreateObjects([connector]);
  }

  _finishMarquee() {
    const rect = this.marqueeRect;
    const moved = this.marqueeMoved;
    this.marqueeStart = null;
    this.marqueeRect = null;
    this.marqueeMoved = false;
    this.markDirty();
    if (!rect || !moved) return; // a plain click on empty space already cleared selection on pointerdown

    const hits = [];
    for (const obj of this.objects.values()) {
      if (rectsIntersect(rect, boundsOfPoints(obj.points))) hits.push(obj.id);
    }
    if (hits.length === 0) return;

    const expanded = new Set(this.selectedObjectIds);
    for (const id of hits) for (const gid of this._groupMembers(id)) expanded.add(gid);
    this._setSelection(expanded);
  }

  _onPointerUp() {
    if (this.isPanning) {
      this.isPanning = false;
      return;
    }
    if (this.isLasering) {
      // No network "laser-end" event needed: the trail is purely time-based (age vs
      // LASER_FADE_MS), so it just stops growing and fades out on its own once points
      // stop arriving — one less event type to keep in sync.
      this.isLasering = false;
      return;
    }
    if (this.connectorDraft) {
      this._finishConnectorDraft();
      return;
    }
    if (this.dragState) {
      this._finishDrag();
      return;
    }
    if (this.marqueeStart) {
      this._finishMarquee();
      return;
    }
    if (!this.activeStrokeId) return;

    const id = this.activeStrokeId;

    if (FREEHAND_TOOLS.has(this.tool)) {
      this._flushOutgoingPoints();
    } else if (this.shapeStart && this.previewObject) {
      const finalPoints = this.previewObject.points;
      this.objects.set(id, { ...this.previewObject, points: finalPoints, createdAt: Date.now() });
      this._emitObjectCount();
      this.dispatchEvent(new CustomEvent('draw-update', { detail: { id, points: [finalPoints[1]] } }));
    }

    this.dispatchEvent(new CustomEvent('draw-end', { detail: { id } }));
    this.activeStrokeId = null;
    this.shapeStart = null;
    this.previewObject = null;
    this.lastAcceptedPoint = null;
    this.markDirty();
  }

  _flushOutgoingPoints() {
    if (this.pendingOutgoingPoints.length === 0) return;
    this.dispatchEvent(new CustomEvent('draw-update', { detail: { id: this.activeStrokeId, points: this.pendingOutgoingPoints } }));
    this.pendingOutgoingPoints = [];
  }

  _maybeEmitCursor(worldPoint) {
    const now = performance.now();
    if (now - this.lastCursorEmitAt < CURSOR_EMIT_INTERVAL_MS) return;
    this.lastCursorEmitAt = now;
    this.dispatchEvent(new CustomEvent('local-cursor', { detail: worldPoint }));
  }

  /** Adds a point to our own laser trail (always, for smooth local rendering) and
   *  throttles the outgoing network emit separately — same split responsibility as
   *  freehand drawing's "render every point, batch what we send" pattern. */
  _pushLocalLaserPoint(worldPoint) {
    this.localLaserTrail.push({ x: worldPoint.x, y: worldPoint.y, t: performance.now() });
    this.markDirty();

    const now = performance.now();
    if (now - this.lastLaserEmitAt < LASER_EMIT_INTERVAL_MS) return;
    this.lastLaserEmitAt = now;
    this.dispatchEvent(new CustomEvent('local-laser-point', { detail: worldPoint }));
  }

  /** Throttled broadcast of a LOCAL viewport change (manual pan/zoom) — never called from
   *  applyRemoteViewport, which is what lets Room.jsx tell "I panned" apart from "the
   *  person I'm following panned" using this same event. */
  _broadcastViewport() {
    const now = performance.now();
    if (now - this.lastViewportBroadcastAt < VIEWPORT_EMIT_INTERVAL_MS) return;
    this.lastViewportBroadcastAt = now;
    this.dispatchEvent(new CustomEvent('local-viewport-broadcast', { detail: { ...this.viewport } }));
  }

  _isInsideCanvas(screenPoint) {
    return screenPoint.x >= 0 && screenPoint.y >= 0 && screenPoint.x <= this.cssWidth && screenPoint.y <= this.cssHeight;
  }

  _onWheel(e) {
    e.preventDefault();
    const screenPoint = this._screenPoint(e);
    const factor = Math.exp(-e.deltaY * 0.001);
    this.zoomBy(factor, screenPoint);
  }

  _onKeyDown(e) {
    if (e.code === 'Escape' && this.connectorDraft) {
      this.connectorDraft = null;
      this.connectorHoverTarget = null;
      this.markDirty();
      return;
    }
    if (e.code === 'Space' && !e.repeat) {
      this.isSpaceDown = true;
      if (this.canvas) this.canvas.style.cursor = 'grab';
    }
  }

  _onKeyUp(e) {
    if (e.code === 'Space') {
      this.isSpaceDown = false;
      if (this.canvas) this.canvas.style.cursor = '';
    }
  }

  // ---- render loop ----
  _loop() {
    // FPS is sampled from the rAF tick rate itself (how often the browser is actually
    // willing to call us), not from redraw count — that stays accurate even on frames
    // where nothing changed and we skipped the draw call.
    this._fpsFrameCount = (this._fpsFrameCount ?? 0) + 1;
    const now = performance.now();
    if (!this._fpsSampleStart) this._fpsSampleStart = now;
    const elapsed = now - this._fpsSampleStart;
    if (elapsed >= FPS_SAMPLE_INTERVAL_MS) {
      const fps = Math.round((this._fpsFrameCount * 1000) / elapsed);
      this.dispatchEvent(new CustomEvent('fps-update', { detail: fps }));
      this._fpsFrameCount = 0;
      this._fpsSampleStart = now;
    }

    this._pruneLaserTrails(now);
    this._pruneConflictFlashes(now);

    if (this.dirty && this.ctx) {
      this.renderer.render(this.ctx, {
        objects: this.getDisplayObjects(),
        // In-progress freehand/shape previews and selection/marquee overlays are all
        // local-editing artifacts — never shown while previewing historical state, since
        // _onPointerDown already refuses to start any of them during replay anyway.
        previewObject: this.historicalPreview ? null : this.previewObject,
        viewport: this.viewport,
        cssWidth: this.cssWidth,
        cssHeight: this.cssHeight,
        dpr: this.dpr,
        remoteCursors: this.remoteCursors,
        localLaserTrail: this.localLaserTrail,
        remoteLaserTrails: this.remoteLaserTrails,
        selfColor: this.selfColor,
        selectedObjectIds: this.selectedObjectIds,
        remoteSelections: this.remoteSelections,
        marqueeRect: this.marqueeRect,
        isDarkMode: this.isDarkMode,
        // Replay Mode must NEVER show live locks as though they existed historically —
        // this engine instance always renders the LIVE canvas, so it's always correct to
        // show them here; TimelinePanel's historical view is a completely separate concern.
        remoteLocks: this.historicalPreview ? null : this.remoteLocks,
        myLockedIds: this.historicalPreview ? null : this.myLockedIds,
        conflictFlashIds: this.conflictFlashIds,
        // Phase 11 — grid/rulers stay visible during replay (pure viewport/UI chrome,
        // spec #35 only excludes them from ever becoming HISTORY, not from rendering);
        // guides/measurements/rotation-preview are drag-only and can't exist during replay
        // anyway since _onPointerDown already refuses to start any interaction then.
        gridEnabled: this.gridEnabled,
        gridSize: this.gridSize,
        rulersEnabled: this.rulersEnabled,
        activeGuides: this.activeGuides,
        activeMeasurements: this.activeMeasurements,
        rotationPreview: this.rotationPreview,
        // Phase 12 — connector-tool ephemera: never shown during replay, same rationale
        // as guides/measurements/rotationPreview above (an interaction can't be in
        // progress while _onPointerDown refuses to start one).
        connectorDraft: this.historicalPreview ? null : this.connectorDraft,
        connectorHoverTarget: this.historicalPreview ? null : this.connectorHoverTarget,
        connectorHoverShapeId: this.historicalPreview ? null : this.connectorHoverShapeId,
      });
      this.dirty = false;
    }
    this.rafId = requestAnimationFrame(this._loop);
  }

  /** Same fade-then-stop-marking-dirty pattern as _pruneLaserTrails — a flash is purely
   *  time-based, so without pruning + re-marking dirty the outline would freeze on its
   *  last-drawn frame instead of actually disappearing after ~1.5s. */
  _pruneConflictFlashes(now) {
    if (this.conflictFlashIds.size === 0) return;
    let stillFading = false;
    for (const [id, expiresAt] of this.conflictFlashIds) {
      if (now >= expiresAt) this.conflictFlashIds.delete(id);
      else stillFading = true;
    }
    if (stillFading) this.markDirty();
  }

  /** Drops fully-faded points so trail arrays don't grow forever, and keeps `dirty` true
   *  while any trail still has live points — the fade is purely age-based (recomputed
   *  every frame in drawLaser), so without this the animation would freeze on the last
   *  frame a new point arrived instead of continuing to fade out afterward. */
  _pruneLaserTrails(now) {
    let stillFading = false;

    if (this.localLaserTrail.length > 0) {
      this.localLaserTrail = this.localLaserTrail.filter((p) => now - p.t < LASER_FADE_MS);
      if (this.localLaserTrail.length > 0) stillFading = true;
    }

    for (const [userId, entry] of this.remoteLaserTrails) {
      const fresh = entry.points.filter((p) => now - p.t < LASER_FADE_MS);
      if (fresh.length === 0) this.remoteLaserTrails.delete(userId);
      else {
        entry.points = fresh;
        stillFading = true;
      }
    }

    if (stillFading) this.markDirty();
  }

  _emitViewport() {
    this.dispatchEvent(new CustomEvent('viewport-change', { detail: { ...this.viewport } }));
  }

  _emitObjectCount() {
    this.dispatchEvent(new CustomEvent('object-count-change', { detail: this.objects.size }));
  }
}
