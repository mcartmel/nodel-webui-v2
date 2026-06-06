import { parseSignalBindings, signalBindingKey, subscribeSignalBindings } from '../data/signal-bindings';
import { logIcons, renderFontAwesomeIcon, toastIcons, uiIcons } from '../icons/fontawesome';
import { escapeHtml } from '../utils/html';

type NodelIconTone = 'default' | 'muted' | 'accent' | 'success' | 'info' | 'warning' | 'danger';
type NodelIconSize = 'auto' | 'sm' | 'md' | 'lg' | 'xl';
type NodelIconVariant = 'plain' | 'soft' | 'bordered';

const iconMap = {
  action: logIcons.action,
  arrow: logIcons.remote,
  event: logIcons.event,
  image: uiIcons.image,
  info: toastIcons.info,
  link: logIcons.actionBinding,
  mute: uiIcons.volumeMute,
  pause: uiIcons.pause,
  play: uiIcons.play,
  power: uiIcons.power,
  sliders: uiIcons.sliders,
  stop: uiIcons.stop,
  success: toastIcons.success,
  warning: toastIcons.warning,
  volume: uiIcons.volume,
  'volume-low': uiIcons.volumeLow
} as const;

function normalizeTone(value: string | null): NodelIconTone {
  return value === 'muted' || value === 'accent' || value === 'success' || value === 'info' || value === 'warning' || value === 'danger' ? value : 'default';
}

function normalizeSize(value: string | null): NodelIconSize {
  return value === 'sm' || value === 'md' || value === 'lg' || value === 'xl' ? value : 'auto';
}

function normalizeVariant(value: string | null): NodelIconVariant {
  return value === 'soft' || value === 'bordered' ? value : 'plain';
}

function iconForName(value: string | null) {
  const key = (value ?? '').trim() as keyof typeof iconMap;
  return iconMap[key] ?? uiIcons.image;
}

export class NodelIcon extends HTMLElement {
  static observedAttributes = ['name', 'label', 'alt', 'tone', 'size', 'variant', 'signal', 'signals'];

  private signalBindingsKey = '';
  private signalSubscription: { dispose(): void } | null = null;

  connectedCallback() {
    this.render();
    this.syncSignalSubscription();
  }

  disconnectedCallback() {
    this.disposeSignalSubscription();
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
    const accessibleLabel = alt || label;

    this.dataset.name = name;
    this.dataset.tone = tone;
    this.dataset.size = size;
    this.dataset.variant = variant;
    this.setAttribute('role', accessibleLabel ? 'img' : 'presentation');
    if (accessibleLabel) {
      this.setAttribute('aria-label', accessibleLabel);
      this.removeAttribute('aria-hidden');
    } else {
      this.setAttribute('aria-hidden', 'true');
      this.removeAttribute('aria-label');
    }

    this.innerHTML = `
      <span class="nodel-icon-glyph">${renderFontAwesomeIcon(iconForName(name), 'h-full w-full')}</span>
      ${label ? `<span class="nodel-icon-label">${escapeHtml(label)}</span>` : ''}
    `;
  }

  private syncSignalSubscription() {
    const bindings = parseSignalBindings(this.getAttribute('signal'), this.getAttribute('signals'), 'name');
    const bindingsKey = signalBindingKey(bindings);

    if (bindingsKey === this.signalBindingsKey) {
      return;
    }

    this.disposeSignalSubscription();
    this.signalBindingsKey = bindingsKey;

    if (bindings.length === 0) {
      return;
    }

    this.signalSubscription = subscribeSignalBindings(this, bindings, {
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

  private disposeSignalSubscription() {
    this.signalSubscription?.dispose();
    this.signalSubscription = null;
    this.signalBindingsKey = '';
  }
}

if (!customElements.get('nodel-icon')) {
  customElements.define('nodel-icon', NodelIcon);
}
