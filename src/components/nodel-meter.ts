import { createSignalBindingController } from '../data/signal-bindings';
import {
  clampValue,
  defaultRangeForUnit,
  formatValue,
  normalizeLevelCurve,
  normalizeLevelUnit,
  parseNumber,
  valueToDisplayFraction,
  type LevelCurve,
  type LevelUnit
} from '../utils/level-scale';

type MeterOrientation = 'vertical' | 'horizontal';
type MeterPeakMode = 'off' | 'hold';
type MeterReadout = 'show' | 'hide';
type MeterZone = 'success' | 'warning' | 'danger';

function normalizeOrientation(value: string | null): MeterOrientation {
  return value === 'horizontal' ? 'horizontal' : 'vertical';
}

function normalizePeakMode(value: string | null): MeterPeakMode {
  return value === 'hold' ? 'hold' : 'off';
}

function normalizeReadout(value: string | null): MeterReadout {
  return value === 'show' ? 'show' : 'hide';
}

function zoneForValue(value: number, warn: number, danger: number): MeterZone {
  if (value >= danger) {
    return 'danger';
  }
  if (value >= warn) {
    return 'warning';
  }
  return 'success';
}

export class NodelMeter extends HTMLElement {
  static observedAttributes = ['signal', 'signals', 'value', 'min', 'max', 'unit', 'curve', 'orientation', 'warn', 'danger', 'peak', 'readout', 'label', 'aria-label', 'aria-labelledby'];

  private shellReady = false;
  private trackNode: HTMLElement | null = null;
  private fillNode: HTMLElement | null = null;
  private peakNode: HTMLElement | null = null;
  private readoutNode: HTMLElement | null = null;
  private signalBindings = createSignalBindingController(this);
  private raf = 0;
  private heldPeak: number | null = null;
  private peakTimer: number | null = null;

  connectedCallback() {
    this.ensureShell();
    this.render();
    this.syncSignalSubscription();
  }

