import { createSignalBindingController } from '../data/signal-bindings';

type NodelStatusSurface = 'card' | 'panel' | 'none';
type NodelStatusPadding = 'default' | 'compact' | 'none';
type NodelStatusTone = 'solid' | 'soft' | 'outline';
type NodelStatusState = 'unknown' | 'success' | 'info' | 'warning' | 'danger' | 'muted';

const states: NodelStatusState[] = ['unknown', 'success', 'info', 'warning', 'danger', 'muted'];
const stateLabels: Record<NodelStatusState, string> = {
  unknown: 'Unknown',
  success: 'OK',
  info: 'Info',
  warning: 'Warning',
  danger: 'Fault',
  muted: 'Offline'
};

const inferredStates: Record<string, NodelStatusState> = {
  '': 'unknown',
  unknown: 'unknown',
  null: 'unknown',
  undefined: 'unknown',
  true: 'success',
  '1': 'success',
  on: 'success',
  yes: 'success',
  ok: 'success',
  okay: 'success',
  ready: 'success',
  online: 'success',
  active: 'success',
  present: 'success',
  available: 'success',
  healthy: 'success',
  connected: 'success',
  running: 'success',
  false: 'muted',
  '0': 'muted',
  off: 'muted',
  no: 'muted',
  offline: 'muted',
  inactive: 'muted',
  absent: 'muted',
  unavailable: 'muted',
  disabled: 'muted',
  disconnected: 'muted',
  info: 'info',
  informational: 'info',
  busy: 'info',
  starting: 'info',
  stopping: 'info',
  warming: 'info',
  cooling: 'info',
  pending: 'info',
  warn: 'warning',
  warning: 'warning',
  degraded: 'warning',
  danger: 'danger',
  error: 'danger',
  fault: 'danger',
  fail: 'danger',
  failed: 'danger',
  failure: 'danger',
  alarm: 'danger',
  critical: 'danger'
};

let statusIdCounter = 0;

function normalizeSurface(value: string | null): NodelStatusSurface {
  return value === 'panel' || value === 'none' ? value : 'card';
}

function normalizePadding(value: string | null): NodelStatusPadding {
  return value === 'compact' || value === 'none' ? value : 'default';
}

function normalizeTone(value: string | null): NodelStatusTone {
  return value === 'solid' || value === 'outline' ? value : 'soft';
}

function normalizeState(value: string | null): NodelStatusState | null {
  const normalized = value?.trim().toLocaleLowerCase() ?? '';
  return states.includes(normalized as NodelStatusState) ? (normalized as NodelStatusState) : null;
}

function stateFromLevel(value: string | null): NodelStatusState | null {
  if (value === null) {
    return null;
  }

  const level = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(level)) {
    return null;
  }

  if (level === 0) {
    return 'success';
  }
  if (level === 1) {
    return 'warning';
  }
  if (level >= 2 && level <= 4) {
    return 'danger';
  }
  if (level === 5) {
    return 'info';
  }
  return 'unknown';
}

function inferState(value: string | null): NodelStatusState {
  const normalized = value?.trim().toLocaleLowerCase() ?? '';
  return inferredStates[normalized] ?? 'unknown';
}

function parseStateMap(value: string | null) {
  const map = new Map<string, NodelStatusState>();
  for (const part of (value ?? '').split(';')) {
    const separatorIndex = part.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim().toLocaleLowerCase();
    const state = normalizeState(part.slice(separatorIndex + 1));
    if (key && state) {
      map.set(key, state);
    }
  }
  return map;
}

function stateFromMap(rawValue: string | null, stateMap: string | null): NodelStatusState | null {
  const key = rawValue?.trim().toLocaleLowerCase() ?? '';
  if (!key) {
    return null;
  }
  return parseStateMap(stateMap).get(key) ?? null;
}

function parseStructuredValue(value: string | null): { level?: string; message?: string } | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || !trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.level !== 'number') {
    return null;
  }

  return {
    level: String(record.level),
    message: typeof record.message === 'string' ? record.message : undefined
  };
}

function isDisplayableValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'true' || trimmed === 'false' || trimmed === '0' || trimmed === '1') {
    return false;
  }
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return false;
  }
  return true;
}

export class NodelStatus extends HTMLElement {
  static observedAttributes = ['label', 'value', 'state', 'level', 'message', 'state-map', 'surface', 'padding', 'tone', 'signal', 'signals'];

  private signalBindings = createSignalBindingController(this);
  private shellReady = false;
  private shellNode: HTMLElement | null = null;
  private labelNode: HTMLElement | null = null;
  private messageNode: HTMLElement | null = null;
  private bodyNode: HTMLElement | null = null;
  private labelId = '';
  private messageSetBySignal = false;
  private stateSetBySignal = false;
  private levelSetBySignal = false;

  connectedCallback() {
    this.ensureShell();
    this.render();
    this.syncSignalSubscription();
  }

  disconnectedCallback() {
    this.signalBindings.dispose();
  }

