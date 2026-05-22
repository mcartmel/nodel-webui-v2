export const allowedTextExtensions = ['py', 'xml', 'xsl', 'js', 'json', 'html', 'htm', 'css', 'java', 'groovy', 'sql', 'sh', 'cs', 'bat', 'ini', 'txt', 'md', 'cmd'] as const;
export const allowedBinaryExtensions = ['png', 'jpg', 'ico', 'svg', 'zip', '7z', 'exe'] as const;

const textExtensionSet = new Set<string>(allowedTextExtensions);
const binaryExtensionSet = new Set<string>(allowedBinaryExtensions);

export type EditorLanguageKind = 'python' | 'html' | 'xml' | 'javascript' | 'json' | 'css' | 'markdown' | 'plain';

export function getFileExtension(path: string) {
  const name = path.split('/').pop() ?? '';
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

export function isTextFile(path: string) {
  return textExtensionSet.has(getFileExtension(path));
}

export function isBinaryFile(path: string) {
  return binaryExtensionSet.has(getFileExtension(path));
}

export function isEditableFile(path: string) {
  return isTextFile(path);
}

export function validateNodeFilePath(path: string) {
  const trimmed = path.trim();
  if (!trimmed) {
    return 'File path is required.';
  }

  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    return 'File path must be relative.';
  }

  if (trimmed.includes('\\')) {
    return 'File path must use forward slashes.';
  }

  if (trimmed.split('/').some((part) => part === '..' || part === '')) {
    return 'File path cannot contain empty or parent-directory segments.';
  }

  if (!isTextFile(trimmed) && !isBinaryFile(trimmed)) {
    return `File extension must be one of: ${[...allowedTextExtensions, ...allowedBinaryExtensions].join(', ')}.`;
  }

  return '';
}

export function languageKindForPath(path: string): EditorLanguageKind {
  switch (getFileExtension(path)) {
    case 'py':
      return 'python';
    case 'html':
    case 'htm':
      return 'html';
    case 'xml':
    case 'xsl':
      return 'xml';
    case 'js':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'md':
      return 'markdown';
    default:
      return 'plain';
  }
}
