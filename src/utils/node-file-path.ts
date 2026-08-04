import { hasUnpairedSurrogate } from './urls';

export const MAX_NODE_FILE_PATH_LENGTH = 1024;
export const MAX_NODE_FILE_SEGMENT_LENGTH = 255;
const unsafePathCharacters = /[\u0000-\u001f\u007f-\u009f]/;
const ambiguousSeparators = /[\u2044\u2215\u29f8\uff0f\uff3c]/;
const reservedWindowsName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const windowsInvalidCharacters = /[<>"|?*]/;
const dotTraversalSegment = /(?:^|[\\/])\.\.?(?=$|[\\/])/;

export type NodePathCompatibility = 'portable' | 'legacy';

interface DecodedPathCapability {
  compatibility: NodePathCompatibility;
  path: string;
}

const decodedFileReadCapabilities = new WeakMap<object, Readonly<DecodedPathCapability>>();
const decodedRecipeCapabilities = new WeakMap<object, Readonly<DecodedPathCapability>>();

export function isSafeNodeFilePath(path: string) {
  if (!path
    || hasUnpairedSurrogate(path)
    || new TextEncoder().encode(path).byteLength > MAX_NODE_FILE_PATH_LENGTH
    || path.startsWith('/')
    || path.includes('\\')
    || path.includes(':')
    || unsafePathCharacters.test(path)) {
    return false;
  }
  return path.split('/').every((segment) => Boolean(segment) && segment !== '.' && segment !== '..');
}

/**
 * Java Nodel can list Unix file names which are not portable across hosts.
 * Keep their exact spelling, but never treat a path traversal or Windows root
 * form as a legacy file name.
 */
export function nodeFilePathCompatibility(path: string): NodePathCompatibility | null {
  if (!path
    || path.includes('\u0000')
    || path.startsWith('/')
    || path.startsWith('\\')
    || /^[A-Za-z]:/.test(path)
    || path.split('/').some((segment) => !segment)
    || dotTraversalSegment.test(path)) {
    return null;
  }
  return isPortableNodeFilePath(path) ? 'portable' : 'legacy';
}

export function nodeRecipePathCompatibility(path: string): NodePathCompatibility | null {
  if (path === '') {
    return 'portable';
  }
  return nodeFilePathCompatibility(path);
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

export function assertPortableNodeFilePath(path: string) {
  if (!isPortableNodeFilePath(path)) {
    throw new Error('Node file path is invalid or not portable');
  }
  return path;
}

export function canonicalNodeFilePath(path: string) {
  return assertSafeNodeFilePath(path);
}

export function portableNodeFilePathKey(path: string) {
  return assertPortableNodeFilePath(path).normalize('NFC').toUpperCase().toLowerCase();
}

/**
 * The host can list paths which cannot be created safely by this client. They
 * still participate in collision detection: a case-insensitive or
 * normalization-insensitive filesystem could otherwise overwrite one.
 */
export function nodeFileAliasKey(path: string) {
  if (!nodeFilePathCompatibility(path)) {
    return null;
  }
  return path.normalize('NFC').toUpperCase().toLowerCase();
}

function bindDecodedEntry<T extends { path: string; compatibility?: NodePathCompatibility }>(
  capabilities: WeakMap<object, Readonly<DecodedPathCapability>>,
  entry: T,
  compatibilityForPath: (path: string) => NodePathCompatibility | null
) {
  const compatibility = compatibilityForPath(entry.path);
  if (!compatibility || entry.compatibility !== compatibility) {
    throw new Error('Decoded path entry is invalid');
  }
  const binding = Object.freeze({ path: entry.path, compatibility });
  capabilities.set(entry, binding);
  return Object.freeze(entry);
}

function boundEntry(
  capabilities: WeakMap<object, Readonly<DecodedPathCapability>>,
  value: object,
  compatibilityForPath: (path: string) => NodePathCompatibility | null
) {
  const binding = capabilities.get(value);
  if (!binding || typeof (value as { path?: unknown }).path !== 'string' || !Object.isFrozen(value)) {
    return null;
  }
  const entry = value as { path: unknown; compatibility?: unknown };
  return entry.path === binding.path
    && entry.compatibility === binding.compatibility
    && compatibilityForPath(binding.path) === binding.compatibility
    ? binding
    : null;
}

/** Marks and freezes a decoded list entry as the capability required for legacy reads. */
export function registerDecodedNodeFileEntry<T extends { path: string; compatibility?: NodePathCompatibility }>(entry: T): Readonly<T> {
  return bindDecodedEntry(decodedFileReadCapabilities, entry, nodeFilePathCompatibility);
}

/** Preserves a read capability when the editor derives a list view object. */
export function copyNodeFileReadCapability<T extends { path: string; compatibility?: NodePathCompatibility }>(source: object, target: T): Readonly<T> {
  const registered = decodedFileReadCapabilities.get(source);
  if (!registered) {
    // Extension and test callers can still render unbound portable entries;
    // they do not gain a legacy read capability.
    return target;
  }
  const binding = boundEntry(decodedFileReadCapabilities, source, nodeFilePathCompatibility);
  if (!binding || target.path !== binding.path || target.compatibility !== binding.compatibility) {
    throw new Error('Node file read capability cannot be copied to a different path');
  }
  decodedFileReadCapabilities.set(target, binding);
  return Object.freeze(target);
}

export function isDecodedNodeFileReadCapability(value: object) {
  return boundEntry(decodedFileReadCapabilities, value, nodeFilePathCompatibility) !== null;
}

/** Marks and freezes an exact decoded recipe list entry. */
export function registerDecodedNodeRecipeEntry<T extends { path: string; compatibility?: NodePathCompatibility }>(entry: T): Readonly<T> {
  return bindDecodedEntry(decodedRecipeCapabilities, entry, nodeRecipePathCompatibility);
}

export function isDecodedNodeRecipeCapability(value: object) {
  return boundEntry(decodedRecipeCapabilities, value, nodeRecipePathCompatibility) !== null;
}

export function decodedNodeRecipePath(value: object) {
  return boundEntry(decodedRecipeCapabilities, value, nodeRecipePathCompatibility)?.path ?? null;
}

export function isLegacyNodeFileEntry(entry: { path: string; compatibility?: NodePathCompatibility }) {
  return entry.compatibility === 'legacy'
    || (entry.compatibility === undefined && nodeFilePathCompatibility(entry.path) === 'legacy');
}
