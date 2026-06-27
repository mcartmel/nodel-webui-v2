import { createSignalBindingController } from '../data/signal-bindings';
import { iconForName, renderFontAwesomeIcon, uiIcons } from '../icons/fontawesome';

type NodelIconTone = 'default' | 'muted' | 'accent' | 'success' | 'info' | 'warning' | 'danger';
type NodelIconSize = 'auto' | 'sm' | 'md' | 'lg' | 'xl';
type NodelIconVariant = 'plain' | 'soft' | 'bordered';

function normalizeTone(value: string | null): NodelIconTone {
  return value === 'muted' || value === 'accent' || value === 'success' || value === 'info' || value === 'warning' || value === 'danger' ? value : 'default';
}

function normalizeSize(value: string | null): NodelIconSize {
  return value === 'sm' || value === 'md' || value === 'lg' || value === 'xl' ? value : 'auto';
}

function normalizeVariant(value: string | null): NodelIconVariant {
  return value === 'soft' || value === 'bordered' ? value : 'plain';
}

export class NodelIcon extends HTMLElement {
  static observedAttributes = ['name', 'label', 'alt', 'aria-label', 'aria-labelledby', 'tone', 'size', 'variant', 'signal', 'signals'];

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
    const name = this.getAttribute('name') ?? 'image';
    const label = this.getAttribute('label') ?? '';
    const alt = this.getAttribute('alt') ?? '';
    const tone = normalizeTone(this.getAttribute('tone'));
    const size = normalizeSize(this.getAttribute('size'));
    const variant = normalizeVariant(this.getAttribute('variant'));
    const autoAria = this.getAttribute('data-nodel-auto-aria-label') === 'true';
    const explicitAria = autoAria ? null : this.getAttribute('aria-label');
    const accessibleLabel = explicitAria || alt || label;

    this.dataset.name = name;
    this.dataset.tone = tone;
    this.dataset.size = size;
    this.dataset.variant = variant;
    this.setAttribute('role', accessibleLabel ? 'img' : 'presentation');
    if (this.hasAttribute('aria-labelledby')) {
      this.setAttribute('role', 'img');
      this.removeAttribute('aria-hidden');
      if (this.hasAttribute('aria-label')) {
        this.removeAttribute('aria-label');
      }
      this.removeAttribute('data-nodel-auto-aria-label');
    } else if (accessibleLabel) {
      if (!explicitAria) {
        this.setAttribute('data-nodel-auto-aria-label', 'true');
      }
      if (this.getAttribute('aria-label') !== accessibleLabel) {
        this.setAttribute('aria-label', accessibleLabel);
      }
      this.removeAttribute('aria-hidden');
    } else {
      this.setAttribute('aria-hidden', 'true');
      if (this.hasAttribute('aria-label')) {
        this.removeAttribute('aria-label');
      }
      this.removeAttribute('data-nodel-auto-aria-label');
    }

    this.innerHTML = `
      <span class="nodel-icon-glyph">${renderFontAwesomeIcon(iconForName(name, uiIcons.image)!, 'h-full w-full')}</span>
    `;
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'name', {
      alt: (value) => this.setSignalAttribute('alt', value),
      label: (value) => this.setSignalAttribute('label', value),
      name: (value) => this.setSignalAttribute('name', value),
      tone: (value) => this.setSignalAttribute('tone', value)
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

if (!customElements.get('nodel-icon')) {
  customElements.define('nodel-icon', NodelIcon);
}
