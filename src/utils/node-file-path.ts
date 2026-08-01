export const MAX_NODE_FILE_PATH_LENGTH = 1024;
const unsafePathCharacters = /[\u0000-\u001f\u007f]/;

export function isSafeNodeFilePath(path: string) {
  if (!path || path.length > MAX_NODE_FILE_PATH_LENGTH || path.startsWith('/') || path.includes('\\') || path.includes(':') || unsafePathCharacters.test(path)) {
    return false;
  }
  return path.split('/').every((segment) => Boolean(segment) && segment !== '.' && segment !== '..');
}

export function assertSafeNodeFilePath(path: string) {
  if (!isSafeNodeFilePath(path)) {
    throw new Error('Node file path is invalid');
  }
  return path;
}
