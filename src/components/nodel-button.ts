import { callActionBindings, hasActionPhase, parseActionBindings, type ActionBinding } from '../data/action-bindings';
import { confirmRequestFromAttributes, requestConfirm, shouldConfirm } from '../data/confirm';
import { createSignalBindingController } from '../data/signal-bindings';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';

type NodelButtonVariant = 'default' | 'primary' | 'success' | 'info' | 'warning' | 'danger' | 'ghost' | 'link';
type NodelButtonArgType = 'string' | 'number' | 'boolean' | 'json';
type NodelButtonLayout = 'inline' | 'stack';
type NodelButtonSize = 'auto' | 'sm' | 'md' | 'lg';

const variants: NodelButtonVariant[] = ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost', 'link'];
const tones = ['solid', 'soft', 'outline'] as const;
const argTypes: NodelButtonArgType[] = ['string', 'number', 'boolean', 'json'];
const layouts: NodelButtonLayout[] = ['inline', 'stack'];
const sizes: NodelButtonSize[] = ['auto', 'sm', 'md', 'lg'];
const aggregatedTrue = '__nodel_aggregate_true__';
const aggregatedFalse = '__nodel_aggregate_false__';

type NodelButtonTone = (typeof tones)[number];

const variantClasses: Record<NodelButtonVariant, string> = {
  default: '',
  primary: 'nodel-button-primary',
  success: 'nodel-button-success',
  info: 'nodel-button-info',
  warning: 'nodel-button-warning',
  danger: 'nodel-button-danger',
  ghost: 'nodel-button-ghost',
  link: 'nodel-button-link'
};

const toneClasses: Record<NodelButtonTone, string> = {
  solid: '',
  soft: 'nodel-button-soft',
  outline: 'nodel-button-outline'
};

function normalizeVariant(value: string | null): NodelButtonVariant {
  return variants.includes(value as NodelButtonVariant) ? (value as NodelButtonVariant) : 'default';
}

function normalizeTone(value: string | null): NodelButtonTone {
  return tones.includes(value as NodelButtonTone) ? (value as NodelButtonTone) : 'solid';
}

function normalizeArgType(value: string | null): NodelButtonArgType {
  return argTypes.includes(value as NodelButtonArgType) ? (value as NodelButtonArgType) : 'string';
}

function normalizeLayout(value: string | null): NodelButtonLayout {
  return layouts.includes(value as NodelButtonLayout) ? (value as NodelButtonLayout) : 'inline';
}

function normalizeSize(value: string | null): NodelButtonSize {
  return sizes.includes(value as NodelButtonSize) ? (value as NodelButtonSize) : 'auto';
}

function parseBoolean(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
}

