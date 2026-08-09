const legacyHostPages: Readonly<Record<string, string>> = Object.freeze({
  diagnostics: '/diagnostics.xml',
  locals: '/locals.xml',
  network: '/nodes.xml'
});
const defaultLegacyHostPage = '/locals.xml';

export function legacyHostUiHref(hash: string) {
  const page = hash.replace(/^#/, '').toLowerCase();
  return legacyHostPages[page] ?? defaultLegacyHostPage;
}

export function bootstrapLegacyUiLinks(root: ParentNode = document, targetWindow: Window = window) {
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('[data-nodel-v1-link]'));
  if (links.length === 0) return () => undefined;

  const sync = () => {
    for (const link of links) {
      link.href = link.dataset.nodelV1Link === 'toolkit'
        ? '/toolkit.xml'
        : legacyHostUiHref(targetWindow.location.hash);
    }
  };

  sync();
  targetWindow.addEventListener('hashchange', sync);
  return () => targetWindow.removeEventListener('hashchange', sync);
}
