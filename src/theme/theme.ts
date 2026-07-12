export type NodelTheme = 'light' | 'dark';

export const DEFAULT_THEME: NodelTheme = 'light';
export const THEME_STORAGE_KEY = 'nodel.theme';
export const SYSTEM_THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export function isNodelTheme(value: string | null | undefined): value is NodelTheme {
  return value === 'light' || value === 'dark';
}

export function normalizeTheme(value: string | null | undefined): NodelTheme {
  return value === 'dark' ? 'dark' : 'light';
}

export function getSystemTheme(): NodelTheme {
  return getSystemThemeMediaQuery()?.matches ? 'dark' : 'light';
}

export function getSystemThemeMediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }

  try {
    return window.matchMedia(SYSTEM_THEME_MEDIA_QUERY);
  } catch {
    return null;
  }
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
  if (isNodelTheme(value)) {
    return value;
  }

  return getStoredTheme() ?? getSystemTheme();
}
