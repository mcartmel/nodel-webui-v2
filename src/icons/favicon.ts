import { generateHostIconDataUri } from './host-identicon';

export function updateHostFavicon(host = window.location.host) {
  const href = generateHostIconDataUri(host);
  const existing = document.querySelector<HTMLLinkElement>('link[rel~="icon"], link[rel="shortcut icon"]');
  const link = existing ?? document.createElement('link');

  link.type = 'image/svg+xml';
  link.rel = 'shortcut icon';
  link.href = href;

  if (!existing) {
    document.head.appendChild(link);
  }

  return link;
}