  attributeChangedCallback(name: string) {
    if (name === 'message' && !this.isConnected) {
      this.messageSetBySignal = false;
    }
    if (name === 'state' && !this.isConnected) {
      this.stateSetBySignal = false;
    }
    if (name === 'level' && !this.isConnected) {
      this.levelSetBySignal = false;
    }
    if (this.isConnected) {
      this.render();
      if (name === 'signal' || name === 'signals') {
        this.syncSignalSubscription();
      }
    }
  }

  private ensureShell() {
    if (this.shellReady) {
      return;
    }

    const children = Array.from(this.childNodes);
    this.labelId = `nodel-status-label-${++statusIdCounter}`;
    this.innerHTML = `
      <div class="nodel-status-shell">
        <div class="nodel-status-header">
          <div class="nodel-status-scale" aria-hidden="true">
            <span data-status-step="muted"></span>
            <span data-status-step="danger"></span>
            <span data-status-step="warning"></span>
            <span data-status-step="info"></span>
            <span data-status-step="success"></span>
          </div>
          <div class="nodel-status-heading">
            <div class="nodel-status-label" hidden></div>
            <div class="nodel-status-message" role="status" aria-live="polite"></div>
          </div>
        </div>
        <div class="nodel-status-body"></div>
      </div>
    `;
    this.shellNode = this.querySelector('.nodel-status-shell');
    this.labelNode = this.querySelector('.nodel-status-label');
    this.messageNode = this.querySelector('.nodel-status-message');
    this.bodyNode = this.querySelector('.nodel-status-body');
    this.labelNode!.id = this.labelId;
    for (const child of children) {
      this.bodyNode?.appendChild(child);
    }
    this.shellReady = true;
  }

  private render() {
    this.ensureShell();
    const label = this.getAttribute('label') ?? '';
    const rawValue = this.getAttribute('value') ?? '';
    const structured = parseStructuredValue(rawValue);
    const state = this.resolvedState(rawValue, structured);
    const surface = normalizeSurface(this.getAttribute('surface'));
    const padding = normalizePadding(this.getAttribute('padding'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const message = this.resolvedMessage(rawValue, state, structured);

    this.dataset.state = state;
    this.dataset.surface = surface;
    this.dataset.padding = padding;
    this.dataset.tone = tone;
    this.shellNode!.dataset.state = state;
    this.shellNode!.dataset.surface = surface;
    this.shellNode!.dataset.padding = padding;
    this.shellNode!.dataset.tone = tone;
    this.labelNode!.hidden = !label;
    this.labelNode!.textContent = label;
    this.messageNode!.textContent = message;

    if (label) {
      this.shellNode!.setAttribute('role', 'group');
      this.shellNode!.setAttribute('aria-labelledby', this.labelId);
    } else {
      this.shellNode!.removeAttribute('role');
      this.shellNode!.removeAttribute('aria-labelledby');
    }
  }

  private resolvedState(rawValue: string, structured: { level?: string } | null): NodelStatusState {
    const explicitState = normalizeState(this.getAttribute('state'));
    if (explicitState) {
      return explicitState;
    }

    const inferredExplicitState = this.hasAttribute('state') ? inferState(this.getAttribute('state')) : null;
    if (inferredExplicitState && inferredExplicitState !== 'unknown') {
      return inferredExplicitState;
    }

    const levelState = stateFromLevel(this.getAttribute('level'));
    if (levelState && (this.levelSetBySignal || this.hasAttribute('level'))) {
      return levelState;
    }

    const mappedState = stateFromMap(rawValue, this.getAttribute('state-map'));
    if (mappedState) {
      return mappedState;
    }

    const structuredState = stateFromLevel(structured?.level ?? null);
    if (structuredState) {
      return structuredState;
    }

    return inferState(rawValue);
  }

  private resolvedMessage(rawValue: string, state: NodelStatusState, structured: { message?: string } | null) {
    const explicitMessage = this.getAttribute('message');
    if (explicitMessage !== null) {
      return explicitMessage;
    }

    if (!this.messageSetBySignal && structured?.message) {
      return structured.message;
    }

    if (isDisplayableValue(rawValue)) {
      return rawValue;
    }

    return stateLabels[state];
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      label: (value) => this.setSignalAttribute('label', value),
      level: (value) => {
        this.levelSetBySignal = true;
        this.setSignalAttribute('level', value);
      },
      message: (value) => {
        this.messageSetBySignal = true;
        this.setSignalAttribute('message', value);
      },
      state: (value) => {
        this.stateSetBySignal = true;
        this.setSignalAttribute('state', value);
      },
      value: (value) => this.setSignalAttribute('value', value)
    });
  }

  private setSignalAttribute(name: string, value: string) {
    if (name === 'message' && !value) {
      this.messageSetBySignal = false;
      this.removeAttribute(name);
      this.render();
      return;
    }

    if (value || name === 'value' || name === 'message' || name === 'state' || name === 'level') {
      this.setAttribute(name, value);
    } else {
      this.removeAttribute(name);
    }
  }
}

if (!customElements.get('nodel-status')) {
  customElements.define('nodel-status', NodelStatus);
}
