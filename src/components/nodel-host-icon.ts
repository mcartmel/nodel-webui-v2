import { generateHostIconDataUri } from '../icons/host-identicon';
import { escapeHtml } from '../utils/html';

export class NodelHostIcon extends HTMLElement {
  static observedAttributes = ['host', 'icon-host', 'href', 'title', 'alt'];

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
    }
  }

  private render() {
    const host = this.getAttribute('host') ?? window.location.host;
    const iconHost = this.getAttribute('icon-host') ?? host;
    const href = this.getAttribute('href');
    const title = this.getAttribute('title') ?? (href ? 'Browse this host' : host);
    const alt = this.getAttribute('alt') ?? host;
    const src = generateHostIconDataUri(iconHost);
    const image = `<img class="nodel-host-icon-image" src="${src}" alt="${escapeHtml(alt)}" title="${escapeHtml(title)}" />`;

    this.innerHTML = href
      ? `<a class="nodel-host-icon-link" href="${escapeHtml(href)}" title="${escapeHtml(title)}">${image}</a>`
      : image;
  }
}

if (!customElements.get('nodel-host-icon')) {
  customElements.define('nodel-host-icon', NodelHostIcon);
}
