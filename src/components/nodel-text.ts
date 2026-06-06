import { parseSignalBindings, signalBindingKey, subscribeSignalBindings } from '../data/signal-bindings';

type NodelTextTone = 'muted' | 'default' | 'accent' | 'success' | 'info' | 'warning' | 'danger';
type NodelTextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type NodelTextSurface = 'none' | 'card';

const toneValues: Record<NodelTextTone, string> = {
  muted: 'rgb(var(--nodel-muted))',
  default: 'rgb(var(--nodel-fg))',
  accent: 'rgb(var(--nodel-accent))',
  success: 'rgb(var(--nodel-success))',
  info: 'rgb(var(--nodel-info))',
  warning: 'rgb(var(--nodel-warning))',
  danger: 'rgb(var(--nodel-danger))',
};

const sizeValues: Record<NodelTextSize, [string, string]> = {
  xs: ['0.75rem', '1rem'],
  sm: ['0.875rem', '1.25rem'],
  md: ['1rem', '1.5rem'],
  lg: ['1.125rem', '1.75rem'],
  xl: ['1.25rem', '1.875rem']
};

function normalizeTone(value: string | null): NodelTextTone {
  return value && value in toneValues ? (value as NodelTextTone) : 'muted';
}

function normalizeSize(value: string | null): NodelTextSize {
  return value && value in sizeValues ? (value as NodelTextSize) : 'sm';
}

function normalizeSurface(value: string | null): NodelTextSurface {
  return value === 'card' ? 'card' : 'none';
}

export class NodelText extends HTMLElement {
  static observedAttributes = ['tone', 'size', 'surface', 'signal', 'signals'];

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
    const tone = normalizeTone(this.getAttribute('tone'));
    const size = normalizeSize(this.getAttribute('size'));
    const surface = normalizeSurface(this.getAttribute('surface'));
    const [fontSize, lineHeight] = sizeValues[size];

    this.dataset.tone = tone;
    this.dataset.size = size;
    this.dataset.surface = surface;
    this.style.setProperty('--nodel-text-color', toneValues[tone]);
    this.style.setProperty('--nodel-text-size', fontSize);
    this.style.setProperty('--nodel-text-line-height', lineHeight);

    if (surface === 'card') {
      this.style.setProperty('--nodel-text-background', 'rgb(var(--nodel-surface))');
      this.style.setProperty('--nodel-text-border-color', 'rgb(var(--nodel-border))');
      this.style.setProperty('--nodel-text-padding', '1rem');
      this.style.setProperty('--nodel-text-radius', 'var(--nodel-radius-card)');
    } else {
      this.style.removeProperty('--nodel-text-background');
      this.style.removeProperty('--nodel-text-border-color');
      this.style.removeProperty('--nodel-text-padding');
      this.style.removeProperty('--nodel-text-radius');
    }
  }

  private syncSignalSubscription() {
    const bindings = parseSignalBindings(this.getAttribute('signal'), this.getAttribute('signals'), 'value');
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
      value: (value) => {
        this.textContent = value;
      }
    });
  }

  private disposeSignalSubscription() {
    this.signalSubscription?.dispose();
    this.signalSubscription = null;
    this.signalBindingsKey = '';
  }
}

if (!customElements.get('nodel-text')) {
  customElements.define('nodel-text', NodelText);
}
