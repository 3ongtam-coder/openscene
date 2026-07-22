import { useState } from 'react';

import {
  EDITOR_SHORTCUT_DEFAULT_PREFERENCES,
  EDITOR_SHORTCUT_STORAGE_KEY,
  parseEditorShortcutPreferences,
  serializeEditorShortcutPreferences,
  type EditorShortcutPreferences
} from './editorShortcuts';

type EditorShortcutPreferenceUpdater = (currentPreference: EditorShortcutPreferences) => EditorShortcutPreferences;

type UseEditorShortcutPreferenceResult = {
  readonly shortcutPreferences: EditorShortcutPreferences;
  readonly updateShortcutPreferences: (updater: EditorShortcutPreferenceUpdater) => void;
};

function isDomStorageError(error: unknown): boolean {
  return typeof DOMException !== 'undefined' && error instanceof DOMException;
}

function getStoredEditorShortcutPreferences(): EditorShortcutPreferences {
  if (typeof window === 'undefined') return EDITOR_SHORTCUT_DEFAULT_PREFERENCES;

  try {
    return parseEditorShortcutPreferences(window.localStorage.getItem(EDITOR_SHORTCUT_STORAGE_KEY));
  } catch (error) {
    if (isDomStorageError(error)) return EDITOR_SHORTCUT_DEFAULT_PREFERENCES;
    throw error;
  }
}

function persistEditorShortcutPreferences(preferences: EditorShortcutPreferences): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(EDITOR_SHORTCUT_STORAGE_KEY, serializeEditorShortcutPreferences(preferences));
  } catch (error) {
    if (!isDomStorageError(error)) throw error;
  }
}

export function useEditorShortcutPreference(): UseEditorShortcutPreferenceResult {
  const [shortcutPreferences, setShortcutPreferences] = useState<EditorShortcutPreferences>(() => getStoredEditorShortcutPreferences());

  const updateShortcutPreferences = (updater: EditorShortcutPreferenceUpdater): void => {
    setShortcutPreferences((currentPreference) => {
      const nextPreference = updater(currentPreference);
      persistEditorShortcutPreferences(nextPreference);
      return nextPreference;
    });
  };

  return { shortcutPreferences, updateShortcutPreferences };
}
