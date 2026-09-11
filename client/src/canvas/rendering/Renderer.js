import { drawObject } from './drawObject.js';
import { drawCursor } from './drawCursor.js';
import { drawGrid } from './drawGrid.js';
import { drawLineGrid } from './drawLineGrid.js';
import { drawRulers } from './drawRulers.js';
import { drawLaser } from './drawLaser.js';
import { drawSelectionBox, drawBoundsBox, drawResizeHandles, drawMarquee } from './drawSelection.js';
import { drawSmartGuides, drawMeasurements } from './drawSmartGuides.js';
import { drawRotationHandle } from './drawRotationHandle.js';
import { drawConnectorAnchors, drawConnectorDraft } from './drawConnectorPreview.js';
import { worldToScreen } from '../geometry/viewport.js';
import { visualBoundsOfObjectList } from '../geometry/objectBounds.js';
import { boundsOfPoints } from '../geometry/points.js';
import { getResizeHandles, RESIZABLE_TYPES } from '../geometry/resizeHandles.js';
import { getObjectCenter, getRotationHandlePosition, ROTATABLE_TYPES } from '../geometry/rotation.js';
import { computeAnchorPoint } from '../geometry/connector.js';

const LOCAL_SELECTION_COLOR = '#6366F1';
const CONFLICT_FLASH_COLOR = '#F59E0B';

/**
 * True when exactly one object is selected AND it's locked by someone OTHER than us —
 * exported (not just inlined in render()) so the "local resize handles must not render for
 * a remotely-locked object" rule (Phase 10 fix pass) has a direct, canvas-free regression
 * test rather than needing a full render() + mock-ctx call to exercise it.
 * @param {Set<string>|undefined} selectedObjectIds
 * @param {Map<string,{userId:string}>|undefined} remoteLocks - objectId -> current lock owner
 * @param {Set<string>|undefined} myLockedIds - ids WE currently hold the lock for
 */
export function isSingleSelectionLockedByOther(selectedObjectIds, remoteLocks, myLockedIds) {
  if (selectedObjectIds?.size !== 1) return false;
  const [id] = selectedObjectIds;
  return !!remoteLocks?.has(id) && !myLockedIds?.has(id);
}

/** Runs `fn` with the canvas transform additionally rotated by `object.rotation` around
 *  the object's own center — the one place this rotation transform is applied, reused for
 *  drawing the object itself AND (separately, per call site) its selection box, resize
 *  handles, and rotation handle, so all of those track a rotated object identically rather
 *  than needing their own rotation-aware math. A no-op (no save/restore) when rotation is
 *  0, which is the common case and keeps unrotated rendering exactly as cheap as before. */
function withObjectRotation(ctx, object, fn) {
  const rotation = object.rotation ?? 0;
  if (!rotation) { fn(); return; }
  const center = getObjectCenter(object);
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-center.x, -center.y);
  fn();
  ctx.restore();
}

/**
 * Pure rendering pass: given the current scene, paint one frame. Holds no state of its
 * own — CanvasEngine decides *when* to call this (dirty-flag + rAF), this just decides
 * *how* a frame looks. Keeping it stateless makes it trivial to unit test in isolation.
 */
