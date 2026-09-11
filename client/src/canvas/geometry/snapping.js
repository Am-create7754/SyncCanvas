/**
 * Pure snapping math for Phase 11's smart guides / object snapping / snap-to-grid — no
 * canvas, no engine state, so it's trivial to unit test and reason about independently of
 * pointer-event plumbing. Everything here operates in WORLD space; the caller (CanvasEngine)
 * is responsible for converting a screen-space threshold to world units (divide by
 * viewport.scale) before calling in, which is what keeps snapping feeling consistent at
 * every zoom level (spec #2).
 */

/** Same-kind alignment targets compared per axis — left-left, right-right, center-center
 *  (never edge-to-opposite-edge, which would make guides fire unpredictably often). */
function axisTargets(bounds, minKey, maxKey) {
  return [
    { kind: 'min', value: bounds[minKey] },
    { kind: 'center', value: (bounds[minKey] + bounds[maxKey]) / 2 },
    { kind: 'max', value: bounds[maxKey] },
  ];
}

/**
 * Finds the single best (closest, deterministic) alignment on one axis between the
 * dragged object's bounds and a list of candidate bounds. Ties resolve to whichever
 * candidate was checked first (callers pass candidates in a stable, e.g. z-order, order),
 * so the result never jitters between equally-good options frame to frame (spec #3).
 * Exported (not just used internally by computeMoveSnap) so computeResizeSnap below can
 * reuse the exact same matching/threshold/determinism logic rather than a second copy of
 * it — see that function's own doc comment.
 * @returns {{delta:number, position:number, candidateId:string}|null}
 */
export function findBestAxisSnap(draggedBounds, candidates, minKey, maxKey, threshold) {
  const draggedTargets = axisTargets(draggedBounds, minKey, maxKey);
  let best = null;
  for (const candidate of candidates) {
    const candidateTargets = axisTargets(candidate.bounds, minKey, maxKey);
    for (const dt of draggedTargets) {
      for (const ct of candidateTargets) {
        if (dt.kind !== ct.kind) continue; // only match like-with-like (left-left, center-center, ...)
        const delta = ct.value - dt.value;
        const dist = Math.abs(delta);
        if (dist > threshold) continue;
        if (!best || dist < best.dist) {
          best = { dist, delta, position: ct.value, candidateId: candidate.id };
        }
      }
    }
  }
  return best;
}

