export function networkNodeSearchHref(node: string) {
  return `/nodes.html?filter=${encodeURIComponent(node.trim())}#Network`;
}
