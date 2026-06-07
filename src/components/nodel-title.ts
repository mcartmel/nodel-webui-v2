import { createSignalBindingController } from '../data/signal-bindings';

type NodelTitleLevel = '1' | '2' | '3';
type NodelTitleTone = 'default' | 'muted' | 'accent';

const toneValues: Record<NodelTitleTone, string> = {
  default: 'rgb(var(--nodel-fg))',
  muted: 'rgb(var(--nodel-muted))',
  accent: 'rgb(var(--nodel-accent))'
};

function normalizeLevel(value: string | null): NodelTitleLevel {
  return value === '2' || value === '3' ? value : '1';
}

function normalizeTone(value: string | null): NodelTitleTone {
  return value === 'muted' || value === 'accent' ? value : 'default';
}

export class NodelTitle extends HTMLElement {
  static observedAttributes = ['level', 'tone', 'signal', 'signals'];

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
    const level = normalizeLevel(this.getAttribute('level'));
    const tone = normalizeTone(this.getAttribute('tone'));

    this.dataset.level = level;
    this.dataset.tone = tone;
    this.setAttribute('role', 'heading');
    this.setAttribute('aria-level', level);
    this.style.setProperty('--nodel-title-color', toneValues[tone]);
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      value: (value) => {
        this.textContent = value;
      }
    });
  }
}

if (!customElements.get('nodel-title')) {
  customElements.define('nodel-title', NodelTitle);
}
