import { describe, it, expect } from 'vitest';
import {
  isValidPoint,
  isValidPointArray,
  isValidColor,
  isValidStrokeWidth,
  isValidRoomId,
  isValidUsername,
  sanitizeUsername,
  isValidId,
  isValidNullableId,
  isValidZoom,
  isValidViewport,
  isValidOpacity,
  isValidStylePatch,
  isValidCanvasObject,
  isValidBatchPatch,
  isValidIdArray,
  isValidReorderOp,
  isValidRotation,
  isValidAnchor,
  isValidConnectorEndpoint,
  isValidRouting,
  isValidConnectorLabel,
  isValidStickyText,
  isValidFrameTitle,
  validateDocument,
  LIMITS,
} from '@synccanvas/shared';

describe('isValidPoint', () => {
  it('accepts finite in-range coordinates', () => {
    expect(isValidPoint({ x: 10, y: -20 })).toBe(true);
  });
  it('rejects NaN/Infinity and absurd coordinates', () => {
    expect(isValidPoint({ x: NaN, y: 0 })).toBe(false);
    expect(isValidPoint({ x: Infinity, y: 0 })).toBe(false);
    expect(isValidPoint({ x: 99999999, y: 0 })).toBe(false);
  });
  it('rejects malformed input', () => {
    expect(isValidPoint(null)).toBe(false);
    expect(isValidPoint({ x: '1', y: 2 })).toBe(false);
  });
});

