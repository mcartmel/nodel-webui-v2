import { createSignalBindingController } from '../data/signal-bindings';
import { escapeHtml } from '../utils/html';

type NodelImageFit = 'contain' | 'cover';
type NodelImageShape = 'none' | 'rounded' | 'circle';
type NodelImageSize = 'auto' | 'sm' | 'md' | 'lg' | 'xl';
type NodelImageVariant = 'plain' | 'soft' | 'bordered';

function normalizeFit(value: string | null): NodelImageFit {
  return value === 'cover' ? 'cover' : 'contain';
}

function normalizeShape(value: string | null): NodelImageShape {
  return value === 'none' || value === 'circle' ? value : 'rounded';
}

function normalizeSize(value: string | null): NodelImageSize {
  return value === 'sm' || value === 'md' || value === 'lg' || value === 'xl' ? value : 'auto';
}

function normalizeVariant(value: string | null): NodelImageVariant {
  return value === 'soft' || value === 'bordered' ? value : 'plain';
}

export class NodelImage extends HTMLElement {
  static observedAttributes = ['src', 'alt', 'label', 'aria-label', 'aria-labelledby', 'fit', 'shape', 'size', 'variant', 'signal', 'signals'];

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
    const src = this.getAttribute('src') ?? '';
    const alt = this.getAttribute('alt') ?? '';
    const label = this.getAttribute('label') ?? '';
    const fit = normalizeFit(this.getAttribute('fit'));
    const shape = normalizeShape(this.getAttribute('shape'));
    const size = normalizeSize(this.getAttribute('size'));
    const variant = normalizeVariant(this.getAttribute('variant'));
    const autoAria = this.getAttribute('data-nodel-auto-aria-label') === 'true';
    const explicitAria = autoAria ? null : this.getAttribute('aria-label');
    const hostLabel = explicitAria ?? label;
    const hostLabelled = Boolean(hostLabel || this.getAttribute('aria-labelledby'));

    this.dataset.fit = fit;
    this.dataset.shape = shape;
    this.dataset.size = size;
    this.dataset.variant = variant;

    if (this.hasAttribute('aria-labelledby')) {
      this.setAttribute('role', 'img');
      if (this.hasAttribute('aria-label')) {
        this.removeAttribute('aria-label');
      }
      this.removeAttribute('data-nodel-auto-aria-label');
    } else if (hostLabel) {
      this.setAttribute('role', 'img');
      if (!explicitAria) {
        this.setAttribute('data-nodel-auto-aria-label', 'true');
      }
      if (this.getAttribute('aria-label') !== hostLabel) {
        this.setAttribute('aria-label', hostLabel);
      }
    } else {
      this.removeAttribute('role');
      if (this.hasAttribute('aria-label')) {
        this.removeAttribute('aria-label');
      }
      this.removeAttribute('data-nodel-auto-aria-label');
    }

    this.innerHTML = `
      <span class="nodel-image-frame">
        ${src ? `<img class="nodel-image-media" src="${escapeHtml(src)}" alt="${hostLabelled ? '' : escapeHtml(alt)}" />` : '<span class="nodel-image-placeholder" aria-hidden="true"></span>'}
      </span>
    `;
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'src', {
      alt: (value) => this.setSignalAttribute('alt', value),
      label: (value) => this.setSignalAttribute('label', value),
      src: (value) => this.setSignalAttribute('src', value)
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

if (!customElements.get('nodel-image')) {
  customElements.define('nodel-image', NodelImage);
}
