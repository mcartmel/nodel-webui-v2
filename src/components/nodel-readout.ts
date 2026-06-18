import { createSignalBindingController } from '../data/signal-bindings';
import { clampValue, defaultRangeForUnit, formatValue, normalizeLevelUnit, parseNumber, valueToFraction, type LevelUnit } from '../utils/level-scale';
import { falsey, formatPlainNumber, normalizeTone, normalizeVariant, truthy } from '../utils/control-values';

type ReadoutType = 'text' | 'number' | 'percent' | 'db' | 'boolean' | 'duration';
type ReadoutVisual = 'none' | 'bar' | 'ring' | 'status';

const readoutTypes: ReadoutType[] = ['text', 'number', 'percent', 'db', 'boolean', 'duration'];
const visuals: ReadoutVisual[] = ['none', 'bar', 'ring', 'status'];

function normalizeType(value: string | null): ReadoutType {
  return readoutTypes.includes(value as ReadoutType) ? (value as ReadoutType) : 'text';
}

function normalizeVisual(value: string | null, type: ReadoutType): ReadoutVisual {
  if (visuals.includes(value as ReadoutVisual)) {
    return value as ReadoutVisual;
  }
  return type === 'boolean' ? 'status' : 'none';
}

function parsePrecision(value: string | null) {
  if (value === null) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : null;
}

function formatDuration(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return '';
  }
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function zoneFor(value: number, warn: number, danger: number) {
  if (Number.isFinite(danger) && value >= danger) {
    return 'danger';
  }
  if (Number.isFinite(warn) && value >= warn) {
    return 'warning';
  }
  return 'normal';
}

export class NodelReadout extends HTMLElement {
  static observedAttributes = ['label', 'value', 'type', 'visual', 'min', 'max', 'unit', 'prefix', 'suffix', 'precision', 'on-value', 'off-value', 'on-label', 'off-label', 'warn', 'danger', 'empty', 'variant', 'tone', 'signal', 'signals'];

  private shellReady = false;
  private labelNode: HTMLElement | null = null;
  private valueNode: HTMLElement | null = null;
  private visualNode: HTMLElement | null = null;
  private signalBindings = createSignalBindingController(this);

