import { generateHostIconDataUri } from './host-identicon';

export function updateHostFavicon(host = window.location.host) {
  const existing = document.querySelector<HTMLLinkElement>('link[rel~="icon"], link[rel="shortcut icon"]');
  if (existing) {
    return existing;
  }
  const link = document.createElement('link');

  link.type = 'image/svg+xml';
  link.rel = 'shortcut icon';
  link.href = generateHostIconDataUri(host);
  link.dataset.nodelHostFavicon = 'true';
  document.head.appendChild(link);

  return link;
}
