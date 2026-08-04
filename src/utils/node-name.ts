const javaLetterOrDigit = /[\p{L}\p{Nd}]/u;
const javaSpaceChar = /[\p{Zs}\p{Zl}\p{Zp}]/u;
const unsupportedNodeNameCodeUnit = /[\u0000-\u001f\u007f-\u009f]/;

export const NODE_NAME_MALFORMED_UTF16_ERROR = 'Node name must be well-formed UTF-16';
export const NODE_NAME_UNSUPPORTED_CHARACTER_ERROR = 'Node name cannot contain control or supplementary Unicode characters';
export const NODE_NAME_EMPTY_REDUCTION_ERROR = 'Node name must reduce to at least one path character';
export const NODE_NAME_VALIDATION_ERROR = 'Node name must be well-formed UTF-16, contain no control or supplementary Unicode characters, and reduce to at least one path character';

/** True when a string can be represented exactly as Unicode scalar values. */
export function isWellFormedUtf16(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      return false;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

export function assertWellFormedNodeName(name: string) {
  if (!isWellFormedUtf16(name)) {
    throw new Error(NODE_NAME_MALFORMED_UTF16_ERROR);
  }
  return name;
}

/** Java NodelHost cannot persist these names without changing their bytes. */
export function hasUnsupportedNodeNameCharacters(name: string) {
  if (unsupportedNodeNameCodeUnit.test(name)) {
    return true;
  }
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && name.charCodeAt(index + 1) >= 0xdc00 && name.charCodeAt(index + 1) <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Java String.trim() removes only code units at or below U+0020. */
export function trimNodeName(name: string) {
  return name.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
}

export function reduceNodeNameForPath(name: string): string {
  let reduced = '';
  let lastChar = '';
  let commentLevel = 0;

  for (let i = 0; i < name.length; i += 1) {
    const c = name.charAt(i);

    if (c === '(') {
      commentLevel += 1;
    } else if (commentLevel > 0) {
      if (c === ')') commentLevel -= 1;
    } else if ((c === '-' && lastChar === '-') || (c === '/' && lastChar === '/')) {
      break;
    // Nodel.reduce operates on Java chars, so supplementary characters are
    // considered as their individual UTF-16 code units here as well.
    } else if (javaLetterOrDigit.test(c)) {
      reduced += c;
    } else if (c.charCodeAt(0) > 127 && !javaSpaceChar.test(c)) {
      reduced += c;
    }

    lastChar = c;
  }

  return reduced;
}

export function isUsableNodeName(name: string) {
  return isWellFormedUtf16(name) && !hasUnsupportedNodeNameCharacters(name) && reduceNodeNameForPath(name) !== '';
}

export function assertUsableNodeName(name: string) {
  assertWellFormedNodeName(name);
  if (hasUnsupportedNodeNameCharacters(name)) {
    throw new Error(NODE_NAME_UNSUPPORTED_CHARACTER_ERROR);
  }
  if (!reduceNodeNameForPath(name)) {
    throw new Error(NODE_NAME_EMPTY_REDUCTION_ERROR);
  }
  return name;
}

export function nodeNameValidationError(name: string) {
  try {
    assertUsableNodeName(name);
    return '';
  } catch {
    return NODE_NAME_VALIDATION_ERROR;
  }
}

export function getSimpleName(name: string): string {
  const match = /^(.+?)(?:\(| \(|$)/i.exec(name);
  return match ? match[1] : name;
}

export function getNodePathName(pathname = window.location.pathname): string | null {
  const pathParts = pathname.split('/');
  const nodesIndex = pathParts.indexOf('nodes');
  const nodeName = nodesIndex >= 0 ? pathParts[nodesIndex + 1] : '';

  if (!nodeName) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(nodeName.replace(/\+/g, '%20'));
    return isWellFormedUtf16(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function getVerySimpleName(name: string): string {
  return reduceNodeNameForPath(name);
}

export function getHostFromAddress(address: string): string {
  try {
    return new URL(address, window.location.origin).host;
  } catch {
    return '';
  }
}

export function getCurrentHostOrigin(): string {
  return window.location.origin;
}
