export function asciiToken(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

export function unicodeSearchKey(value: string) {
  return Array.from(value.normalize('NFKD').toLowerCase())
    .filter((character) => /[\p{L}\p{N}]/u.test(character))
    .join('');
}

export function codePoints(value: string) {
  return Array.from(value);
}