/** @returns {number} `value` rounded to the nearest multiple of `gridSize`. */
export function snapToGridValue(value, gridSize) {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Computes the position correction (dx/dy) to snap a moving selection's combined bounds
 * against nearby objects and/or the grid, plus what to render for it (guide lines,
 * distance measurements). Smart guides take priority over grid snapping per axis when
 * both are enabled and a guide match exists (spec #9) — grid only fills in an axis smart
 * guides didn't resolve.
 *
 * @param {{minX,minY,maxX,maxY}} currentBounds - the dragged selection's bounds AFTER the
 *   raw (unsnapped) pointer delta has already been applied
 * @param {Array<{id:string, bounds:{minX,minY,maxX,maxY}}>} candidates - other objects,
 *   in stable (e.g. z-order) iteration order for deterministic tie-breaking
 * @param {{threshold:number, smartGuidesEnabled:boolean, snapToGridEnabled:boolean, gridSize:number}} options
 * @returns {{dx:number, dy:number, guides:Array, measurements:Array}}
 */
export function computeMoveSnap(currentBounds, candidates, options) {
  const { threshold, smartGuidesEnabled, snapToGridEnabled, gridSize } = options;
  let dx = 0;
  let dy = 0;
  const guides = [];

  const snapX = smartGuidesEnabled ? findBestAxisSnap(currentBounds, candidates, 'minX', 'maxX', threshold) : null;
  const snapY = smartGuidesEnabled ? findBestAxisSnap(currentBounds, candidates, 'minY', 'maxY', threshold) : null;

  if (snapX) {
    dx = snapX.delta;
    const candidate = candidates.find((c) => c.id === snapX.candidateId);
    // A VERTICAL line (constant x) — its rendered extent spans the y-range covering both
    // the dragged object and its alignment partner, so it visually connects them.
    guides.push({ axis: 'v', position: snapX.position, extentMin: Math.min(currentBounds.minY, candidate.bounds.minY), extentMax: Math.max(currentBounds.maxY, candidate.bounds.maxY) });
  } else if (snapToGridEnabled) {
    dx = snapToGridValue(currentBounds.minX, gridSize) - currentBounds.minX;
  }

  if (snapY) {
    dy = snapY.delta;
    const candidate = candidates.find((c) => c.id === snapY.candidateId);
    // A HORIZONTAL line (constant y) — extent spans the x-range covering both objects.
    guides.push({ axis: 'h', position: snapY.position, extentMin: Math.min(currentBounds.minX, candidate.bounds.minX), extentMax: Math.max(currentBounds.maxX, candidate.bounds.maxX) });
  } else if (snapToGridEnabled) {
    dy = snapToGridValue(currentBounds.minY, gridSize) - currentBounds.minY;
  }

  const measurements = computeMeasurements({ minX: currentBounds.minX + dx, minY: currentBounds.minY + dy, maxX: currentBounds.maxX + dx, maxY: currentBounds.maxY + dy }, candidates);

  return { dx, dy, guides, measurements };
}

const MEASUREMENT_MAX_DISTANCE = 400; // world units — "only useful nearby relationships" (spec #13)

/**
 * Finds the nearest non-overlapping neighbor along each axis and reports the gap between
 * them — the "48 px" distance callout. Only ever reports genuinely adjacent relationships
 * (a real gap, within a sane range), never for every object in the scene.
 * @returns {Array<{axis:'x'|'y', distance:number, from:number, to:number, at:number}>}
 */
export function computeMeasurements(bounds, candidates) {
  const measurements = [];
  let bestX = null;
  let bestY = null;

  for (const candidate of candidates) {
    const b = candidate.bounds;
    const overlapsY = bounds.minY < b.maxY && bounds.maxY > b.minY;
    const overlapsX = bounds.minX < b.maxX && bounds.maxX > b.minX;

    if (overlapsY) {
      const gap = b.minX >= bounds.maxX ? b.minX - bounds.maxX : (bounds.minX >= b.maxX ? bounds.minX - b.maxX : null);
      if (gap !== null && gap <= MEASUREMENT_MAX_DISTANCE && (!bestX || gap < bestX.distance)) {
        const [from, to] = b.minX >= bounds.maxX ? [bounds.maxX, b.minX] : [b.maxX, bounds.minX];
        bestX = { axis: 'x', distance: gap, from, to, at: (Math.max(bounds.minY, b.minY) + Math.min(bounds.maxY, b.maxY)) / 2 };
      }
    }
    if (overlapsX) {
      const gap = b.minY >= bounds.maxY ? b.minY - bounds.maxY : (bounds.minY >= b.maxY ? bounds.minY - b.maxY : null);
      if (gap !== null && gap <= MEASUREMENT_MAX_DISTANCE && (!bestY || gap < bestY.distance)) {
        const [from, to] = b.minY >= bounds.maxY ? [bounds.maxY, b.minY] : [b.maxY, bounds.minY];
        bestY = { axis: 'y', distance: gap, from, to, at: (Math.max(bounds.minX, b.minX) + Math.min(bounds.maxX, b.maxX)) / 2 };
      }
    }
  }

  if (bestX) measurements.push(bestX);
  if (bestY) measurements.push(bestY);
  return measurements;
}

/**
 * Grid-only snap for a resize's moving edge/corner. Still used directly for the line tool
 * (whose two endpoints aren't "edges" in the bounding-box sense computeResizeSnap below
 * assumes — see CanvasEngine's resize handler for which shapes use which path).
 * @returns {{x:number, y:number}}
 */
export function snapPointToGrid(point, gridSize) {
  return { x: snapToGridValue(point.x, gridSize), y: snapToGridValue(point.y, gridSize) };
}

/**
 * Smart-guide + grid snapping for a resize's moving edge(s) — reuses `findBestAxisSnap`
 * unchanged, the exact same matching engine `computeMoveSnap` uses for a drag, rather than
 * inventing a second one (only the caller's framing differs: a resize moves ONE edge at a
 * time, not the whole bounds). The trick is representing "my moving edge is at world
 * position v" as a degenerate {minX: v, maxX: v} bounds — since `findBestAxisSnap` compares
 * min/center/max independently but a degenerate bounds has all three coincide at `v`, this
 * naturally matches the moving edge against ANY of a candidate's min/center/max (unlike a
 * move, where only same-kind edges match), which is exactly the right behavior for
 * resizing: a dragged right edge should be able to land on a neighbor's left edge, right
 * edge, or center alike.
 *
 * @param {{minX,minY,maxX,maxY}} tentativeBounds - the resized shape's bounds after the
 *   raw (unsnapped) pointer position has already been applied
 * @param {{x:'minX'|'maxX'|null, y:'minY'|'maxY'|null}} movingEdge - which bounds key(s)
 *   this handle actually drags (e.g. an 'e' handle only moves maxX) — see
 *   CanvasEngine's handleId -> movingEdge mapping
 * @param {Array<{id:string, bounds:{minX,minY,maxX,maxY}}>} candidates
 * @param {{threshold:number, smartGuidesEnabled:boolean, snapToGridEnabled:boolean, gridSize:number}} options
 * @returns {{dx:number, dy:number, guides:Array}}
 */
export function computeResizeSnap(tentativeBounds, movingEdge, candidates, options) {
  const { threshold, smartGuidesEnabled, snapToGridEnabled, gridSize } = options;
  let dx = 0;
  let dy = 0;
  const guides = [];

  if (movingEdge.x) {
    const v = tentativeBounds[movingEdge.x];
    const snap = smartGuidesEnabled ? findBestAxisSnap({ minX: v, maxX: v }, candidates, 'minX', 'maxX', threshold) : null;
    if (snap) {
      dx = snap.delta;
      const candidate = candidates.find((c) => c.id === snap.candidateId);
      guides.push({ axis: 'v', position: snap.position, extentMin: Math.min(tentativeBounds.minY, candidate.bounds.minY), extentMax: Math.max(tentativeBounds.maxY, candidate.bounds.maxY) });
    } else if (snapToGridEnabled) {
      dx = snapToGridValue(v, gridSize) - v;
    }
  }

  if (movingEdge.y) {
    const v = tentativeBounds[movingEdge.y];
    const snap = smartGuidesEnabled ? findBestAxisSnap({ minY: v, maxY: v }, candidates, 'minY', 'maxY', threshold) : null;
    if (snap) {
      dy = snap.delta;
      const candidate = candidates.find((c) => c.id === snap.candidateId);
      guides.push({ axis: 'h', position: snap.position, extentMin: Math.min(tentativeBounds.minX, candidate.bounds.minX), extentMax: Math.max(tentativeBounds.maxX, candidate.bounds.maxX) });
    } else if (snapToGridEnabled) {
      dy = snapToGridValue(v, gridSize) - v;
    }
  }

  return { dx, dy, guides };
}
