export const THEME_STORAGE_KEY = 'window-loom-theme';

export type ThemeMode = 'light' | 'dark';
export type ThemePreference = ThemeMode | 'system';

export function parseThemePreference(storedTheme: string | null | undefined): ThemePreference {
  switch (storedTheme) {
    case 'light':
    case 'dark':
      return storedTheme;
    default:
      return 'system';
  }
}

export function resolveThemeMode(preference: ThemePreference, systemMode: ThemeMode): ThemeMode {
  switch (preference) {
    case 'light':
    case 'dark':
      return preference;
    case 'system':
      return systemMode;
  }
}

export function toggleThemeMode(mode: ThemeMode): ThemeMode {
  switch (mode) {
    case 'light':
      return 'dark';
    case 'dark':
      return 'light';
  }
}

export function shouldToggleThemeOnSwitchKeyDown(key: string): boolean {
  return key === ' ' || key === 'Spacebar';
}