export class Renderer {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} scene
   * @param {Map<string, object>} scene.objects
   * @param {object|null} scene.previewObject - local in-progress shape being dragged
   * @param {{x:number,y:number,scale:number}} scene.viewport
   * @param {number} scene.cssWidth
   * @param {number} scene.cssHeight
   * @param {number} scene.dpr
   * @param {Map<string, object>} scene.remoteCursors - userId -> {x,y,username,color}
   * @param {Array<{x,y,t}>} scene.localLaserTrail
   * @param {Map<string, Array<{x,y,t}>>} scene.remoteLaserTrails - userId -> trail
   * @param {string} scene.selfColor
   * @param {Set<string>} scene.selectedObjectIds
   * @param {Map<string, {objectIds:string[],color,username}>} scene.remoteSelections
   * @param {{minX,minY,maxX,maxY}|null} scene.marqueeRect
   * @param {boolean} scene.gridEnabled
   * @param {number} scene.gridSize
   * @param {boolean} scene.rulersEnabled
   * @param {Array} scene.activeGuides - ephemeral smart-guide lines, current drag only
   * @param {Array} scene.activeMeasurements - ephemeral distance callouts, current drag only
   * @param {{objectId:string, degrees:number}|null} scene.rotationPreview
   */
  render(ctx, scene) {
    const {
      objects, previewObject, viewport, cssWidth, cssHeight, dpr, remoteCursors,
      localLaserTrail, remoteLaserTrails, selfColor, selectedObjectIds, remoteSelections,
      marqueeRect, isDarkMode, remoteLocks, myLockedIds, conflictFlashIds,
      gridEnabled, gridSize, rulersEnabled, activeGuides, activeMeasurements, rotationPreview,
      connectorDraft, connectorHoverTarget, connectorHoverShapeId,
    } = scene;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    drawGrid(ctx, { viewport, cssWidth, cssHeight, dark: isDarkMode });
    if (gridEnabled) drawLineGrid(ctx, { viewport, cssWidth, cssHeight, gridSize, dark: isDarkMode });

    ctx.save();
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.scale, viewport.scale);

    for (const object of objects.values()) withObjectRotation(ctx, object, () => drawObject(ctx, object));
    if (previewObject) drawObject(ctx, previewObject);

    // An object someone ELSE holds the lock on gets its own, heavier box drawn separately
    // below (with resize handles deliberately withheld there too) — skip the plain local
    // selection box/handles here so a selected-but-locked object doesn't show two
    // different UIs (a resizable-looking indigo box AND a red "editing" box) at once.
    const singleSelectedLockedByOther = isSingleSelectionLockedByOther(selectedObjectIds, remoteLocks, myLockedIds);

    if (selectedObjectIds && selectedObjectIds.size === 1 && !singleSelectedLockedByOther) {
      const [id] = selectedObjectIds;
      const obj = objects.get(id);
      if (obj) {
        // Holding the lock on your own single selection gets a small, subtle "Editing"
        // label — distinct from a bare selection, but deliberately not the same heavy
        // treatment a REMOTE editor's box gets below (spec: keep the local indicator
        // subtle, not cluttered).
        const editingLabel = myLockedIds?.has(id) ? 'Editing' : undefined;
        withObjectRotation(ctx, obj, () => {
          drawSelectionBox(ctx, obj, { color: LOCAL_SELECTION_COLOR, dashed: true, label: editingLabel, scale: viewport.scale });
          if (RESIZABLE_TYPES.has(obj.type)) {
            drawResizeHandles(ctx, getResizeHandles(obj), { color: LOCAL_SELECTION_COLOR, scale: viewport.scale });
          }
          if (ROTATABLE_TYPES.has(obj.type)) {
            const { minX, minY, maxX } = boundsOfPoints(obj.points);
            const localHandle = getRotationHandlePosition({ ...obj, rotation: 0 }, viewport.scale);
            const isRotatingThis = rotationPreview?.objectId === id;
            drawRotationHandle(ctx, localHandle, minY, (minX + maxX) / 2, {
              color: LOCAL_SELECTION_COLOR, scale: viewport.scale,
              angleLabel: isRotatingThis ? rotationPreview.degrees : null,
            });
          }
        });
      }
    } else if (selectedObjectIds && selectedObjectIds.size > 1) {
      const selected = [...selectedObjectIds].map((id) => objects.get(id)).filter(Boolean);
      drawBoundsBox(ctx, visualBoundsOfObjectList(selected), { color: LOCAL_SELECTION_COLOR, scale: viewport.scale });
    }

    if (remoteSelections && remoteSelections.size > 0) {
      for (const [userId, sel] of remoteSelections) {
        // A remotely LOCKED object gets its own, stronger box drawn separately below —
        // skip the plain "merely selected" box here so the two visual weights never stack
        // on top of each other and blur together.
        const isEditingAny = sel.objectIds.some((id) => remoteLocks?.get(id)?.userId === userId);
        if (isEditingAny) continue;
        const selected = sel.objectIds.map((id) => objects.get(id)).filter(Boolean);
        if (selected.length === 1) {
          withObjectRotation(ctx, selected[0], () => drawSelectionBox(ctx, selected[0], { color: sel.color, label: sel.username, scale: viewport.scale }));
        } else if (selected.length > 1) {
          drawBoundsBox(ctx, visualBoundsOfObjectList(selected), { color: sel.color, scale: viewport.scale });
        }
      }
    }

    // Editing indicators (Phase 10) — visually distinct from mere selection: a solid,
    // heavier outline plus an explicit "{name} editing" label, never just "{name}".
    if (remoteLocks && remoteLocks.size > 0) {
      for (const [id, lock] of remoteLocks) {
        const obj = objects.get(id);
        if (obj && !myLockedIds?.has(id)) {
          withObjectRotation(ctx, obj, () => drawSelectionBox(ctx, obj, { color: lock.color ?? '#EF4444', label: `${lock.userName ?? 'Someone'} editing`, weight: 3.5, scale: viewport.scale }));
        }
      }
    }

    // A brief "updated remotely" flash after a server-rejected update was reconciled —
    // deliberately NOT a modal, just a fading outline (spec: no scary error UI).
    if (conflictFlashIds && conflictFlashIds.size > 0) {
      for (const id of conflictFlashIds.keys()) {
        const obj = objects.get(id);
        if (obj) withObjectRotation(ctx, obj, () => drawSelectionBox(ctx, obj, { color: CONFLICT_FLASH_COLOR, dashed: true, label: '⚠ Updated remotely', weight: 2.5, scale: viewport.scale }));
      }
    }

    if (marqueeRect) drawMarquee(ctx, marqueeRect, { scale: viewport.scale });
    drawSmartGuides(ctx, activeGuides, viewport.scale);
    drawMeasurements(ctx, activeMeasurements, viewport.scale);

    // Phase 12 — Connector tool hover/drag affordances, drawn last (on top of everything
    // else in world space) so anchor dots and the in-progress line are never occluded by
    // an object drawn later in z-order.
    if (connectorDraft) {
      const startShape = objects.get(connectorDraft.startObjectId);
      if (startShape) {
        const startPoint = computeAnchorPoint(startShape, connectorDraft.startAnchor);
        drawConnectorDraft(ctx, startPoint, connectorDraft, connectorHoverTarget, viewport.scale);
      }
      if (connectorHoverTarget) {
        const targetShape = objects.get(connectorHoverTarget.objectId);
        if (targetShape) drawConnectorAnchors(ctx, targetShape, viewport.scale, connectorHoverTarget.anchor);
      }
    } else if (connectorHoverShapeId) {
      const hoverShape = objects.get(connectorHoverShapeId);
      if (hoverShape) drawConnectorAnchors(ctx, hoverShape, viewport.scale);
    }

    const now = performance.now();
    if (localLaserTrail && localLaserTrail.length > 0) drawLaser(ctx, localLaserTrail, selfColor, now);
    if (remoteLaserTrails && remoteLaserTrails.size > 0) {
      for (const [, entry] of remoteLaserTrails) {
        if (entry.points.length > 0) drawLaser(ctx, entry.points, entry.color ?? '#F43F5E', now);
      }
    }

    ctx.restore();

    if (remoteCursors && remoteCursors.size > 0) {
      for (const [, cursor] of remoteCursors) {
        const screenPos = worldToScreen(cursor, viewport);
        drawCursor(ctx, screenPos, cursor);
      }
    }

    if (rulersEnabled) drawRulers(ctx, { viewport, cssWidth, cssHeight, dark: isDarkMode });
  }
}
