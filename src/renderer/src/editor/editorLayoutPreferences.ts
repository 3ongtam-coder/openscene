import {
  clampEditorInspectorWidth,
  clampEditorLeftDockWidth,
  clampEditorProgramPercent,
  bringEditorFloatingPanelToFront,
  EDITOR_FLOATING_PANEL_IDS,
  EDITOR_INSPECTOR_PLACEMENTS,
  EDITOR_LAYOUT_ARROW_STEP_PERCENT,
  EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH,
  EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH,
  EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS,
  EDITOR_LAYOUT_FLOATING_PRESETS,
  EDITOR_LAYOUT_DEFAULT_PREFERENCE,
  EDITOR_LAYOUT_MAX_INSPECTOR_WIDTH,
  EDITOR_LAYOUT_MAX_LEFT_DOCK_WIDTH,
  EDITOR_LAYOUT_MAX_PROGRAM_PERCENT,
  EDITOR_LAYOUT_MIN_INSPECTOR_WIDTH,
  EDITOR_LAYOUT_MIN_LEFT_DOCK_WIDTH,
  EDITOR_LAYOUT_MIN_PROGRAM_PERCENT,
  EDITOR_LAYOUT_SCHEMA_VERSION,
  EDITOR_LAYOUT_SIDEBAR_ARROW_STEP,
  EDITOR_LAYOUT_SIDEBAR_SHIFT_STEP,
  EDITOR_LAYOUT_SHIFT_STEP_PERCENT,
  expandEditorLayoutPreference,
  flattenEditorPanelLayout,
  getEditorFloatingPanelAfterKeyboardMove,
  moveEditorFloatingPanel,
  parseEditorPanelLayout,
  serializeEditorPanelLayout,
  setEditorFloatingPanelMode,
  setEditorFloatingPanels,
  type EditorFloatingPanel,
  type EditorFloatingPanelId,
  type EditorFloatingPanels,
  type EditorFloatingPresetId,
  type EditorInspectorPlacement,
  type EditorLayoutPreference
} from './editorPanelLayout';

export const EDITOR_LAYOUT_STORAGE_KEY = 'window-loom-editor-layout';

export {
  clampEditorInspectorWidth,
  clampEditorLeftDockWidth,
  clampEditorProgramPercent,
  bringEditorFloatingPanelToFront,
  EDITOR_FLOATING_PANEL_IDS,
  EDITOR_INSPECTOR_PLACEMENTS,
  EDITOR_LAYOUT_ARROW_STEP_PERCENT,
  EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH,
  EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH,
  EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS,
  EDITOR_LAYOUT_FLOATING_PRESETS,
  EDITOR_LAYOUT_DEFAULT_PREFERENCE,
  EDITOR_LAYOUT_MAX_INSPECTOR_WIDTH,
  EDITOR_LAYOUT_MAX_LEFT_DOCK_WIDTH,
  EDITOR_LAYOUT_MAX_PROGRAM_PERCENT,
  EDITOR_LAYOUT_MIN_INSPECTOR_WIDTH,
  EDITOR_LAYOUT_MIN_LEFT_DOCK_WIDTH,
  EDITOR_LAYOUT_MIN_PROGRAM_PERCENT,
  EDITOR_LAYOUT_SCHEMA_VERSION,
  EDITOR_LAYOUT_SHIFT_STEP_PERCENT,
  getEditorFloatingPanelAfterKeyboardMove,
  moveEditorFloatingPanel,
  setEditorFloatingPanelMode,
  setEditorFloatingPanels,
  EDITOR_LAYOUT_SIDEBAR_ARROW_STEP,
  EDITOR_LAYOUT_SIDEBAR_SHIFT_STEP
};

export type { EditorFloatingPanel, EditorFloatingPanelId, EditorFloatingPanels, EditorFloatingPresetId, EditorInspectorPlacement, EditorLayoutPreference };

export type EditorProgramResizeKeyInput = {
  readonly currentPercent: number;
  readonly key: string;
  readonly shiftKey: boolean;
};

export type EditorSidebarResizeSide = 'left-dock' | 'inspector-left' | 'inspector-right';

export type EditorSidebarResizeKeyInput = {
  readonly currentWidth: number;
  readonly key: string;
  readonly shiftKey: boolean;
  readonly side: EditorSidebarResizeSide;
};

export function parseEditorLayoutPreference(storedPreference: string | null | undefined): EditorLayoutPreference {
  return flattenEditorPanelLayout(parseEditorPanelLayout(storedPreference));
}

export function serializeEditorLayoutPreference(preference: EditorLayoutPreference): string {
  return serializeEditorPanelLayout(expandEditorLayoutPreference(preference));
}

export function resetEditorLayoutPreference(): EditorLayoutPreference {
  return EDITOR_LAYOUT_DEFAULT_PREFERENCE;
}

export function toggleEditorLeftDock(preference: EditorLayoutPreference): EditorLayoutPreference {
  return { ...preference, leftDockVisible: !preference.leftDockVisible };
}

export function toggleEditorInspector(preference: EditorLayoutPreference): EditorLayoutPreference {
  return { ...preference, inspectorVisible: !preference.inspectorVisible };
}

export function setEditorInspectorPlacement(preference: EditorLayoutPreference, inspectorPlacement: EditorInspectorPlacement): EditorLayoutPreference {
  return setEditorFloatingPanelMode(
    { ...preference, inspectorPlacement, inspectorVisible: true },
    'inspector',
    inspectorPlacement === 'floating'
  );
}

export function getNextEditorSidebarWidthFromKey({ currentWidth, key, shiftKey, side }: EditorSidebarResizeKeyInput): number | null {
  const step = shiftKey ? EDITOR_LAYOUT_SIDEBAR_SHIFT_STEP : EDITOR_LAYOUT_SIDEBAR_ARROW_STEP;
  const clampWidth = side === 'left-dock' ? clampEditorLeftDockWidth : clampEditorInspectorWidth;
  const defaultWidth = side === 'left-dock' ? EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH : EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH;
  const direction = side === 'inspector-right' ? -1 : 1;

  switch (key) {
    case 'ArrowLeft':
      return clampWidth(currentWidth - step * direction);
    case 'ArrowRight':
      return clampWidth(currentWidth + step * direction);
    case 'Home':
      return side === 'left-dock' ? EDITOR_LAYOUT_MIN_LEFT_DOCK_WIDTH : EDITOR_LAYOUT_MIN_INSPECTOR_WIDTH;
    case 'End':
      return side === 'left-dock' ? EDITOR_LAYOUT_MAX_LEFT_DOCK_WIDTH : EDITOR_LAYOUT_MAX_INSPECTOR_WIDTH;
    case 'Enter':
      return defaultWidth;
    default:
      return null;
  }
}

export function getNextEditorProgramPercentFromKey({ currentPercent, key, shiftKey }: EditorProgramResizeKeyInput): number | null {
  const step = shiftKey ? EDITOR_LAYOUT_SHIFT_STEP_PERCENT : EDITOR_LAYOUT_ARROW_STEP_PERCENT;

  switch (key) {
    case 'ArrowUp':
      return clampEditorProgramPercent(currentPercent - step);
    case 'ArrowDown':
      return clampEditorProgramPercent(currentPercent + step);
    case 'Home':
      return EDITOR_LAYOUT_MIN_PROGRAM_PERCENT;
    case 'End':
      return EDITOR_LAYOUT_MAX_PROGRAM_PERCENT;
    case 'Enter':
      return EDITOR_LAYOUT_DEFAULT_PREFERENCE.programPercent;
    default:
      return null;
  }
}
