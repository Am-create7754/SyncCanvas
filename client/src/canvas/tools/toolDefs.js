/** Single source of truth for which drawing tools exist, their toolbar label, and their
 *  keyboard shortcut — consumed by both the Toolbar UI and useKeyboardShortcuts.
 *  'laser' is intentionally not a drawing tool: it never creates a canvas object (see
 *  CanvasEngine's pointer handlers, which branch on it before touching this.objects). */
export const TOOL_DEFS = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'path', label: 'Brush', shortcut: 'P' },
  { id: 'eraser', label: 'Eraser', shortcut: 'E' },
  { id: 'rect', label: 'Rectangle', shortcut: 'R' },
  { id: 'circle', label: 'Circle', shortcut: 'C' },
  { id: 'line', label: 'Line', shortcut: 'L' },
  { id: 'text', label: 'Text', shortcut: 'T' },
  { id: 'sticky', label: 'Sticky Note', shortcut: 'S' },
  { id: 'connector', label: 'Connector', shortcut: 'X' },
  { id: 'frame', label: 'Frame', shortcut: 'F' },
  { id: 'laser', label: 'Laser Pointer', shortcut: 'G' },
];

/**
 * Final polish phase — logical groupings for the (now wider, labeled) toolbar, so related
 * tools read as a group instead of one undifferentiated column of icons. Purely a display
 * grouping: every id here must exist in TOOL_DEFS above, which stays the single source of
 * truth for each tool's own label/shortcut.
 */
export const TOOL_GROUPS = [
  { name: 'TOOLS', tools: ['select', 'path', 'eraser'] },
  { name: 'SHAPES', tools: ['rect', 'circle', 'line'] },
  { name: 'CONTENT', tools: ['text', 'sticky', 'connector', 'frame'] },
  { name: 'OTHER', tools: ['laser'] },
];