  connectedCallback() {
    this.ensureShell();
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

  private ensureShell() {
    if (this.shellReady) {
      return;
    }
    const initialText = Array.from(this.childNodes).map((child) => child.textContent?.trim() ?? '').filter(Boolean).join(' ').trim();
    if (initialText && !this.hasAttribute('value')) {
      this.setAttribute('value', initialText);
    }
    this.innerHTML = `
      <div class="nodel-readout-shell">
        <div class="nodel-readout-visual" aria-hidden="true"><span class="nodel-readout-visual-inner"></span></div>
        <div class="nodel-readout-content">
          <div class="nodel-readout-label" hidden></div>
          <div class="nodel-readout-value"></div>
        </div>
      </div>
    `;
    this.labelNode = this.querySelector('.nodel-readout-label');
    this.valueNode = this.querySelector('.nodel-readout-value');
    this.visualNode = this.querySelector('.nodel-readout-visual');
    this.shellReady = true;
  }

  private range(type: ReadoutType, unit: LevelUnit) {
    const defaults = type === 'db' || unit === 'db'
      ? defaultRangeForUnit('db')
      : defaultRangeForUnit('percent');
    const min = parseNumber(this.getAttribute('min'), defaults.min);
    const max = parseNumber(this.getAttribute('max'), defaults.max);
    return max > min ? { min, max } : defaults;
  }

  private formatted(type: ReadoutType, rawValue: string, unit: LevelUnit) {
    const empty = this.getAttribute('empty') ?? '--';
    const prefix = this.getAttribute('prefix') ?? '';
    const suffix = this.getAttribute('suffix') ?? '';
    const precision = parsePrecision(this.getAttribute('precision'));

    if (!rawValue && type !== 'boolean') {
      return { text: empty, numeric: NaN, booleanState: null as boolean | null };
    }

    if (type === 'boolean') {
      const onValue = this.getAttribute('on-value');
      const offValue = this.getAttribute('off-value');
      const state = onValue !== null ? rawValue === onValue : offValue !== null ? rawValue !== offValue : truthy(rawValue) && !falsey(rawValue);
      return { text: state ? (this.getAttribute('on-label') ?? 'On') : (this.getAttribute('off-label') ?? 'Off'), numeric: state ? 1 : 0, booleanState: state };
    }

    if (type === 'duration') {
      const numeric = parseNumber(rawValue, NaN);
      return { text: formatDuration(numeric) || empty, numeric, booleanState: null };
    }

    if (type === 'percent') {
      const numeric = parseNumber(rawValue, NaN);
      return { text: Number.isFinite(numeric) ? `${prefix}${formatPlainNumber(numeric, precision)}${suffix || '%'}` : empty, numeric, booleanState: null };
    }

    if (type === 'db') {
      const numeric = parseNumber(rawValue, NaN);
      return { text: Number.isFinite(numeric) ? `${prefix}${formatValue(numeric, 'db')}${suffix}` : empty, numeric, booleanState: null };
    }

    if (type === 'number') {
      const numeric = parseNumber(rawValue, NaN);
      return { text: Number.isFinite(numeric) ? `${prefix}${formatPlainNumber(numeric, precision)}${suffix}` : empty, numeric, booleanState: null };
    }

    return { text: `${prefix}${rawValue || empty}${suffix}`, numeric: parseNumber(rawValue, NaN), booleanState: null };
  }

  private render() {
    this.ensureShell();
    const type = normalizeType(this.getAttribute('type'));
    const visual = normalizeVisual(this.getAttribute('visual'), type);
    const variant = normalizeVariant(this.getAttribute('variant'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const unit = type === 'db' ? 'db' : type === 'percent' ? 'percent' : normalizeLevelUnit(this.getAttribute('unit'));
    const rawValue = this.getAttribute('value') ?? '';
    const formatted = this.formatted(type, rawValue, unit);
    const { min, max } = this.range(type, unit);
    const fraction = Number.isFinite(formatted.numeric) ? valueToFraction(clampValue(formatted.numeric, min, max), min, max) : 0;
    const warn = parseNumber(this.getAttribute('warn'), min + (max - min) * 0.8);
    const danger = parseNumber(this.getAttribute('danger'), min + (max - min) * 0.95);
    const zone = type === 'boolean'
      ? (formatted.booleanState ? 'on' : 'off')
      : zoneFor(formatted.numeric, warn, danger);
    const label = this.getAttribute('label') ?? '';

    this.dataset.type = type;
    this.dataset.visual = visual;
    this.dataset.variant = variant;
    this.dataset.tone = tone;
    this.dataset.zone = zone;
    this.style.setProperty('--nodel-readout-fraction', String(fraction));
    this.labelNode!.hidden = !label;
    this.labelNode!.textContent = label;
    this.valueNode!.textContent = formatted.text;
    this.visualNode!.hidden = visual === 'none';

    if ((visual === 'bar' || visual === 'ring') && label) {
      this.setAttribute('role', 'meter');
      this.setAttribute('aria-label', label);
      this.setAttribute('aria-valuemin', String(min));
      this.setAttribute('aria-valuemax', String(max));
      this.setAttribute('aria-valuenow', Number.isFinite(formatted.numeric) ? String(formatted.numeric) : String(min));
      this.setAttribute('aria-valuetext', formatted.text);
    } else {
      this.removeAttribute('role');
      this.removeAttribute('aria-valuemin');
      this.removeAttribute('aria-valuemax');
      this.removeAttribute('aria-valuenow');
      this.removeAttribute('aria-valuetext');
      if (label) {
        this.setAttribute('aria-label', `${label}: ${formatted.text}`);
      } else {
        this.removeAttribute('aria-label');
      }
    }
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      label: (value) => this.setAttribute('label', value),
      prefix: (value) => this.setAttribute('prefix', value),
      suffix: (value) => this.setAttribute('suffix', value),
      value: (value) => this.setAttribute('value', value),
      variant: (value) => this.setAttribute('variant', value)
    });
  }
}

if (!customElements.get('nodel-readout')) {
  customElements.define('nodel-readout', NodelReadout);
}
