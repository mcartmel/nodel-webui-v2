import { hasUnpairedSurrogate } from '../utils/urls';

export function networkNodeSearchHref(node: string) {
  if (!node || hasUnpairedSurrogate(node)) {
    return '';
  }

  try {
    // Search queries preserve valid names exactly and never substitute UTF-16.
    return `/nodes.html?filter=${encodeURIComponent(node)}#Network`;
  } catch {
    return '';
  }
}