describe('isValidPointArray', () => {
  it('rejects an empty array', () => {
    expect(isValidPointArray([])).toBe(false);
  });
  it('rejects arrays over the size cap', () => {
    const points = Array.from({ length: 5 }, () => ({ x: 0, y: 0 }));
    expect(isValidPointArray(points, 3)).toBe(false);
  });
  it('accepts a well-formed batch', () => {
    expect(isValidPointArray([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(true);
  });
});

describe('isValidColor', () => {
  it('accepts 3/6/8-digit hex colors', () => {
    expect(isValidColor('#fff')).toBe(true);
    expect(isValidColor('#112233')).toBe(true);
    expect(isValidColor('#11223344')).toBe(true);
  });
  it('rejects non-hex strings', () => {
    expect(isValidColor('red')).toBe(false);
    expect(isValidColor('javascript:alert(1)')).toBe(false);
  });
});

describe('isValidStrokeWidth', () => {
  it('enforces the configured bounds', () => {
    expect(isValidStrokeWidth(0)).toBe(false);
    expect(isValidStrokeWidth(4)).toBe(true);
    expect(isValidStrokeWidth(1000)).toBe(false);
  });
});

describe('isValidRoomId', () => {
  it('accepts alphanumeric codes of allowed length', () => {
    expect(isValidRoomId('KHYB9E')).toBe(true);
  });
  it('rejects injection-shaped or oversized ids', () => {
    expect(isValidRoomId('../../etc')).toBe(false);
    expect(isValidRoomId('a'.repeat(50))).toBe(false);
  });
});

describe('isValidUsername / sanitizeUsername', () => {
  it('rejects empty and over-length names', () => {
    expect(isValidUsername('')).toBe(false);
    expect(isValidUsername('a'.repeat(50))).toBe(false);
  });
  it('sanitizes angle brackets out of a name', () => {
    expect(sanitizeUsername('<script>evil</script>')).not.toMatch(/[<>]/);
  });
});

describe('isValidId', () => {
  it('rejects ids with path/script-injection characters', () => {
    expect(isValidId('../../etc/passwd')).toBe(false);
    expect(isValidId('<img src=x>')).toBe(false);
  });
  it('accepts normal generated ids', () => {
    expect(isValidId('abc123XYZ-_')).toBe(true);
  });
});

describe('isValidNullableId', () => {
  it('accepts null (deselect) as well as a real id', () => {
    expect(isValidNullableId(null)).toBe(true);
    expect(isValidNullableId('obj123')).toBe(true);
  });
  it('rejects undefined and malformed ids', () => {
    expect(isValidNullableId(undefined)).toBe(false);
    expect(isValidNullableId('<script>')).toBe(false);
  });
});

describe('isValidZoom', () => {
  it('accepts zoom factors within the configured range', () => {
    expect(isValidZoom(1)).toBe(true);
    expect(isValidZoom(0.5)).toBe(true);
  });
  it('rejects non-finite or out-of-range zoom', () => {
    expect(isValidZoom(NaN)).toBe(false);
    expect(isValidZoom(Infinity)).toBe(false);
    expect(isValidZoom(0)).toBe(false);
    expect(isValidZoom(999999)).toBe(false);
  });
});

describe('isValidViewport', () => {
  it('accepts a well-formed viewport', () => {
    expect(isValidViewport({ x: 10, y: -5, scale: 1.5 })).toBe(true);
  });
  it('rejects malformed or absurd viewports', () => {
    expect(isValidViewport(null)).toBe(false);
    expect(isValidViewport({ x: 0, y: 0, scale: -1 })).toBe(false);
    expect(isValidViewport({ x: Infinity, y: 0, scale: 1 })).toBe(false);
  });
});

describe('isValidOpacity', () => {
  it('accepts the full [0,1] range', () => {
    expect(isValidOpacity(0)).toBe(true);
    expect(isValidOpacity(1)).toBe(true);
    expect(isValidOpacity(0.6)).toBe(true);
  });
  it('rejects out-of-range or non-finite values', () => {
    expect(isValidOpacity(-0.1)).toBe(false);
    expect(isValidOpacity(1.1)).toBe(false);
    expect(isValidOpacity(NaN)).toBe(false);
  });
});

describe('isValidStylePatch', () => {
  it('accepts a well-formed partial fill patch', () => {
    expect(isValidStylePatch({ fillEnabled: true, fillColor: '#F97316', fillOpacity: 0.6 })).toBe(true);
  });
  it('accepts a stroke-only patch', () => {
    expect(isValidStylePatch({ color: '#000000', width: 4 })).toBe(true);
  });
  it('rejects an empty patch', () => {
    expect(isValidStylePatch({})).toBe(false);
  });
  it('rejects unknown fields so arbitrary object fields cannot be smuggled in', () => {
    expect(isValidStylePatch({ points: [{ x: 0, y: 0 }] })).toBe(false);
    expect(isValidStylePatch({ color: '#000', userId: 'someone-else' })).toBe(false);
  });
  it('rejects a patch where one field is invalid even if others are valid', () => {
    expect(isValidStylePatch({ color: '#000', fillOpacity: 5 })).toBe(false);
  });
});

function makeObject(overrides = {}) {
  return { id: 'obj1', type: 'rect', color: '#111827', width: 4, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], ...overrides };
}

describe('isValidCanvasObject', () => {
  it('accepts a minimal well-formed object', () => {
    expect(isValidCanvasObject(makeObject())).toBe(true);
  });
  it('accepts an object with optional fill and metadata fields', () => {
    expect(isValidCanvasObject(makeObject({ userId: 'u1', createdAt: 123, fillEnabled: true, fillColor: '#fff', fillOpacity: 0.5 }))).toBe(true);
  });
  it('rejects an unknown field — imported files cannot smuggle arbitrary properties onto an object', () => {
    expect(isValidCanvasObject({ ...makeObject(), extra: 'nope' })).toBe(false);
  });
  it('rejects invalid geometry, color, or width', () => {
    expect(isValidCanvasObject(makeObject({ points: [] }))).toBe(false);
    expect(isValidCanvasObject(makeObject({ color: 'red' }))).toBe(false);
    expect(isValidCanvasObject(makeObject({ width: 0 }))).toBe(false);
  });
  it('rejects an invalid fillOpacity even when everything else is valid', () => {
    expect(isValidCanvasObject(makeObject({ fillEnabled: true, fillOpacity: 2 }))).toBe(false);
  });
  it('rejects non-object input', () => {
    expect(isValidCanvasObject(null)).toBe(false);
    expect(isValidCanvasObject('rect')).toBe(false);
    expect(isValidCanvasObject([])).toBe(false);
  });
  it('accepts a valid rotation (Phase 11) and rejects an out-of-range one', () => {
    expect(isValidCanvasObject(makeObject({ rotation: 45 }))).toBe(true);
    expect(isValidCanvasObject(makeObject({ rotation: 0 }))).toBe(true);
    expect(isValidCanvasObject(makeObject({ rotation: 360 }))).toBe(false); // must already be normalized to [0,360)
    expect(isValidCanvasObject(makeObject({ rotation: -10 }))).toBe(false);
  });

  describe('Phase 12 — connector / sticky / frame', () => {
    function makeConnector(overrides = {}) {
      return makeObject({
        type: 'connector',
        start: { objectId: 'a', anchor: 'right' },
        end: { objectId: 'b', anchor: 'left' },
        ...overrides,
      });
    }

    it('accepts a minimal well-formed connector', () => {
      expect(isValidCanvasObject(makeConnector())).toBe(true);
    });
    it('accepts a connector with optional routing/arrows/label', () => {
      expect(isValidCanvasObject(makeConnector({ routing: 'elbow', arrowStart: true, arrowEnd: false, label: 'REST API' }))).toBe(true);
    });
    it('rejects a connector missing start or end', () => {
      expect(isValidCanvasObject(makeObject({ type: 'connector', end: { objectId: 'b', anchor: 'left' } }))).toBe(false);
      expect(isValidCanvasObject(makeObject({ type: 'connector', start: { objectId: 'a', anchor: 'right' } }))).toBe(false);
    });
    it('rejects a malformed endpoint (bad anchor, missing objectId)', () => {
      expect(isValidCanvasObject(makeConnector({ start: { objectId: 'a', anchor: 'diagonal' } }))).toBe(false);
      expect(isValidCanvasObject(makeConnector({ start: { anchor: 'top' } }))).toBe(false);
    });
    it('rejects an invalid routing value', () => {
      expect(isValidCanvasObject(makeConnector({ routing: 'curvy' }))).toBe(false);
    });
    it('rejects a non-boolean arrow flag', () => {
      expect(isValidCanvasObject(makeConnector({ arrowEnd: 'yes' }))).toBe(false);
    });
    it('rejects an overlong label or one containing angle brackets', () => {
      expect(isValidCanvasObject(makeConnector({ label: 'x'.repeat(200) }))).toBe(false);
      expect(isValidCanvasObject(makeConnector({ label: '<script>' }))).toBe(false);
    });
    it('rejects start/end on a non-connector object — they only ever belong on a connector', () => {
      expect(isValidCanvasObject(makeObject({ start: { objectId: 'a', anchor: 'top' } }))).toBe(false);
    });

    it('accepts a sticky note with text', () => {
      expect(isValidCanvasObject(makeObject({ type: 'sticky', text: 'API auth needs redesign', fillEnabled: true, fillColor: '#FEF3C7' }))).toBe(true);
    });
    it('rejects overlong sticky text', () => {
      expect(isValidCanvasObject(makeObject({ type: 'sticky', text: 'x'.repeat(1000) }))).toBe(false);
    });

    it('accepts a frame with a title', () => {
      expect(isValidCanvasObject(makeObject({ type: 'frame', title: 'Backend' }))).toBe(true);
    });
    it('rejects an overlong frame title', () => {
      expect(isValidCanvasObject(makeObject({ type: 'frame', title: 'x'.repeat(200) }))).toBe(false);
    });
  });
});

describe('Phase 12 connector/sticky/frame field validators', () => {
  it('isValidAnchor accepts the four cardinal anchors only', () => {
    expect(isValidAnchor('top')).toBe(true);
    expect(isValidAnchor('right')).toBe(true);
    expect(isValidAnchor('diagonal')).toBe(false);
    expect(isValidAnchor(undefined)).toBe(false);
  });

  it('isValidConnectorEndpoint requires both a valid id and a valid anchor', () => {
    expect(isValidConnectorEndpoint({ objectId: 'a', anchor: 'top' })).toBe(true);
    expect(isValidConnectorEndpoint({ objectId: 'a', anchor: 'nope' })).toBe(false);
    expect(isValidConnectorEndpoint({ anchor: 'top' })).toBe(false);
    expect(isValidConnectorEndpoint(null)).toBe(false);
  });

  it('isValidRouting accepts straight/elbow only', () => {
    expect(isValidRouting('straight')).toBe(true);
    expect(isValidRouting('elbow')).toBe(true);
    expect(isValidRouting('bezier')).toBe(false);
  });

  it('isValidConnectorLabel allows an empty string (clearing a label) but not overlong/unsafe text', () => {
    expect(isValidConnectorLabel('')).toBe(true);
    expect(isValidConnectorLabel('REST API')).toBe(true);
    expect(isValidConnectorLabel('x'.repeat(LIMITS.MAX_CONNECTOR_LABEL_LEN + 1))).toBe(false);
    expect(isValidConnectorLabel('<b>')).toBe(false);
  });

  it('isValidStickyText bounds length and forbids angle brackets', () => {
    expect(isValidStickyText('a normal note')).toBe(true);
    expect(isValidStickyText('x'.repeat(LIMITS.MAX_STICKY_TEXT_LEN + 1))).toBe(false);
    expect(isValidStickyText('<img>')).toBe(false);
  });

  it('isValidFrameTitle bounds length', () => {
    expect(isValidFrameTitle('Backend')).toBe(true);
    expect(isValidFrameTitle('x'.repeat(LIMITS.MAX_FRAME_TITLE_LEN + 1))).toBe(false);
  });
});

describe('isValidRotation', () => {
  it('accepts [0, 360)', () => {
    expect(isValidRotation(0)).toBe(true);
    expect(isValidRotation(359.9)).toBe(true);
  });
  it('rejects 360 and above, negatives, and non-finite values', () => {
    expect(isValidRotation(360)).toBe(false);
    expect(isValidRotation(-1)).toBe(false);
    expect(isValidRotation(NaN)).toBe(false);
    expect(isValidRotation(Infinity)).toBe(false);
  });
});

describe('validateDocument', () => {
  function makeDoc(overrides = {}) {
    return { format: LIMITS.DOCUMENT_FORMAT, version: LIMITS.DOCUMENT_VERSION, metadata: { name: 'Untitled Canvas' }, objects: [makeObject()], ...overrides };
  }

  it('accepts a well-formed document', () => {
    expect(validateDocument(makeDoc())).toEqual({ ok: true });
  });
  it('accepts a document with an empty objects array', () => {
    expect(validateDocument(makeDoc({ objects: [] }))).toEqual({ ok: true });
  });
  it('rejects the wrong format string', () => {
    expect(validateDocument(makeDoc({ format: 'some-other-app' }))).toEqual({ ok: false, error: 'wrong-format' });
  });
  it('rejects an unsupported version', () => {
    expect(validateDocument(makeDoc({ version: 999 }))).toEqual({ ok: false, error: 'unsupported-version' });
  });
  it('rejects a document whose objects array contains one invalid object', () => {
    const doc = makeDoc({ objects: [makeObject(), makeObject({ color: 'not-a-color' })] });
    expect(validateDocument(doc)).toEqual({ ok: false, error: 'invalid-object' });
  });
  it('rejects random unrelated JSON', () => {
    expect(validateDocument({}).ok).toBe(false);
    expect(validateDocument({ hello: 'world' }).ok).toBe(false);
    expect(validateDocument(null).ok).toBe(false);
  });
  it('rejects metadata with an unknown field or an over-length name', () => {
    expect(validateDocument(makeDoc({ metadata: { name: 'ok', evil: '<script>' } })).ok).toBe(false);
    expect(validateDocument(makeDoc({ metadata: { name: 'x'.repeat(200) } })).ok).toBe(false);
  });
});

describe('isValidBatchPatch (Phase 8 move/resize/align/group)', () => {
  it('accepts a geometry-only patch', () => {
    expect(isValidBatchPatch({ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] })).toBe(true);
  });
  it('accepts a groupId patch, including null (ungroup)', () => {
    expect(isValidBatchPatch({ groupId: 'g1' })).toBe(true);
    expect(isValidBatchPatch({ groupId: null })).toBe(true);
  });
  it('accepts a style-field patch, same as isValidStylePatch would', () => {
    expect(isValidBatchPatch({ color: '#fff', width: 3 })).toBe(true);
  });
  it('accepts Phase 12 connector-attribute, sticky-text, and frame-title patches', () => {
    expect(isValidBatchPatch({ routing: 'elbow' })).toBe(true);
    expect(isValidBatchPatch({ arrowStart: true, arrowEnd: false })).toBe(true);
    expect(isValidBatchPatch({ label: 'REST API' })).toBe(true);
    expect(isValidBatchPatch({ text: 'updated note text' })).toBe(true);
    expect(isValidBatchPatch({ title: 'Backend' })).toBe(true);
  });
  it('rejects an invalid value for a Phase 12 field even when the key is allowed', () => {
    expect(isValidBatchPatch({ routing: 'bezier' })).toBe(false);
    expect(isValidBatchPatch({ label: '<script>' })).toBe(false);
  });
  it('accepts a combined geometry + groupId patch', () => {
    expect(isValidBatchPatch({ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], groupId: 'g1' })).toBe(true);
  });
  it('accepts a rotation-only patch (Phase 11 OBJECT_ROTATE) and rejects an out-of-range angle', () => {
    expect(isValidBatchPatch({ rotation: 45 })).toBe(true);
    expect(isValidBatchPatch({ rotation: 360 })).toBe(false);
  });
  it('rejects an empty patch', () => {
    expect(isValidBatchPatch({})).toBe(false);
  });
  it('rejects unknown keys', () => {
    expect(isValidBatchPatch({ id: 'sneaky', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBe(false);
  });
  it('rejects malformed points', () => {
    expect(isValidBatchPatch({ points: [{ x: NaN, y: 0 }] })).toBe(false);
  });
  it('rejects a non-object patch', () => {
    expect(isValidBatchPatch(null)).toBe(false);
    expect(isValidBatchPatch([1, 2])).toBe(false);
  });
});

describe('isValidIdArray', () => {
  it('accepts a non-empty array of well-formed unique ids', () => {
    expect(isValidIdArray(['a1', 'b2'])).toBe(true);
  });
  it('rejects an empty array', () => {
    expect(isValidIdArray([])).toBe(false);
  });
  it('rejects duplicate ids', () => {
    expect(isValidIdArray(['a1', 'a1'])).toBe(false);
  });
  it('rejects arrays over the max length', () => {
    expect(isValidIdArray(['a1', 'b2'], 1)).toBe(false);
  });
  it('rejects a non-array', () => {
    expect(isValidIdArray('a1')).toBe(false);
  });
});

describe('isValidReorderOp', () => {
  it('accepts the four recognized ops', () => {
    for (const op of ['front', 'back', 'forward', 'backward']) expect(isValidReorderOp(op)).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isValidReorderOp('sideways')).toBe(false);
    expect(isValidReorderOp(undefined)).toBe(false);
  });
});
