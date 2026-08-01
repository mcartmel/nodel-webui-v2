export const MAX_NODE_FILE_PATH_LENGTH = 1024;
export const MAX_NODE_FILE_SEGMENT_LENGTH = 255;
const unsafePathCharacters = /[\u0000-\u001f\u007f-\u009f]/;
const ambiguousSeparators = /[\u2044\u2215\u29f8\uff0f\uff3c]/;
const reservedWindowsName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const windowsInvalidCharacters = /[<>"|?*]/;

export function isSafeNodeFilePath(path: string) {
  if (!path
    || new TextEncoder().encode(path).byteLength > MAX_NODE_FILE_PATH_LENGTH
    || path.startsWith('/')
    || path.includes('\\')
    || path.includes(':')
    || unsafePathCharacters.test(path)) {
    return false;
  }
  return path.split('/').every((segment) => Boolean(segment) && segment !== '.' && segment !== '..');
}

export function isPortableNodeFilePath(path: string) {
  return isSafeNodeFilePath(path)
    && path === path.trim()
    && path === path.normalize('NFC')
    && !ambiguousSeparators.test(path)
    && path.split('/').every((segment) => (
      new TextEncoder().encode(segment).byteLength <= MAX_NODE_FILE_SEGMENT_LENGTH
      && !/[. ]$/.test(segment)
      && !reservedWindowsName.test(segment)
      && !windowsInvalidCharacters.test(segment)
    ));
}

export function assertSafeNodeFilePath(path: string) {
  if (!isSafeNodeFilePath(path)) {
    throw new Error('Node file path is invalid');
  }
  return path;
}

export function canonicalNodeFilePath(path: string) {
  return assertSafeNodeFilePath(path);
}

export function portableNodeFilePathKey(path: string) {
  return canonicalNodeFilePath(path).normalize('NFC').toUpperCase().toLowerCase();
}
