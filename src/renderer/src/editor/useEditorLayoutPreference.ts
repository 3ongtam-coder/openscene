import { useState } from 'react';

import {
  EDITOR_LAYOUT_DEFAULT_PREFERENCE,
  EDITOR_LAYOUT_STORAGE_KEY,
  parseEditorLayoutPreference,
  serializeEditorLayoutPreference,
  type EditorLayoutPreference
} from './editorLayoutPreferences';

type EditorLayoutPreferenceUpdater = (currentPreference: EditorLayoutPreference) => EditorLayoutPreference;

type UseEditorLayoutPreferenceResult = {
  readonly layoutPreference: EditorLayoutPreference;
  readonly updateLayoutPreference: (updater: EditorLayoutPreferenceUpdater) => void;
};

function isDomStorageError(error: unknown): boolean {
  return typeof DOMException !== 'undefined' && error instanceof DOMException;
}

function getStoredEditorLayoutPreference(): EditorLayoutPreference {
  if (typeof window === 'undefined') return EDITOR_LAYOUT_DEFAULT_PREFERENCE;

  try {
    return parseEditorLayoutPreference(window.localStorage.getItem(EDITOR_LAYOUT_STORAGE_KEY));
  } catch (error) {
    if (isDomStorageError(error)) return EDITOR_LAYOUT_DEFAULT_PREFERENCE;
    throw error;
  }
}

function persistEditorLayoutPreference(preference: EditorLayoutPreference): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(EDITOR_LAYOUT_STORAGE_KEY, serializeEditorLayoutPreference(preference));
  } catch (error) {
    if (!isDomStorageError(error)) throw error;
  }
}

export function useEditorLayoutPreference(): UseEditorLayoutPreferenceResult {
  const [layoutPreference, setLayoutPreference] = useState<EditorLayoutPreference>(() => getStoredEditorLayoutPreference());

  const updateLayoutPreference = (updater: EditorLayoutPreferenceUpdater): void => {
    setLayoutPreference((currentPreference) => {
      const nextPreference = updater(currentPreference);
      persistEditorLayoutPreference(nextPreference);
      return nextPreference;
    });
  };

  return { layoutPreference, updateLayoutPreference };
}
