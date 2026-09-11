import { useToolStore } from '../store/useToolStore.js';
import { useDevStore } from '../store/useDevStore.js';
import { useHistoryStore } from '../store/useHistoryStore.js';
import { useCanvasSettingsStore } from '../store/useCanvasSettingsStore.js';
import { TOOL_DEFS } from '../canvas/tools/toolDefs.js';
import { ROTATABLE_TYPES } from '../canvas/geometry/rotation.js';

/**
 * Single source of truth for every editor action — the Command Palette (Ctrl/Cmd+K), the
 * right-click Context Menu, and the toolbar/keyboard shortcuts all read from this same
 * list instead of each hardcoding their own copy of "what duplicate does" (Phase 8 #33).
 * Built fresh each time it's needed (palette open, context menu open) so `enabled` always
 * reflects the current selection — commands the spec calls for disabling are filtered out
 * entirely rather than shown greyed-out ("disable/hide intelligently", #34).
 *
 * @param {object} ctx
 * @param {import('../canvas/engine/CanvasEngine.js').CanvasEngine} ctx.engine
 * @param {{requestUndo, requestRedo}} ctx.connection - thin wrappers around RoomConnection calls
 * @param {object} ctx.actions - Room.jsx's existing handlers (export/save/clear/etc.)
 * @returns {Array<{id, label, shortcut?, group, execute, enabled}>}
 */
