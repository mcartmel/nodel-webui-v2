import { createSignalBindingController } from '../data/signal-bindings';

type ClockFormat = 'time' | 'date' | 'datetime';
type ClockHour12 = 'auto' | 'true' | 'false';

function normalizeFormat(value: string | null): ClockFormat {
  return value === 'date' || value === 'datetime' ? value : 'time';
}

function normalizeHour12(value: string | null): ClockHour12 {
  return value === 'true' || value === 'false' ? value : 'auto';
}

function parseDateValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const numeric = Number(trimmed);
  const date = Number.isFinite(numeric) && /^-?\d+(?:\.\d+)?$/.test(trimmed)
    ? new Date(numeric)
    : new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateValue(date: Date, format: ClockFormat, hour12: ClockHour12, timeZone: string | undefined) {
  const options: Intl.DateTimeFormatOptions = format === 'date'
    ? { dateStyle: 'medium' }
    : format === 'datetime'
      ? { dateStyle: 'medium', timeStyle: 'medium' }
      : { timeStyle: 'medium' };
  if (hour12 !== 'auto' && format !== 'date') {
    options.hour12 = hour12 === 'true';
  }
  if (timeZone) {
    options.timeZone = timeZone;
  }
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export class NodelClock extends HTMLElement {
  static observedAttributes = ['value', 'signal', 'signals', 'format', 'hour12', 'time-zone'];

  private signalBindings = createSignalBindingController(this);
  private timeNode: HTMLTimeElement | null = null;

  connectedCallback() {
    this.ensureShell();
    this.render();
    this.syncSignalSubscription();
  }

  disconnectedCallback() {
    this.signalBindings.dispose();
  }

  attributeChangedCallback(name: string) {
    if (!this.isConnected) {
      return;
    }
    this.render();
    if (name === 'signal' || name === 'signals') {
      this.syncSignalSubscription();
    }
  }

  private ensureShell() {
    if (this.timeNode) {
      return;
    }
    this.innerHTML = '<time class="nodel-clock-value"></time>';
    this.timeNode = this.querySelector('time');
  }

  private render() {
    this.ensureShell();
    if (!this.timeNode) {
      return;
    }
    const value = this.getAttribute('value') ?? '';
    const format = normalizeFormat(this.getAttribute('format'));
    const hour12 = normalizeHour12(this.getAttribute('hour12'));
    const timeZone = this.getAttribute('time-zone')?.trim() || undefined;
    const date = parseDateValue(value);
    this.dataset.format = format;
    if (!date) {
      this.timeNode.textContent = value;
      this.timeNode.removeAttribute('datetime');
      return;
    }
    try {
      this.timeNode.textContent = formatDateValue(date, format, hour12, timeZone);
      this.timeNode.dateTime = date.toISOString();
    } catch {
      this.timeNode.textContent = value;
      this.timeNode.removeAttribute('datetime');
    }
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      value: (value) => this.setAttribute('value', value)
    });
  }
}

if (!customElements.get('nodel-clock')) {
  customElements.define('nodel-clock', NodelClock);
}
