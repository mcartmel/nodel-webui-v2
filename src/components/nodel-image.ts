import { createSignalBindingController } from '../data/signal-bindings';
import { observeNodelVisibility } from '../data/visibility-scope';
import { escapeHtml } from '../utils/html';
import { safeImageSrc } from '../utils/urls';

type NodelImageFit = 'contain' | 'cover';
type NodelImageShape = 'none' | 'rounded' | 'circle';
type NodelImageSize = 'auto' | 'sm' | 'md' | 'lg' | 'xl';

function normalizeFit(value: string | null): NodelImageFit {
  return value === 'cover' ? 'cover' : 'contain';
}

function normalizeShape(value: string | null): NodelImageShape {
  return value === 'none' || value === 'circle' ? value : 'rounded';
}

function normalizeSize(value: string | null): NodelImageSize {
  return value === 'sm' || value === 'md' || value === 'lg' || value === 'xl' ? value : 'auto';
}

export class NodelImage extends HTMLElement {
  static observedAttributes = ['src', 'alt', 'label', 'aria-label', 'aria-labelledby', 'fit', 'shape', 'size', 'signal', 'signals'];

  private signalBindings = createSignalBindingController(this);
  private disposeVisibility = () => {};
  private pageActive = false;
  private rendering = false;
  private renderPending = false;

  connectedCallback() {
    this.disposeVisibility = observeNodelVisibility(this, (visible) => {
      this.pageActive = visible;
      this.render();
    }, { suspendOnDocumentHidden: false, suspendOnConnectivity: false });
    this.syncSignalSubscription();
  }

  disconnectedCallback() {
    this.signalBindings.dispose();
    this.disposeVisibility();
    this.disposeVisibility = () => {};
    this.pageActive = false;
    this.querySelector('.nodel-image-media')?.remove();
  }

  attributeChangedCallback(name: string) {
    if (this.isConnected) {
      if (name === 'aria-label' && !this.rendering && this.getAttribute('data-nodel-auto-aria-label') === 'true') {
        this.removeAttribute('data-nodel-auto-aria-label');
      }
      this.render();
      this.syncSignalSubscription();
    }
  }

  private render() {
    if (this.rendering) {
      this.renderPending = true;
      return;
    }

    this.rendering = true;
    try {
      this.renderContent();
    } finally {
      this.rendering = false;
      if (this.renderPending) {
        this.renderPending = false;
        this.render();
      }
    }
  }

  private renderContent() {
    const authoredSrc = this.getAttribute('src') ?? '';
    const src = authoredSrc ? safeImageSrc(authoredSrc) ?? '' : '';
    const alt = this.getAttribute('alt') ?? '';
    const label = this.getAttribute('label') ?? '';
    const fit = normalizeFit(this.getAttribute('fit'));
    const shape = normalizeShape(this.getAttribute('shape'));
    const size = normalizeSize(this.getAttribute('size'));
    const autoAria = this.getAttribute('data-nodel-auto-aria-label') === 'true';
    const explicitAria = autoAria ? null : this.getAttribute('aria-label');
    const sourceUnavailable = Boolean(authoredSrc && !src);
    const hostLabel = (explicitAria ?? label) || (sourceUnavailable ? (alt ? `${alt} unavailable` : 'Image unavailable') : (!this.pageActive && src ? alt : ''));
    const hostLabelled = Boolean(hostLabel || this.getAttribute('aria-labelledby'));

    this.dataset.fit = fit;
    this.dataset.shape = shape;
    this.dataset.size = size;
    this.dataset.sourceState = authoredSrc ? (src ? 'ready' : 'error') : 'empty';

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
        ${this.pageActive && src ? `<img class="nodel-image-media" src="${escapeHtml(src)}" alt="${hostLabelled ? '' : escapeHtml(alt)}" />` : '<span class="nodel-image-placeholder" aria-hidden="true"></span>'}
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
