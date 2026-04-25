export type NodelTheme = 'light' | 'dark';

export const DEFAULT_THEME: NodelTheme = 'light';

export function normalizeTheme(value: string | null | undefined): NodelTheme {
  return value === 'dark' ? 'dark' : 'light';
}

export function resolveTheme(value: string | null | undefined): NodelTheme {
  return normalizeTheme(value);
}
