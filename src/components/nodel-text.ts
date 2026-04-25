type NodelTextTone = 'muted' | 'default' | 'accent' | 'danger' | 'success';
type NodelTextSize = 'xs' | 'sm' | 'md' | 'lg';
type NodelTextSurface = 'none' | 'card';

const toneValues: Record<NodelTextTone, string> = {
  muted: 'rgb(var(--nodel-muted))',
  default: 'rgb(var(--nodel-fg))',
  accent: 'rgb(var(--nodel-accent))',
  danger: 'rgb(239 68 68)',
  success: 'rgb(34 197 94)'
};

const sizeValues: Record<NodelTextSize, [string, string]> = {
  xs: ['0.75rem', '1rem'],
  sm: ['0.875rem', '1.5rem'],
  md: ['1rem', '1.625rem'],
  lg: ['1.125rem', '1.75rem']
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
  static observedAttributes = ['tone', 'size', 'surface'];

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
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
      this.style.setProperty('--nodel-text-radius', '0.75rem');
    } else {
      this.style.removeProperty('--nodel-text-background');
      this.style.removeProperty('--nodel-text-border-color');
      this.style.removeProperty('--nodel-text-padding');
      this.style.removeProperty('--nodel-text-radius');
    }
  }
}

if (!customElements.get('nodel-text')) {
  customElements.define('nodel-text', NodelText);
}
