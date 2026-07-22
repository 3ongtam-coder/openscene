import type { TimelineMenuState } from '../../../shared/timelineMenuCommands';
import type { EditorLayoutPreference } from './editorLayoutPreferences';

export type EditorNativeMenuStateInput = {
  readonly canRedoTimeline: boolean;
  readonly canSplitAtPlayhead: boolean;
  readonly canUndoTimeline: boolean;
  readonly hasProject: boolean;
  readonly hasUnsavedTimeline: boolean;
  readonly isBusy: boolean;
  readonly isPlaying: boolean;
  readonly layoutPreference: EditorLayoutPreference;
};

function commandState(enabled: boolean, checked = false) {
  return { enabled, checked } as const;
}

export function getEditorNativeMenuState(input: EditorNativeMenuStateInput): TimelineMenuState {
  const layout = input.layoutPreference;
  const inspectorVisible = layout.inspectorVisible;
  return {
    playPauseLabel: input.isPlaying ? 'Pause' : 'Play',
    commands: {
      playPause: commandState(input.hasProject),
      rewind: commandState(input.hasProject),
      undo: commandState(input.canUndoTimeline),
      redo: commandState(input.canRedoTimeline),
      splitAtPlayhead: commandState(input.canSplitAtPlayhead),
      addVideoTrack: commandState(input.hasProject),
      addAudioTrack: commandState(input.hasProject),
      toggleLeftDock: commandState(true, layout.leftDockVisible),
      toggleInspector: commandState(true, inspectorVisible),
      setInspectorLeft: commandState(true, inspectorVisible && layout.inspectorPlacement === 'left'),
      setInspectorRight: commandState(true, inspectorVisible && layout.inspectorPlacement === 'right'),
      setInspectorFloating: commandState(true, inspectorVisible && layout.inspectorPlacement === 'floating'),
      toggleProjectFloating: commandState(true, layout.floatingPanels.project.floating),
      toggleProgramFloating: commandState(true, layout.floatingPanels.program.floating),
      toggleInspectorFloating: commandState(true, layout.floatingPanels.inspector.floating),
      toggleExportFloating: commandState(true, layout.floatingPanels.export.floating),
      applyCompactReviewPreset: commandState(true),
      applyReviewDeckPreset: commandState(true),
      resetLayout: commandState(true),
      saveTimeline: commandState(input.hasProject && input.hasUnsavedTimeline && !input.isBusy)
    }
  };
}