function parseArg(value: string, type: NodelButtonArgType) {
  if (type === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }

  if (type === 'boolean') {
    return parseBoolean(value);
  }

  if (type === 'json') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function valueMatches(value: string, expected: string | null) {
  if (expected === null) {
    const normalized = value.trim().toLocaleLowerCase();
    return normalized === 'active' || normalized === 'on' || normalized === 'true' || normalized === '1' || normalized === 'yes';
  }

  return value === expected;
}

function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export class NodelButton extends HTMLElement {
  static observedAttributes = [
    'variant', 'tone', 'layout', 'size', 'action', 'actions', 'action-on', 'action-off', 'join', 'arg', 'arg-type',
    'disabled', 'active', 'active-value', 'signal', 'signals', 'confirm', 'confirm-title', 'confirm-text',
    'confirm-label', 'cancel-label', 'confirm-tone', 'aria-label', 'aria-labelledby', 'title',
    'data-nodel-native-role', 'data-nodel-native-aria-selected', 'data-nodel-native-aria-checked',
    'data-nodel-native-aria-disabled', 'data-nodel-native-tabindex'
  ];

  private shellReady = false;
  private buttonNode: HTMLButtonElement | null = null;
  private contentNode: HTMLElement | null = null;
  private defaultLabel = 'Button';
  private busy = false;
  private connected = false;
  private momentaryActive = false;
  private momentaryStarting = false;
  private momentaryReleaseRequested = false;
  private ignoreNextClick = false;
  private signalBindings = createSignalBindingController(this);

  connectedCallback() {
    this.connected = true;
    this.ensureShell();
    this.render();
    this.syncSignalSubscription();
    this.addEventListener('click', this.handleClick);
    this.addEventListener('pointerdown', this.handlePointerDown);
    this.addEventListener('keydown', this.handleKeyDown);
    this.addEventListener('keyup', this.handleKeyUp);
  }

  disconnectedCallback() {
    this.connected = false;
    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('pointerdown', this.handlePointerDown);
    this.removeEventListener('keydown', this.handleKeyDown);
    this.removeEventListener('keyup', this.handleKeyUp);
    if (this.momentaryStarting) {
      this.clearMomentaryStart();
    } else {
      this.finishMomentary();
    }
    this.signalBindings.dispose();
  }

  attributeChangedCallback() {
    if (this.connected) {
      this.render();
      this.syncSignalSubscription();
    }
  }

  private render(label = this.currentLabel()) {
    this.ensureShell();
    const variant = normalizeVariant(this.getAttribute('variant'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const layout = normalizeLayout(this.getAttribute('layout'));
    const size = normalizeSize(this.getAttribute('size'));
    const active = this.hasAttribute('active');
    const disabled = this.hasAttribute('disabled') || this.busy;
    const variantClass = variantClasses[variant] ? ` ${variantClasses[variant]}` : '';
    const toneClass = toneClasses[tone] ? ` ${toneClasses[tone]}` : '';
    const stateClass = active ? ' is-active' : '';
    const busyClass = this.busy ? ' is-busy' : '';

    this.dataset.variant = variant;
    this.dataset.tone = tone;
    this.dataset.layout = layout;
    this.dataset.size = size;
    this.dataset.active = String(active);
    this.buttonNode!.className = `nodel-button nodel-button-touch${variantClass}${toneClass}${stateClass}${busyClass}`;
    this.buttonNode!.disabled = disabled;
    this.syncNativeButtonMetadata();

    const nativeRole = this.getAttribute('data-nodel-native-role');
    if (active && nativeRole !== 'option' && nativeRole !== 'radio') {
      this.buttonNode!.setAttribute('aria-pressed', 'true');
    } else {
      this.buttonNode!.removeAttribute('aria-pressed');
    }

    if (!this.contentNode?.querySelector('[data-button-label]') && !this.contentNode?.hasChildNodes()) {
      this.setLabel(label);
    }
  }

  private syncNativeButtonMetadata() {
    for (const attribute of ['aria-label', 'aria-labelledby', 'title']) {
      const value = this.getAttribute(attribute);
      if (value) {
        this.buttonNode?.setAttribute(attribute, value);
      } else {
        this.buttonNode?.removeAttribute(attribute);
      }
    }

    const nativeMappings = [
      ['data-nodel-native-role', 'role'],
      ['data-nodel-native-aria-selected', 'aria-selected'],
      ['data-nodel-native-aria-checked', 'aria-checked'],
      ['data-nodel-native-aria-disabled', 'aria-disabled'],
      ['data-nodel-native-tabindex', 'tabindex']
    ] as const;

    for (const [source, target] of nativeMappings) {
      const value = this.getAttribute(source);
      if (value !== null) {
        this.buttonNode?.setAttribute(target, value);
      } else {
        this.buttonNode?.removeAttribute(target);
      }
    }
  }

  private currentLabel() {
    return this.contentNode?.querySelector('[data-button-label]')?.textContent ?? this.defaultLabel;
  }

  private ensureShell() {
    if (this.shellReady) {
      return;
    }

    const children = Array.from(this.childNodes);
    const textLabel = children.map((child) => child.nodeType === Node.TEXT_NODE ? child.textContent?.trim() ?? '' : '').filter(Boolean).join(' ').trim();
    this.defaultLabel = textLabel || this.getAttribute('aria-label') || 'Button';

    this.innerHTML = '<button type="button"><span data-button-content class="nodel-button-content"></span></button>';
    this.buttonNode = this.querySelector('button');
    this.contentNode = this.querySelector('[data-button-content]');
    this.shellReady = true;

    for (const child of children) {
      this.appendContentChild(child);
    }

    if (!this.contentNode?.hasChildNodes()) {
      this.setLabel(this.defaultLabel);
    }
  }

  private appendContentChild(child: Node) {
    if (!this.contentNode) {
      return;
    }

    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (!text.trim()) {
        return;
      }

      const label = document.createElement('span');
      label.dataset.buttonLabel = '';
      label.textContent = text.trim();
      this.contentNode.appendChild(label);
      return;
    }

    this.contentNode.appendChild(child);
  }

  private payload() {
    if (!this.hasAttribute('arg')) {
      return {};
    }

    const arg = parseArg(this.getAttribute('arg') ?? '', normalizeArgType(this.getAttribute('arg-type')));
    return { arg };
  }

  private actionBindings() {
    return parseActionBindings({
      action: this.getAttribute('action'),
      actions: this.getAttribute('actions'),
      join: this.getAttribute('join'),
      defaultPhase: 'click',
      aliases: [
        { action: this.getAttribute('action-on'), phase: 'press' },
        { action: this.getAttribute('action-off'), phase: 'release' }
      ]
    });
  }

  private async submitActions(phase: string, bindings: ActionBinding[], options: { confirm?: boolean; busy?: boolean } = {}) {
    if (options.busy && this.busy) {
      return;
    }

    const payload = this.payload();
    if (options.confirm && shouldConfirm(this)) {
      const confirmed = await requestConfirm(this, confirmRequestFromAttributes(this, {
        title: 'Confirm action',
        text: `Run ${this.currentLabel() || 'action'}?`,
        tone: 'warning'
      }));
      if (!confirmed) {
        return;
      }
    }

    if (options.busy) {
      this.busy = true;
      this.render();
    }

    try {
      const execution = await callActionBindings(bindings, phase, payload);
      if (execution.failures.length > 0) {
        const detail = execution.failures.length === 1
          ? execution.failures[0].error ?? 'Failed to call action'
          : execution.failures.map((failure) => `${failure.action}: ${failure.error}`).join('; ');
        this.dispatchEvent(new CustomEvent('nodel-button-error', {
          bubbles: true,
          detail: { phase, payload, failures: execution.failures, error: detail }
        }));
        this.showToast({ message: 'Failed to call action', detail, tone: 'danger', durationMs: 7000 });
        return;
      }
      this.dispatchEvent(new CustomEvent('nodel-button-submitted', {
        bubbles: true,
        detail: { action: bindings[0]?.action ?? '', phase, payload, results: execution.results }
      }));
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to call action');
      this.dispatchEvent(new CustomEvent('nodel-button-error', {
        bubbles: true,
        detail: { phase, payload, error: message }
      }));
      this.showToast({ message: 'Failed to call action', detail: message, tone: 'danger', durationMs: 7000 });
    } finally {
      if (options.busy) {
        this.busy = false;
      }
      if (this.isConnected && options.busy) {
        this.render();
      }
    }
  }

  private setActiveFromValue(value: string) {
    if (value === aggregatedTrue) {
      this.setAttribute('active', '');
      return;
    }
    if (value === aggregatedFalse) {
      this.removeAttribute('active');
      return;
    }

    const expected = this.getAttribute('active-value') ?? this.getAttribute('arg');
    if (valueMatches(value, expected)) {
      this.setAttribute('active', '');
    } else {
      this.removeAttribute('active');
    }
  }

  private setDisabledFromValue(value: string) {
    if (valueMatches(value, null)) {
      this.setAttribute('disabled', '');
    } else {
      this.removeAttribute('disabled');
    }
  }

  private setLabel(value: string) {
    this.ensureShell();
    const label = value || this.defaultLabel;
    const labels = Array.from(this.contentNode?.querySelectorAll<HTMLElement>('[data-button-label]') ?? []);

    if (labels.length === 0) {
      const labelNode = document.createElement('span');
      labelNode.dataset.buttonLabel = '';
      labelNode.textContent = label;
      this.contentNode?.appendChild(labelNode);
      return;
    }

    labels[0].textContent = label;
    for (const extra of labels.slice(1)) {
      extra.textContent = '';
    }
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'active', {
      active: (value) => this.setActiveFromValue(value),
      disabled: (value) => this.setDisabledFromValue(value),
      label: (value) => this.setLabel(value)
    }, {
      join: this.getAttribute('join'),
      aggregators: {
        active: {
          evaluate: (value) => {
            const expected = this.getAttribute('active-value') ?? this.getAttribute('arg');
            return valueMatches(value, expected);
          },
          format: (value) => value ? aggregatedTrue : aggregatedFalse
        },
        disabled: { evaluate: (value) => valueMatches(value, null) }
      }
    });
  }

  private showToast(detail: NodelToastDetail) {
    this.dispatchEvent(new CustomEvent<NodelToastDetail>(NODEL_TOAST, {
      bubbles: true,
      detail
    }));
  }

  private handleClick = (event: Event) => {
    if (event.target !== this.buttonNode && !this.buttonNode?.contains(event.target as Node)) {
      return;
    }

    const bindings = this.actionBindings();
    if (this.hasAttribute('disabled') || bindings.length === 0) {
      return;
    }

    const hasMomentary = hasActionPhase(bindings, 'press') || hasActionPhase(bindings, 'release');
    if (this.ignoreNextClick) {
      this.ignoreNextClick = false;
      if (!hasActionPhase(bindings, 'click')) {
        event.preventDefault();
        return;
      }
    }

    if (hasMomentary && !hasActionPhase(bindings, 'click')) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    void this.submitActions('click', bindings, { confirm: true, busy: true });
  };

  private isMomentary(bindings = this.actionBindings()) {
    return hasActionPhase(bindings, 'press') || hasActionPhase(bindings, 'release');
  }

  private async startMomentary(event?: Event) {
    const bindings = this.actionBindings();
    if (!this.isMomentary(bindings) || this.momentaryActive || this.momentaryStarting || this.hasAttribute('disabled')) {
      return;
    }
    if (!hasActionPhase(bindings, 'click')) {
      event?.preventDefault();
    }
    this.ignoreNextClick = true;
    this.momentaryStarting = true;
    this.momentaryReleaseRequested = false;
    document.addEventListener('pointerup', this.handleDocumentPointerUp);
    document.addEventListener('pointercancel', this.handleDocumentPointerUp);
    window.addEventListener('blur', this.handleWindowBlur);

    if (shouldConfirm(this)) {
      const confirmed = await requestConfirm(this, confirmRequestFromAttributes(this, {
        title: 'Confirm action',
        text: `Run ${this.currentLabel() || 'action'}?`,
        tone: 'warning'
      }));
      if (!confirmed) {
        this.clearMomentaryStart();
        return;
      }
    }

    this.momentaryStarting = false;
    this.momentaryActive = true;
    this.setAttribute('active', '');
    void this.submitActions('press', bindings);
    if (this.momentaryReleaseRequested) {
      this.finishMomentary();
    }
  }

  private finishMomentary() {
    if (this.momentaryStarting && !this.momentaryActive) {
      this.momentaryReleaseRequested = true;
      return;
    }
    if (!this.momentaryActive) {
      return;
    }
    this.momentaryActive = false;
    this.removeAttribute('active');
    this.clearMomentaryStart();
    void this.submitActions('release', this.actionBindings());
  }

  private clearMomentaryStart() {
    this.momentaryStarting = false;
    this.momentaryReleaseRequested = false;
    document.removeEventListener('pointerup', this.handleDocumentPointerUp);
    document.removeEventListener('pointercancel', this.handleDocumentPointerUp);
    window.removeEventListener('blur', this.handleWindowBlur);
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (event.target === this.buttonNode || this.buttonNode?.contains(event.target as Node)) {
      this.startMomentary(event);
    }
  };

  private handleDocumentPointerUp = () => this.finishMomentary();
  private handleWindowBlur = () => this.finishMomentary();

  private handleKeyDown = (event: KeyboardEvent) => {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      this.startMomentary(event);
    }
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    if (event.key === ' ' || event.key === 'Enter') {
      this.finishMomentary();
    }
  };
}

if (!customElements.get('nodel-button')) {
  customElements.define('nodel-button', NodelButton);
}
