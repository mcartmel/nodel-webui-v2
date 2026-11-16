import { createSignalBindingController } from '../data/signal-bindings';
import { observeNodelVisibility } from '../data/visibility-scope';
import { iconForName, renderFontAwesomeIcon, renderGeneratedIcon, uiIcons } from '../icons/fontawesome';
import { parseIconReference, selectIconReference } from '../icons/icon-reference';

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
  private deferredRenderScheduled = false;
  private deferredRenderGeneration = 0;

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
    const requestedFamily = this.getAttribute('family')?.trim() || 'classic';
    const requestedStyle = this.getAttribute('style')?.trim() || undefined;
    const reference = parseIconReference(name);
    const initialSelection = selectIconReference(reference, requestedFamily, requestedStyle);
    const family = initialSelection?.family ?? requestedFamily;
    const style = initialSelection?.style || requestedStyle || (family === 'brands' ? 'brands' : '');
    const autoAria = this.getAttribute('data-nodel-auto-aria-label') === 'true';
    const explicitAria = autoAria ? null : this.getAttribute('aria-label');
    const accessibleLabel = explicitAria || alt || label;

    this.dataset.name = name;
    this.dataset.family = family;
    this.dataset.style = style;
    this.dataset.tone = tone;
    this.dataset.size = size;
    const curated = reference.valid && reference.library === 'fontawesome' && family === 'classic' && (!style || style === 'solid') ? iconForName(reference.name) : undefined;
    // An omitted style belongs to the manifest, even for curated glyphs. Until
    // resolved, the bootstrap glyph is only a placeholder, not a ready result.
    const curatedReady = curated && style === 'solid';
    const fallback = renderFontAwesomeIcon(curated ?? uiIcons.image, 'h-full w-full');
    this.dataset.iconState = curatedReady ? 'ready' : reference.valid ? 'loading' : 'fallback';
    this.setAttribute('role', accessibleLabel ? 'img' : 'presentation');
    if (this.hasAttribute('aria-labelledby')) {
      this.setAttribute('role', 'img');
      this.removeAttribute('aria-hidden');
      this.removeAttribute('data-nodel-auto-aria-label');
      if (this.hasAttribute('aria-label')) {
        this.removeAttribute('aria-label');
      }
    } else if (accessibleLabel) {
      if (!explicitAria) {
        this.setAttribute('data-nodel-auto-aria-label', 'true');
      }
      this.removeAttribute('aria-hidden');
      if (this.getAttribute('aria-label') !== accessibleLabel) {
        this.setAttribute('aria-label', accessibleLabel);
      }
    } else {
      this.setAttribute('aria-hidden', 'true');
      this.removeAttribute('data-nodel-auto-aria-label');
      if (this.hasAttribute('aria-label')) {
        this.removeAttribute('aria-label');
      }
    }

    // Observed ARIA changes above may synchronously render a newer generation.
    // The older frame must not replace its DOM or take its deferred-render slot.
    if (generation !== this.generation || !this.isConnected) return;
    this.innerHTML = `<span class="nodel-icon-glyph">${fallback}</span>`;
    // Visibility observers run asynchronously; any hidden page ancestor must
    // synchronously block loading, including above an unhidden nested page.
    const inactivePage = this.closest('nodel-page[hidden]') !== null;
    if (curatedReady || !reference.valid) return;
    if (!this.pageActive || inactivePage) {
      if (inactivePage && this.pageActive) this.scheduleDeferredRender(generation);
      return;
    }

    const isEligible = () => generation === this.generation && this.isConnected && this.pageActive && !this.closest('nodel-page[hidden]');
    void import('../icons/catalogue-loader').then(async ({ loadIconRecord, resolveIconSelection }) => {
      if (!isEligible()) return;
      const [selection, icon] = await Promise.all([
        resolveIconSelection(name, requestedFamily, requestedStyle, isEligible),
        loadIconRecord(name, requestedFamily, requestedStyle, isEligible)
      ]);
      if (!isEligible()) return;
      if (!selection || !icon) {
        this.dataset.iconState = 'fallback';
        return;
      }
      this.dataset.family = selection.family;
      this.dataset.style = selection.style;
      const glyph = this.querySelector('.nodel-icon-glyph');
      if (!glyph) return;
      glyph.innerHTML = renderGeneratedIcon(icon, 'h-full w-full');
      this.dataset.iconState = 'ready';
    }).catch(() => {
      if (isEligible()) this.dataset.iconState = 'fallback';
    });
  }

  private scheduleDeferredRender(generation: number) {
    this.deferredRenderGeneration = generation;
    if (this.deferredRenderScheduled) return;
    this.deferredRenderScheduled = true;
    queueMicrotask(() => {
      this.deferredRenderScheduled = false;
      if (this.deferredRenderGeneration !== this.generation || !this.isConnected || !this.pageActive) return;
      if (this.closest('nodel-page[hidden]')) return;
      this.render();
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
