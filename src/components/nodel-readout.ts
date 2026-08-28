import { createSignalBindingController } from '../data/signal-bindings';
import { clampValue, defaultRangeForUnit, formatValue, normalizeLevelUnit, parseNumber, valueToFraction, type LevelUnit } from '../utils/level-scale';
import { syncHostAccessibleLabel } from '../utils/accessibility';
import { falsey, formatPlainNumber, normalizeTone, normalizeVariant, truthy } from '../utils/control-values';

type ReadoutType = 'text' | 'number' | 'percent' | 'db' | 'boolean' | 'duration';
type ReadoutVisual = 'none' | 'bar' | 'ring' | 'status';
type RingLayout = 'compact' | 'edge';
type NotchPosition = 'bottom' | 'left' | 'top' | 'right';

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

const defaultNotchDepth = 15.4167;

function normalizeRingLayout(value: string | null): RingLayout {
  return value === 'edge' ? 'edge' : 'compact';
}

function normalizeNotchPosition(value: string | null): NotchPosition {
  return value === 'left' || value === 'top' || value === 'right' ? value : 'bottom';
}

function normalizeNotchDepth(value: string | null) {
  if (value === null || !/^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)%\s*$/.test(value)) {
    return defaultNotchDepth;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(50, parsed)) : defaultNotchDepth;
}

function edgePath(depthPercent: number) {
  const radius = 115;
  const depth = 240 * depthPercent / 100;
  const offset = Math.max(0, Math.min(radius, 120 - depth));
  if (depthPercent === 0 || offset >= radius) {
    return 'M 120 5 A 115 115 0 1 1 120 235 A 115 115 0 1 1 120 5';
  }
  const x = Math.sqrt(Math.max(0, radius * radius - offset * offset));
  const y = 240 - depth;
  return `M ${120 - x} ${y} A 115 115 0 1 1 ${120 + x} ${y}`;
}

export class NodelReadout extends HTMLElement {
  static observedAttributes = ['label', 'aria-label', 'aria-labelledby', 'value', 'type', 'visual', 'ring-layout', 'notch-position', 'notch-depth', 'min', 'max', 'unit', 'prefix', 'suffix', 'precision', 'on-value', 'off-value', 'on-label', 'off-label', 'warn', 'danger', 'empty', 'variant', 'tone', 'signal', 'signals'];

  private shellReady = false;
  private valueNode: HTMLElement | null = null;
  private visualNode: HTMLElement | null = null;
  private edgeSvg: SVGSVGElement | null = null;
  private edgeGroup: SVGGElement | null = null;
  private edgeTrack: SVGPathElement | null = null;
  private edgeProgress: SVGPathElement | null = null;
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
        <svg class="nodel-readout-edge-visual" aria-hidden="true" viewBox="0 0 240 240" preserveAspectRatio="xMidYMid meet"><g><path class="nodel-readout-edge-track"></path><path class="nodel-readout-edge-progress"></path></g></svg>
        <div class="nodel-readout-content">
          <div class="nodel-readout-value"></div>
        </div>
      </div>
    `;
    this.valueNode = this.querySelector('.nodel-readout-value');
    this.visualNode = this.querySelector('.nodel-readout-visual');
    this.edgeSvg = this.querySelector('.nodel-readout-edge-visual');
    this.edgeGroup = this.querySelector('svg > g');
    this.edgeTrack = this.querySelector('.nodel-readout-edge-track');
    this.edgeProgress = this.querySelector('.nodel-readout-edge-progress');
    for (const path of [this.edgeTrack!, this.edgeProgress!]) {
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', '10');
    }
    this.edgeTrack!.setAttribute('pathLength', '1');
    this.edgeProgress!.setAttribute('pathLength', '1');
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

  private formatted(type: ReadoutType, rawValue: string) {
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
    const ringLayout = normalizeRingLayout(this.getAttribute('ring-layout'));
    const notchPosition = normalizeNotchPosition(this.getAttribute('notch-position'));
    const notchDepth = normalizeNotchDepth(this.getAttribute('notch-depth'));
    const variant = normalizeVariant(this.getAttribute('variant'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const unit = type === 'db' ? 'db' : type === 'percent' ? 'percent' : normalizeLevelUnit(this.getAttribute('unit'));
    const rawValue = this.getAttribute('value') ?? '';
    const formatted = this.formatted(type, rawValue);
    const { min, max } = this.range(type, unit);
    const fraction = Number.isFinite(formatted.numeric) ? valueToFraction(clampValue(formatted.numeric, min, max), min, max) : 0;
    const warn = parseNumber(this.getAttribute('warn'), min + (max - min) * 0.8);
    const danger = parseNumber(this.getAttribute('danger'), min + (max - min) * 0.95);
    const zone = type === 'boolean'
      ? (formatted.booleanState ? 'on' : 'off')
      : zoneFor(formatted.numeric, warn, danger);
    const label = this.getAttribute('label') ?? '';
    const hasAccessibleName = Boolean(label || this.getAttribute('aria-label') || this.getAttribute('aria-labelledby'));

    this.dataset.type = type;
    this.dataset.visual = visual;
    this.dataset.ringLayout = ringLayout;
    this.dataset.variant = variant;
    this.dataset.tone = tone;
    this.dataset.zone = zone;
    this.style.setProperty('--nodel-readout-fraction', String(fraction));
    this.valueNode!.textContent = formatted.text;
    this.visualNode!.hidden = visual === 'none';
    const edge = visual === 'ring' && ringLayout === 'edge';
    if (edge) {
      this.dataset.notchPosition = notchPosition;
      this.dataset.notchDepth = `${notchDepth}%`;
    } else {
      delete this.dataset.notchPosition;
      delete this.dataset.notchDepth;
    }
    (this.edgeSvg as unknown as HTMLElement).hidden = !edge;
    if (edge) {
      const rotations: Record<NotchPosition, number> = { bottom: 0, left: 90, top: 180, right: 270 };
      const path = edgePath(notchDepth);
      this.edgeGroup!.setAttribute('transform', `rotate(${rotations[notchPosition]} 120 120)`);
      this.edgeTrack!.setAttribute('d', path);
      this.edgeProgress!.setAttribute('d', path);
      this.edgeProgress!.style.strokeDasharray = `${fraction} 1`;
      this.edgeProgress!.style.display = fraction === 0 ? 'none' : '';
    }

    if ((visual === 'bar' || visual === 'ring') && hasAccessibleName) {
      this.setAttribute('role', 'meter');
      this.syncAccessibleName(label, formatted.text);
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
      this.syncAccessibleName(label, formatted.text);
    }
  }

  private syncAccessibleName(label: string, text: string) {
    if (this.hasAttribute('aria-labelledby')) {
      if (this.getAttribute('data-nodel-auto-aria-label') === 'true') {
        this.removeAttribute('aria-label');
        this.removeAttribute('data-nodel-auto-aria-label');
      }
      return;
    }
    if (this.hasAttribute('aria-label') && this.getAttribute('data-nodel-auto-aria-label') !== 'true') {
      return;
    }
    if (label) {
      this.setAttribute('data-nodel-auto-aria-label', 'true');
      const ariaLabel = `${label}: ${text}`;
      if (this.getAttribute('aria-label') !== ariaLabel) {
        this.setAttribute('aria-label', ariaLabel);
      }
    } else {
      syncHostAccessibleLabel(this);
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
