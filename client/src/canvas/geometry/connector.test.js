import { describe, it, expect } from 'vitest';
import {
  computeAnchorPoint, getAllAnchorPoints, nearestAnchor, computeConnectorPoints,
  connectorLabelPosition, finalSegmentAngle, firstSegmentAngle, CONNECTABLE_TYPES,
} from './connector.js';

const rect = (x0, y0, x1, y1, overrides = {}) => ({ type: 'rect', points: [{ x: x0, y: y0 }, { x: x1, y: y1 }], ...overrides });

describe('computeAnchorPoint', () => {
  it('returns the midpoint of each side for an unrotated rect', () => {
    const shape = rect(0, 0, 100, 50);
    expect(computeAnchorPoint(shape, 'top')).toEqual({ x: 50, y: 0 });
    expect(computeAnchorPoint(shape, 'right')).toEqual({ x: 100, y: 25 });
    expect(computeAnchorPoint(shape, 'bottom')).toEqual({ x: 50, y: 50 });
    expect(computeAnchorPoint(shape, 'left')).toEqual({ x: 0, y: 25 });
  });

  it('rotates the anchor along with the shape (Phase 11 reuse — TEST C)', () => {
    // a 100x100 square rotated 90deg clockwise: what was the top anchor now sits at the
    // old right-anchor's position (canvas rotation convention, +y down).
    const shape = rect(0, 0, 100, 100, { rotation: 90 });
    const top = computeAnchorPoint(shape, 'top');
    expect(top.x).toBeCloseTo(100, 6);
    expect(top.y).toBeCloseTo(50, 6);
  });

  it('rotation 0 is identical to no rotation field at all', () => {
    const a = computeAnchorPoint(rect(0, 0, 100, 100, { rotation: 0 }), 'right');
    const b = computeAnchorPoint(rect(0, 0, 100, 100), 'right');
    expect(a).toEqual(b);
  });
});

describe('getAllAnchorPoints / nearestAnchor', () => {
  it('returns all 4 anchors', () => {
    expect(getAllAnchorPoints(rect(0, 0, 100, 100))).toHaveLength(4);
  });

  it('nearestAnchor picks the closest one deterministically', () => {
    const shape = rect(0, 0, 100, 100);
    const result = nearestAnchor(shape, { x: 100, y: 51 }); // closest to 'right' (100,50)
    expect(result.anchor).toBe('right');
  });
});

describe('computeConnectorPoints — straight routing', () => {
  it('is just the two anchor points', () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(300, 0, 400, 100);
    const points = computeConnectorPoints(a, 'right', b, 'left', 'straight');
    expect(points).toEqual([{ x: 100, y: 50 }, { x: 300, y: 50 }]);
  });
});

describe('computeConnectorPoints — elbow routing', () => {
  it('produces an orthogonal route (every segment horizontal or vertical) with padding steps', () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(300, 300, 400, 400);
    const points = computeConnectorPoints(a, 'right', b, 'top', 'elbow', 20);
    // every consecutive pair must share either x or y (axis-aligned segment)
    for (let i = 1; i < points.length; i++) {
      const dx = Math.abs(points[i].x - points[i - 1].x);
      const dy = Math.abs(points[i].y - points[i - 1].y);
      expect(dx < 1e-6 || dy < 1e-6).toBe(true);
    }
    expect(points[0]).toEqual({ x: 100, y: 50 }); // exact start anchor
    expect(points[points.length - 1]).toEqual({ x: 350, y: 300 }); // exact end anchor
  });

  it('steps out horizontally first from a left/right anchor, vertically first from a top/bottom anchor', () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(300, 300, 400, 400);
    const fromRight = computeConnectorPoints(a, 'right', b, 'left', 'elbow', 20);
    expect(fromRight[1].y).toBeCloseTo(fromRight[0].y); // first move is horizontal (y unchanged)

    const fromBottom = computeConnectorPoints(a, 'bottom', b, 'top', 'elbow', 20);
    expect(fromBottom[1].x).toBeCloseTo(fromBottom[0].x); // first move is vertical (x unchanged)
  });

  it('never produces a zero-length segment when padding collapses two points together', () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(300, 0, 400, 100);
    const points = computeConnectorPoints(a, 'right', b, 'left', 'elbow', 0);
    for (let i = 1; i < points.length; i++) {
      expect(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)).toBeGreaterThan(0);
    }
  });
});

describe('connectorLabelPosition', () => {
  it('is the simple midpoint for a 2-point (straight) route', () => {
    expect(connectorLabelPosition([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toEqual({ x: 50, y: 0 });
  });

  it('is the middle segment\'s midpoint for a multi-point (elbow) route', () => {
    const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 100 }, { x: 40, y: 100 }, { x: 40, y: 200 }];
    const label = connectorLabelPosition(points);
    // middle index of 5 points (length-1)/2 = 2 -> segment [20,100]-[40,100]
    expect(label).toEqual({ x: 30, y: 100 });
  });
});

describe('finalSegmentAngle / firstSegmentAngle (arrowhead orientation — TEST E)', () => {
  it('points right (0deg) for a left-to-right straight connector', () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(finalSegmentAngle(points)).toBeCloseTo(0, 6);
  });

  it('points down (90deg, canvas convention) for a top-to-bottom connector', () => {
    const points = [{ x: 0, y: 0 }, { x: 0, y: 100 }];
    expect(finalSegmentAngle(points)).toBeCloseTo(90, 6);
  });

  it('firstSegmentAngle points back toward the start, opposite of a straight line\'s final angle', () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(firstSegmentAngle(points)).toBeCloseTo(180, 6);
  });

  it('uses the LAST segment of an elbow route, not the overall start-to-end direction', () => {
    const points = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }];
    expect(finalSegmentAngle(points)).toBeCloseTo(90, 6); // last segment is vertical (down)
  });
});

describe('CONNECTABLE_TYPES', () => {
  it('includes shapes with a well-defined rectangular extent, excludes freehand/connector', () => {
    expect(CONNECTABLE_TYPES.has('rect')).toBe(true);
    expect(CONNECTABLE_TYPES.has('circle')).toBe(true);
    expect(CONNECTABLE_TYPES.has('sticky')).toBe(true);
    expect(CONNECTABLE_TYPES.has('frame')).toBe(true);
    expect(CONNECTABLE_TYPES.has('path')).toBe(false);
    expect(CONNECTABLE_TYPES.has('connector')).toBe(false);
  });
});
