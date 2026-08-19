import { createSignalBindingController } from '../data/signal-bindings';
import { observeNodelVisibility } from '../data/visibility-scope';
import { loadIconRecord, resolveIconSelection } from '../icons/catalogue-loader';
import { iconForName, renderFontAwesomeIcon, renderGeneratedIcon, uiIcons } from '../icons/fontawesome';

type NodelIconTone = 'default' | 'muted' | 'accent' | 'success' | 'info' | 'warning' | 'danger';
type NodelIconSize = 'auto' | 'sm' | 'md' | 'lg' | 'xl';

function normalizeTone(value: string | null): NodelIconTone {
  return value === 'muted' || value === 'accent' || value === 'success' || value === 'info' || value === 'warning' || value === 'danger' ? value : 'default';
}

function normalizeSize(value: string | null): NodelIconSize {
  return value === 'sm' || value === 'md' || value === 'lg' || value === 'xl' ? value : 'auto';
}

export class NodelIcon extends HTMLElement {
  static observedAttributes = ['name', 'family', 'style', 'label', 'alt', 'aria-label', 'aria-labelledby', 'tone', 'size', 'signal', 'signals'];

  private signalBindings = createSignalBindingController(this);
  private disposeVisibility = () => {};
  private pageActive = true;
  private generation = 0;

  connectedCallback() {
    this.disposeVisibility = observeNodelVisibility(this, (visible) => {
      this.pageActive = visible;
      this.render();
    }, { suspendOnDocumentHidden: false, suspendOnConnectivity: false });
    this.render();
    this.syncSignalSubscription();
  }

  disconnectedCallback() {
    this.generation += 1;
    this.signalBindings.dispose();
    this.disposeVisibility();
    this.disposeVisibility = () => {};
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
      this.syncSignalSubscription();
    }
  }

  private render() {
    const generation = ++this.generation;
    const name = this.getAttribute('name') ?? 'image';
    const label = this.getAttribute('label') ?? '';
    const alt = this.getAttribute('alt') ?? '';
    const tone = normalizeTone(this.getAttribute('tone'));
    const size = normalizeSize(this.getAttribute('size'));
    const family = this.getAttribute('family')?.trim() || 'classic';
    const requestedStyle = this.getAttribute('style')?.trim() || undefined;
    const style = requestedStyle ?? (family === 'classic' ? 'solid' : family === 'brands' ? 'brands' : '');
    const autoAria = this.getAttribute('data-nodel-auto-aria-label') === 'true';
    const explicitAria = autoAria ? null : this.getAttribute('aria-label');
    const accessibleLabel = explicitAria || alt || label;

    this.dataset.name = name;
    this.dataset.family = family;
    this.dataset.style = style;
    this.dataset.tone = tone;
    this.dataset.size = size;
    const curated = family === 'classic' && style === 'solid' ? iconForName(name) : undefined;
    const fallback = renderFontAwesomeIcon(curated ?? uiIcons.image, 'h-full w-full');
    this.dataset.iconState = curated ? 'ready' : 'loading';
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

    this.innerHTML = `<span class="nodel-icon-glyph">${fallback}</span>`;
    const inactivePage = this.closest('nodel-page')?.hasAttribute('hidden') || false;
    if (curated || !this.pageActive || inactivePage) {
      if (!curated) this.dataset.iconState = 'loading';
      return;
    }

    void Promise.all([resolveIconSelection(family, requestedStyle), loadIconRecord(name.trim(), family, requestedStyle)]).then(([selection, icon]) => {
      if (generation !== this.generation || !this.isConnected || !selection || !icon) {
        if (generation === this.generation && this.isConnected && (!selection || !icon)) this.dataset.iconState = 'fallback';
        return;
      }
      this.dataset.family = selection.family;
      this.dataset.style = selection.style;
      const glyph = this.querySelector('.nodel-icon-glyph');
      if (!glyph) return;
      glyph.innerHTML = renderGeneratedIcon(icon, 'h-full w-full');
      this.dataset.iconState = 'ready';
    }).catch(() => {
      if (generation === this.generation && this.isConnected) this.dataset.iconState = 'fallback';
    });
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'name', {
      alt: (value) => this.setSignalAttribute('alt', value),
      family: (value) => this.setSignalAttribute('family', value),
      label: (value) => this.setSignalAttribute('label', value),
      name: (value) => this.setSignalAttribute('name', value),
      style: (value) => this.setSignalAttribute('style', value),
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
