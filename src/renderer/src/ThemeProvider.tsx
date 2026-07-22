import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { parseThemePreference, resolveThemeMode, THEME_STORAGE_KEY, toggleThemeMode, type ThemeMode, type ThemePreference } from './theme';

const DARK_THEME_QUERY = '(prefers-color-scheme: dark)';

type ThemeContextValue = {
  readonly mode: ThemeMode;
  readonly preference: ThemePreference;
  readonly toggleTheme: () => void;
};

type ThemeProviderProps = {
  readonly children: ReactNode;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isDomStorageError(error: unknown): boolean {
  return typeof DOMException !== 'undefined' && error instanceof DOMException;
}

function getSystemThemeMode(): ThemeMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(DARK_THEME_QUERY).matches ? 'dark' : 'light';
}

function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';

  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch (error) {
    if (isDomStorageError(error)) return 'system';
    throw error;
  }
}

function persistThemePreference(preference: ThemeMode): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch (error) {
    if (!isDomStorageError(error)) throw error;
  }
}

function applyDocumentTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
}

export function bootstrapRendererTheme(): void {
  const preference = getStoredThemePreference();
  const systemMode = getSystemThemeMode();
  applyDocumentTheme(resolveThemeMode(preference, systemMode));
}

export function ThemeProvider({ children }: ThemeProviderProps): ReactElement {
  const [preference, setPreference] = useState<ThemePreference>(() => getStoredThemePreference());
  const [systemMode, setSystemMode] = useState<ThemeMode>(() => getSystemThemeMode());
  const mode = resolveThemeMode(preference, systemMode);

  useLayoutEffect(() => {
    applyDocumentTheme(mode);
  }, [mode]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const mediaQueryList = window.matchMedia(DARK_THEME_QUERY);
    const handleSystemThemeChange = (event: MediaQueryListEvent): void => {
      setSystemMode(event.matches ? 'dark' : 'light');
    };

    mediaQueryList.addEventListener('change', handleSystemThemeChange);
    return () => mediaQueryList.removeEventListener('change', handleSystemThemeChange);
  }, []);

  const toggleTheme = useCallback((): void => {
    setPreference((currentPreference) => {
      const nextMode = toggleThemeMode(resolveThemeMode(currentPreference, systemMode));
      persistThemePreference(nextMode);
      return nextMode;
    });
  }, [systemMode]);

  const value = useMemo<ThemeContextValue>(() => ({ mode, preference, toggleTheme }), [mode, preference, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error('useTheme must be used within ThemeProvider.');
  }
  return context;
}
