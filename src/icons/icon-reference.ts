import type { IconLibrary } from './icon-artifact';

export interface IconReference {
  valid: boolean;
  library: IconLibrary;
  name: string;
  prefixed: boolean;
}

export interface IconReferenceSelection {
  library: IconLibrary;
  family: string;
  style: string;
}

const canonicalName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Parse the public icon syntax without attempting cross-library fallback. */
export function parseIconReference(value: string): IconReference {
  const authored = value.trim();
  if (authored.startsWith('mdi:')) {
    const name = authored.slice(4);
    return { valid: canonicalName.test(name), library: 'mdi', name, prefixed: true };
  }
  if (authored.includes(':')) return { valid: false, library: 'fontawesome', name: authored, prefixed: false };
  return { valid: canonicalName.test(authored), library: 'fontawesome', name: authored, prefixed: false };
}

/** MDI's namespace controls selection; legacy family/style apply only to FA. */
export function selectIconReference(reference: IconReference, family?: string, style?: string): IconReferenceSelection | null {
  if (!reference.valid) return null;
  if (reference.library === 'mdi') return { library: 'mdi', family: 'mdi', style: 'default' };
  const selectedFamily = family || 'classic';
  // An empty style remains unresolved until the manifest supplies the default.
  const selectedStyle = style || '';
  return { library: 'fontawesome', family: selectedFamily, style: selectedStyle };
}

/** Apply manifest aliases only inside their declared library namespace. */
export function resolveIconReferenceName(reference: IconReference, aliases: Record<string, string>): string {
  return reference.library === 'fontawesome' ? aliases[reference.name] ?? reference.name : reference.name;
}

/** Convert a canonical catalogue row to the name authors should insert. */
export function formatIconReference(library: IconLibrary, name: string): string {
  return library === 'mdi' ? `mdi:${name}` : name;
}