  disconnectedCallback() {
    this.signalBindings.dispose();
    if (this.raf) {
      window.cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.peakTimer !== null) {
      window.clearTimeout(this.peakTimer);
      this.peakTimer = null;
    }
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
      this.syncSignalSubscription();
    }
  }

  private render() {
    this.ensureShell();
    const unit = normalizeLevelUnit(this.getAttribute('unit'));
    const curve = normalizeLevelCurve(this.getAttribute('curve'), unit);
    const { min, max } = this.range(unit);
    const value = clampValue(parseNumber(this.getAttribute('value'), min), min, max);
    const orientation = normalizeOrientation(this.getAttribute('orientation'));
    const peakMode = normalizePeakMode(this.getAttribute('peak'));
    const readout = normalizeReadout(this.getAttribute('readout'));
    const warn = parseNumber(this.getAttribute('warn'), min + (max - min) * 0.8);
    const danger = parseNumber(this.getAttribute('danger'), min + (max - min) * 0.95);
    const zone = zoneForValue(value, warn, danger);
    const fraction = valueToDisplayFraction(value, min, max, curve);
    const label = this.getAttribute('label') ?? '';

    this.dataset.orientation = orientation;
    this.dataset.unit = unit;
    this.dataset.curve = curve;
    this.dataset.zone = zone;
    this.dataset.readout = readout;
    this.dataset.peak = peakMode;
    this.style.setProperty('--nodel-meter-value', String(fraction));
    this.setAccessibility(label, value, min, max, unit);

    this.fillNode?.setAttribute('data-zone', zone);
    this.readoutNode!.hidden = readout !== 'show';
    this.readoutNode!.textContent = formatValue(value, unit);
    this.syncPeak(value, min, max, peakMode, unit, curve);
  }

  private ensureShell() {
    if (this.shellReady) {
      return;
    }

    this.innerHTML = `
      <div class="nodel-meter-shell">
        <div class="nodel-meter-track">
          <div class="nodel-meter-fill"></div>
          <div class="nodel-meter-peak" hidden></div>
        </div>
        <div class="nodel-meter-readout" hidden></div>
      </div>
    `;
    this.trackNode = this.querySelector('.nodel-meter-track');
    this.fillNode = this.querySelector('.nodel-meter-fill');
    this.peakNode = this.querySelector('.nodel-meter-peak');
    this.readoutNode = this.querySelector('.nodel-meter-readout');
    this.shellReady = true;
  }

  private range(unit: LevelUnit) {
    const defaults = defaultRangeForUnit(unit);
    const min = parseNumber(this.getAttribute('min'), defaults.min);
    const max = parseNumber(this.getAttribute('max'), defaults.max);
    if (max <= min) {
      return defaults;
    }
    return { min, max };
  }

  private setAccessibility(label: string, value: number, min: number, max: number, unit: LevelUnit) {
    const labelledBy = this.getAttribute('aria-labelledby');
    const autoAria = this.getAttribute('data-nodel-auto-aria-label') === 'true';
    const explicitLabel = autoAria ? null : this.getAttribute('aria-label');
    const accessibleLabel = explicitLabel ?? label;
    if (!accessibleLabel && !labelledBy) {
      this.setAttribute('aria-hidden', 'true');
      this.removeAttribute('role');
      this.removeAttribute('aria-label');
      this.removeAttribute('aria-labelledby');
      this.removeAttribute('data-nodel-auto-aria-label');
      this.removeAttribute('aria-valuemin');
      this.removeAttribute('aria-valuemax');
      this.removeAttribute('aria-valuenow');
      this.removeAttribute('aria-valuetext');
      return;
    }

    this.removeAttribute('aria-hidden');
    this.setAttribute('role', 'meter');
    if (labelledBy) {
      this.setAttribute('aria-labelledby', labelledBy);
      if (this.hasAttribute('aria-label')) {
        this.removeAttribute('aria-label');
      }
      this.removeAttribute('data-nodel-auto-aria-label');
    } else {
      this.removeAttribute('aria-labelledby');
      if (!explicitLabel) {
        this.setAttribute('data-nodel-auto-aria-label', 'true');
      }
      if (this.getAttribute('aria-label') !== accessibleLabel) {
        this.setAttribute('aria-label', accessibleLabel);
      }
    }
    this.setAttribute('aria-valuemin', String(min));
    this.setAttribute('aria-valuemax', String(max));
    this.setAttribute('aria-valuenow', String(value));
    this.setAttribute('aria-valuetext', formatValue(value, unit));
  }

  private syncPeak(value: number, min: number, max: number, peakMode: MeterPeakMode, unit: LevelUnit, curve: LevelCurve) {
    if (!this.peakNode) {
      return;
    }

    if (peakMode === 'off') {
      this.peakNode.hidden = true;
      this.heldPeak = null;
      return;
    }

    const explicitPeak = this.getAttribute('data-explicit-peak');
    const nextPeak = explicitPeak !== null
      ? clampValue(parseNumber(explicitPeak, value), min, max)
      : Math.max(this.heldPeak ?? value, value);
    this.heldPeak = nextPeak;
    this.peakNode.hidden = false;
    this.style.setProperty('--nodel-meter-peak', String(valueToDisplayFraction(nextPeak, min, max, curve)));
    this.peakNode.setAttribute('title', formatValue(nextPeak, unit));

    if (explicitPeak === null) {
      this.schedulePeakDecay(value);
    }
  }

  private schedulePeakDecay(value: number) {
    if (this.peakTimer !== null) {
      return;
    }

    this.peakTimer = window.setTimeout(() => {
      this.peakTimer = null;
      if (this.heldPeak !== null) {
        this.heldPeak = Math.max(value, this.heldPeak - Math.max(1, Math.abs(this.heldPeak - value) * 0.4));
        this.render();
      }
    }, 750);
  }

  private setSignalAttribute(name: string, value: string) {
    if (name === 'peak') {
      if (value) {
        this.setAttribute('data-explicit-peak', value);
      } else {
        this.removeAttribute('data-explicit-peak');
      }
      this.render();
      return;
    }

    if (value || name === 'value') {
      this.setAttribute(name, value);
    } else {
      this.removeAttribute(name);
    }
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      label: (value) => this.setSignalAttribute('label', value),
      peak: (value) => this.setSignalAttribute('peak', value),
      value: (value) => this.setSignalAttribute('value', value)
    });
  }
}

if (!customElements.get('nodel-meter')) {
  customElements.define('nodel-meter', NodelMeter);
}
