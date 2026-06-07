import { createSignalBindingController } from '../data/signal-bindings';
import { generateHostIconDataUri } from '../icons/host-identicon';
import { escapeHtml } from '../utils/html';

export class NodelHostIcon extends HTMLElement {
  static observedAttributes = ['host', 'icon-host', 'href', 'title', 'alt', 'signal', 'signals'];

  private signalBindings = createSignalBindingController(this);

  connectedCallback() {
    this.render();
    this.syncSignalSubscription();
  }

  disconnectedCallback() {
    this.signalBindings.dispose();
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
      this.syncSignalSubscription();
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

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'host', {
      alt: (value) => this.setSignalAttribute('alt', value),
      host: (value) => this.setSignalAttribute('host', value),
      href: (value) => this.setSignalAttribute('href', value),
      'icon-host': (value) => this.setSignalAttribute('icon-host', value),
      title: (value) => this.setSignalAttribute('title', value)
    });
  }

  private setSignalAttribute(name: string, value: string) {
    if (value) {
      this.setAttribute(name, value);
    } else {
      this.removeAttribute(name);
    }
  }

}

if (!customElements.get('nodel-host-icon')) {
  customElements.define('nodel-host-icon', NodelHostIcon);
}