export function buildCommands({ engine, connection, actions }) {
  const selectedIds = [...engine.selectedObjectIds];
  const selectionSize = selectedIds.length;
  const hasSelection = selectionSize > 0;
  const hasMultiSelection = selectionSize >= 2;
  const canDistribute = selectionSize >= 3;
  const isGrouped = engine.getSelectedObjects().some((o) => !!o.groupId);
  const hasClipboard = engine.clipboard.length > 0;
  const singleLockedSelection = selectionSize === 1 && engine.isLockedByOther(selectedIds[0]);
  const hasRotatableSelection = engine.getSelectedObjects().some((o) => ROTATABLE_TYPES.has(o.type));
  const selectedObject = engine.getSelectedObject();
  const singleSelectedConnector = selectedObject?.type === 'connector';
  const settingsState = useCanvasSettingsStore.getState();
  // Phase 9: none of the mutating editor commands below make sense to fire while
  // previewing historical state — same guard useKeyboardShortcuts applies.
  const editingAllowed = !engine.isReplaying();
  const historyState = useHistoryStore.getState();

  const toolCommands = TOOL_DEFS.map((def) => ({
    id: `tool-${def.id}`,
    label: def.label,
    shortcut: def.shortcut,
    group: 'Tools',
    execute: () => useToolStore.getState().setTool(def.id),
    enabled: true,
  }));

  const reorder = (op) => engine.requestReorder(selectedIds, op);

  const all = [
    ...toolCommands,

    { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', group: 'Edit', execute: connection.requestUndo, enabled: editingAllowed },
    { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z', group: 'Edit', execute: connection.requestRedo, enabled: editingAllowed },
    { id: 'select-all', label: 'Select All', shortcut: 'Ctrl+A', group: 'Edit', execute: () => engine.selectAll(), enabled: editingAllowed && engine.objects.size > 0 },
    { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C', group: 'Edit', execute: () => engine.copySelectionToClipboard(), enabled: editingAllowed && hasSelection },
    { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', group: 'Edit', execute: () => engine.pasteFromClipboard(), enabled: editingAllowed && hasClipboard },
    { id: 'duplicate', label: 'Duplicate', shortcut: 'Ctrl+D', group: 'Edit', execute: () => engine.duplicateSelection(), enabled: editingAllowed && hasSelection },
    { id: 'delete', label: 'Delete Selected', shortcut: 'Delete', group: 'Edit', execute: () => engine.deleteSelection(), enabled: editingAllowed && hasSelection },

    // Phase 10: only surfaced when it actually means something — a single selected
    // object someone else currently holds the lock on (see LockBanner for the same
    // affordance shown inline, right next to the object itself).
    { id: 'request-control', label: 'Request Control', group: 'Edit', execute: () => actions.requestControl?.(selectedIds[0]), enabled: editingAllowed && singleLockedSelection },

    { id: 'group', label: 'Group Selected', shortcut: 'Ctrl+G', group: 'Organize', execute: () => engine.groupSelection(), enabled: editingAllowed && hasMultiSelection },
    { id: 'ungroup', label: 'Ungroup', shortcut: 'Ctrl+Shift+G', group: 'Organize', execute: () => engine.ungroupSelection(), enabled: editingAllowed && isGrouped },

    { id: 'align-left', label: 'Align Left', group: 'Align', execute: () => engine.alignSelection('left'), enabled: editingAllowed && hasMultiSelection },
    { id: 'align-center-h', label: 'Align Center Horizontally', group: 'Align', execute: () => engine.alignSelection('center-h'), enabled: editingAllowed && hasMultiSelection },
    { id: 'align-right', label: 'Align Right', group: 'Align', execute: () => engine.alignSelection('right'), enabled: editingAllowed && hasMultiSelection },
    { id: 'align-top', label: 'Align Top', group: 'Align', execute: () => engine.alignSelection('top'), enabled: editingAllowed && hasMultiSelection },
    { id: 'align-center-v', label: 'Align Center Vertically', group: 'Align', execute: () => engine.alignSelection('center-v'), enabled: editingAllowed && hasMultiSelection },
    { id: 'align-bottom', label: 'Align Bottom', group: 'Align', execute: () => engine.alignSelection('bottom'), enabled: editingAllowed && hasMultiSelection },
    { id: 'distribute-h', label: 'Distribute Horizontally', group: 'Align', execute: () => engine.distributeSelection('horizontal'), enabled: editingAllowed && canDistribute },
    { id: 'distribute-v', label: 'Distribute Vertically', group: 'Align', execute: () => engine.distributeSelection('vertical'), enabled: editingAllowed && canDistribute },

    { id: 'bring-to-front', label: 'Bring to Front', group: 'Layer', execute: () => reorder('front'), enabled: editingAllowed && hasSelection },
    { id: 'bring-forward', label: 'Bring Forward', group: 'Layer', execute: () => reorder('forward'), enabled: editingAllowed && hasSelection },
    { id: 'send-backward', label: 'Send Backward', group: 'Layer', execute: () => reorder('backward'), enabled: editingAllowed && hasSelection },
    { id: 'send-to-back', label: 'Send to Back', group: 'Layer', execute: () => reorder('back'), enabled: editingAllowed && hasSelection },

    { id: 'toggle-dark-mode', label: 'Toggle Dark Mode', group: 'View', execute: actions.toggleTheme, enabled: true },
    { id: 'fit-to-content', label: 'Fit to Content', group: 'View', execute: () => engine.fitToScreen(), enabled: true },
    { id: 'reset-view', label: 'Reset View', group: 'View', execute: () => engine.resetView(), enabled: true },
    { id: 'toggle-layers', label: 'Layers Panel', group: 'View', execute: actions.toggleLayers, enabled: true },
    { id: 'toggle-hud', label: 'Performance HUD', group: 'Dev', execute: () => useDevStore.getState().toggleHud(), enabled: true },

    { id: 'export-png', label: 'Export PNG', group: 'File', execute: actions.exportPng, enabled: true },
    { id: 'export-json', label: 'Export SyncCanvas File', shortcut: 'Ctrl+S', group: 'File', execute: actions.exportJson, enabled: true },
    { id: 'save-snapshot', label: 'Save Snapshot', shortcut: 'Ctrl+Shift+S', group: 'File', execute: actions.saveSnapshot, enabled: true },
    { id: 'clear-canvas', label: 'Clear Canvas', group: 'File', execute: actions.clearCanvas, enabled: editingAllowed },

    // ---- Phase 9: session replay / timeline / time travel ----
    { id: 'open-history', label: 'Open History', shortcut: 'Shift+R', group: 'History', execute: actions.toggleHistory, enabled: true },
    { id: 'return-to-live', label: 'Return to Live', group: 'History', execute: actions.returnToLive, enabled: historyState.isReplaying },
    {
      id: 'toggle-replay-playback',
      label: historyState.isPlaying ? 'Pause Replay' : 'Play Replay',
      group: 'History',
      execute: () => useHistoryStore.getState().setPlaying(!useHistoryStore.getState().isPlaying),
      enabled: historyState.panelOpen && historyState.operations.length > 0,
    },
    {
      id: 'create-checkpoint',
      label: 'Create Checkpoint',
      group: 'History',
      execute: () => useHistoryStore.getState().openCheckpointDialog(),
      enabled: true,
    },
    {
      id: 'restore-version',
      label: 'Restore Historical Version',
      group: 'History',
      execute: () => useHistoryStore.getState().openRestoreConfirm(),
      enabled: historyState.isReplaying && historyState.currentSequence !== historyState.latestSequence,
    },

    // ---- Phase 11: smart canvas & precision tools ----
    { id: 'toggle-grid', label: settingsState.gridEnabled ? 'Hide Grid' : 'Show Grid', group: 'Canvas', execute: () => useCanvasSettingsStore.getState().toggleGrid(), enabled: true },
    { id: 'toggle-snap-to-grid', label: settingsState.snapToGridEnabled ? 'Disable Snap to Grid' : 'Enable Snap to Grid', group: 'Canvas', execute: () => useCanvasSettingsStore.getState().toggleSnapToGrid(), enabled: true },
    { id: 'toggle-smart-guides', label: settingsState.smartGuidesEnabled ? 'Disable Smart Guides' : 'Enable Smart Guides', group: 'Canvas', execute: () => useCanvasSettingsStore.getState().toggleSmartGuides(), enabled: true },
    { id: 'toggle-rulers', label: settingsState.rulersEnabled ? 'Hide Rulers' : 'Show Rulers', group: 'Canvas', execute: () => useCanvasSettingsStore.getState().toggleRulers(), enabled: true },
    { id: 'rotate-90-cw', label: 'Rotate 90° Clockwise', group: 'Transform', execute: () => engine.rotateSelectionBy(90), enabled: editingAllowed && hasRotatableSelection },
    { id: 'rotate-90-ccw', label: 'Rotate 90° Counterclockwise', group: 'Transform', execute: () => engine.rotateSelectionBy(-90), enabled: editingAllowed && hasRotatableSelection },
    { id: 'reset-rotation', label: 'Reset Rotation', group: 'Transform', execute: () => engine.resetSelectionRotation(), enabled: editingAllowed && hasRotatableSelection },

    // ---- Phase 12: smart diagramming & connectors ----
    {
      id: 'toggle-connector-routing',
      label: selectedObject?.routing === 'elbow' ? 'Use Straight Routing' : 'Use Elbow Routing',
      group: 'Connector',
      execute: () => engine.toggleConnectorRouting(),
      enabled: editingAllowed && singleSelectedConnector && !engine.isLockedByOther(selectedObject.id),
    },
  ];

  return all.filter((c) => c.enabled);
}

/** The curated subset shown on right-click (Part J's exact example) — every one of these
 *  ids must exist in buildCommands' output above. */
export const CONTEXT_MENU_LAYOUT = [
  ['request-control'],
  ['duplicate'],
  ['copy', 'paste'],
  ['bring-to-front', 'bring-forward', 'send-backward', 'send-to-back'],
  ['group', 'ungroup'],
  ['rotate-90-cw', 'rotate-90-ccw', 'reset-rotation'],
  ['toggle-connector-routing'],
  ['delete'],
];
