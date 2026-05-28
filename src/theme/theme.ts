export type NodelTheme = 'light' | 'dark';

export const DEFAULT_THEME: NodelTheme = 'light';
export const THEME_STORAGE_KEY = 'nodel.theme';

export function normalizeTheme(value: string | null | undefined): NodelTheme {
  return value === 'dark' ? 'dark' : 'light';
}

export function getSystemTheme(): NodelTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return DEFAULT_THEME;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getStoredTheme(): NodelTheme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

export function storeTheme(theme: NodelTheme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme persistence is best-effort; blocked storage should not break the UI.
  }
}

export function resolveTheme(value: string | null | undefined): NodelTheme {
  if (value === 'dark' || value === 'light') {
    return value;
  }

  return getStoredTheme() ?? getSystemTheme();
}
