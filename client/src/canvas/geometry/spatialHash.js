import { boundsOfPoints } from './points.js';

const DEFAULT_CELL_SIZE = 256; // world units — coarse enough that a typical shape spans 1-4 cells

/**
 * A uniform spatial hash over object bounding boxes — the "lightweight, dependency-free"
 * option the spec calls for over a quadtree. Maps world-space cells to the object ids
 * whose bounds overlap them, so a query for "what's near this area" only has to look at a
 * handful of cells instead of every object in the room.
 *
 * Deliberately NOT kept incrementally in sync with every mutation across the whole app
 * (create/move/resize/rotate/delete/group/import/restore/undo/redo all touch geometry in
 * different places, and wiring an update call into each one would be a lot of surface area
 * for a marginal win). Instead it's rebuilt fresh, once, at the START of each interaction
 * that needs it (a move/resize/rotate drag) via `rebuild()` — an O(n) pass that's cheap
 * compared to a single drag's lifetime, after which every one of that drag's many
 * pointermove queries becomes O(candidates) instead of O(n). Since the OTHER objects being
 * queried against don't change mid-drag, this is correct by construction, not stale.
 */
export class SpatialHash {
  constructor(cellSize = DEFAULT_CELL_SIZE) {
    this.cellSize = cellSize;
    /** @type {Map<string, Set<string>>} "cx,cy" -> object ids overlapping that cell */
    this.cells = new Map();
  }

  clear() {
    this.cells.clear();
  }

  _cellRange(bounds) {
    return {
      cx0: Math.floor(bounds.minX / this.cellSize), cy0: Math.floor(bounds.minY / this.cellSize),
      cx1: Math.floor(bounds.maxX / this.cellSize), cy1: Math.floor(bounds.maxY / this.cellSize),
    };
  }

  insert(id, bounds) {
    const { cx0, cy0, cx1, cy1 } = this._cellRange(bounds);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = `${cx},${cy}`;
        let set = this.cells.get(key);
        if (!set) { set = new Set(); this.cells.set(key, set); }
        set.add(id);
      }
    }
  }

  /** Rebuilds the whole index from an objects Map — see class doc for why this is called
   *  once per interaction rather than incrementally maintained. `skipIds` (optional — a
   *  single id, an array, or a Set) omits objects that are about to be dragged, since
   *  they never need to be candidates against themselves (matters for a multi-selection
   *  move, where every selected object should be excluded, not just one). */
  rebuild(objectsMap, skipIds) {
    this.clear();
    const skip = skipIds instanceof Set ? skipIds : new Set(skipIds ? [].concat(skipIds) : []);
    for (const obj of objectsMap.values()) {
      if (skip.has(obj.id) || !obj.points || obj.points.length === 0) continue;
      this.insert(obj.id, boundsOfPoints(obj.points));
    }
  }

  /** @returns {Set<string>} every object id whose cell(s) overlap `bounds`, expanded by
   *  `margin` world units — a superset of true candidates (cell-granularity, not exact),
   *  which is exactly what a broad-phase spatial query is supposed to be: callers still
   *  apply their own precise distance/threshold check on this smaller candidate set. */
  queryBounds(bounds, margin = 0) {
    const expanded = { minX: bounds.minX - margin, minY: bounds.minY - margin, maxX: bounds.maxX + margin, maxY: bounds.maxY + margin };
    const { cx0, cy0, cx1, cy1 } = this._cellRange(expanded);
    const result = new Set();
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const set = this.cells.get(`${cx},${cy}`);
        if (set) for (const id of set) result.add(id);
      }
    }
    return result;
  }
}
