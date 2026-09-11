/** Single source of truth for which drawing tools exist, their toolbar label, and their
 *  keyboard shortcut — consumed by both the Toolbar UI and useKeyboardShortcuts.
 *  'laser' is intentionally not a drawing tool: it never creates a canvas object (see
 *  CanvasEngine's pointer handlers, which branch on it before touching this.objects). */
export const TOOL_DEFS = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'path', label: 'Pencil', shortcut: 'P' },
  { id: 'eraser', label: 'Eraser', shortcut: 'E' },
  { id: 'line', label: 'Line', shortcut: 'L' },
  { id: 'rect', label: 'Rectangle', shortcut: 'R' },
  { id: 'circle', label: 'Circle', shortcut: 'C' },
  { id: 'connector', label: 'Connector', shortcut: 'X' },
  { id: 'sticky', label: 'Sticky Note', shortcut: 'S' },
  { id: 'frame', label: 'Frame', shortcut: 'F' },
  { id: 'laser', label: 'Laser Pointer', shortcut: 'G' },
];
