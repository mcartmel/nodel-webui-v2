import { callActionBindings, parseActionBindings } from '../data/action-bindings';
import { confirmRequestFromAttributes, requestConfirm, shouldConfirm } from '../data/confirm';
import { DynamicOptionsController, type DynamicOptionsState } from '../data/dynamic-options';
import { createSignalBindingController, parseSignalBindings, signalBindingKey } from '../data/signal-bindings';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';
import { syncHostAccessibleLabel } from '../utils/accessibility';
import { parseTypedArg, type ControlArgType } from '../utils/control-values';
import './nodel-button';

type NodelSegmentedArgType = ControlArgType;
type NodelSegmentedOrientation = 'horizontal' | 'vertical';
type NodelSegmentedVariant = 'default' | 'primary' | 'success' | 'info' | 'warning' | 'danger';
type NodelSegmentedTone = 'solid' | 'soft' | 'outline';

const argTypes: NodelSegmentedArgType[] = ['string', 'number', 'boolean', 'json'];
const orientations: NodelSegmentedOrientation[] = ['horizontal', 'vertical'];
const variants: NodelSegmentedVariant[] = ['default', 'primary', 'success', 'info', 'warning', 'danger'];
const tones: NodelSegmentedTone[] = ['solid', 'soft', 'outline'];

function normalizeArgType(value: string | null): NodelSegmentedArgType {
  return argTypes.includes(value as NodelSegmentedArgType) ? (value as NodelSegmentedArgType) : 'string';
}

function normalizeOrientation(value: string | null): NodelSegmentedOrientation {
  return orientations.includes(value as NodelSegmentedOrientation) ? (value as NodelSegmentedOrientation) : 'horizontal';
}

function normalizeVariant(value: string | null): NodelSegmentedVariant {
  return variants.includes(value as NodelSegmentedVariant) ? (value as NodelSegmentedVariant) : 'primary';
}

function normalizeTone(value: string | null): NodelSegmentedTone {
  return tones.includes(value as NodelSegmentedTone) ? (value as NodelSegmentedTone) : 'solid';
}

function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function valueMatches(value: string, expected: string) {
  return String(value) === String(expected);
}

function optionEnabled(option: HTMLElement) {
  return !option.hasAttribute('disabled');
}

export class NodelSegmented extends HTMLElement {
  static observedAttributes = [
    'action', 'actions', 'join', 'arg-type', 'signal', 'signals', 'options-signal', 'options-loading-label', 'options-empty-label', 'options-error-label', 'value', 'variant', 'tone', 'orientation', 'disabled',
    'allow-deselect', 'label', 'aria-label', 'aria-labelledby', 'confirm', 'confirm-title', 'confirm-text', 'confirm-label', 'cancel-label', 'confirm-tone'
  ];

  private connected = false;
  private busy = false;
  private signalBindings = createSignalBindingController(this);
  private dynamicOptions: DynamicOptionsController | null = null;
  private statusNode: HTMLElement | null = null;
  private optionsState: DynamicOptionsState = 'static';
  private optionsBindingKey = '';
  private optionsSourceError = false;

  connectedCallback() {
    this.connected = true;
    this.classList.add('nodel-segmented');
    this.setAttribute('role', 'radiogroup');
    this.ensureDynamicOptions();
    this.render();
    this.syncSignalSubscription();
    this.addEventListener('click', this.handleClick, true);
    this.addEventListener('keydown', this.handleKeyDown);
  }

  disconnectedCallback() {
    this.connected = false;
    this.removeEventListener('click', this.handleClick, true);
    this.removeEventListener('keydown', this.handleKeyDown);
    this.signalBindings.dispose();
    this.dynamicOptions?.dispose();
    this.optionsBindingKey = '';
    this.optionsSourceError = false;
  }

  attributeChangedCallback() {
    if (this.connected) {
      this.render();
      this.syncSignalSubscription();
    }
  }

  private render() {
    this.ensureDynamicOptions();
    const value = this.getAttribute('value') ?? '';
    const disabled = this.hasAttribute('disabled') || this.busy;
    const variant = normalizeVariant(this.getAttribute('variant'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const orientation = normalizeOrientation(this.getAttribute('orientation'));

    this.dataset.value = value;
    this.dataset.variant = variant;
    this.dataset.tone = tone;
    this.dataset.orientation = orientation;
    this.dataset.disabled = String(disabled);
    this.dataset.optionsState = this.optionsState;
    this.setAttribute('aria-orientation', orientation);
    syncHostAccessibleLabel(this, 'Segmented control');
    this.syncStatus();

    const options = this.options();
    if (options.length > 0 && this.dataset.segmentedFocusSentinel === 'true') {
      this.removeAttribute('tabindex');
      delete this.dataset.segmentedFocusSentinel;
    }
    const selected = options.find((option) => valueMatches(value, this.optionValue(option)) && value !== '');
    const firstEnabled = options.find((option) => optionEnabled(option));
    const tabbable = selected && optionEnabled(selected) ? selected : firstEnabled ?? options[0] ?? null;
    for (const option of options) {
      const optionValue = this.optionValue(option);
      const active = valueMatches(value, optionValue) && value !== '';
      option.dataset.segmentedOption = '';
      option.dataset.segmentedValue = optionValue;
      option.setAttribute('data-nodel-native-role', 'radio');
      option.setAttribute('data-nodel-native-aria-checked', String(active));
      option.setAttribute('data-nodel-native-tabindex', option === tabbable && !disabled && optionEnabled(option) ? '0' : '-1');
      option.setAttribute('size', option.getAttribute('size') ?? 'md');
      if (active) {
        option.setAttribute('active', '');
        this.syncInheritedOptionAttribute(option, 'variant', variant, true);
        this.syncInheritedOptionAttribute(option, 'tone', tone, true);
      } else {
        option.removeAttribute('active');
        this.syncInheritedOptionAttribute(option, 'variant', variant, false);
        this.syncInheritedOptionAttribute(option, 'tone', tone, false);
      }
      if (disabled) {
        option.setAttribute('data-nodel-native-aria-disabled', 'true');
      } else {
        option.removeAttribute('data-nodel-native-aria-disabled');
      }
    }
  }

  private options() {
    return Array.from(this.children).filter((child): child is HTMLElement => child.localName === 'nodel-button');
  }

  private ensureDynamicOptions() {
    if (!this.statusNode) {
      this.statusNode = document.createElement('div');
      this.statusNode.className = 'nodel-options-status';
      this.statusNode.setAttribute('aria-live', 'polite');
      this.statusNode.hidden = true;
      this.appendChild(this.statusNode);
    }
    if (!this.dynamicOptions) {
      this.dynamicOptions = new DynamicOptionsController(this, (option) => {
        const node = document.createElement('nodel-button');
        node.setAttribute('value', option.value);
        node.textContent = option.label;
        return node;
      });
    }
  }

  private stateLabel() {
    if (this.optionsState === 'loading') {
      return this.getAttribute('options-loading-label') || 'Loading options...';
    }
    if (this.optionsState === 'empty') {
      return this.getAttribute('options-empty-label') || 'No options';
    }
    if (this.optionsState === 'error') {
      return this.getAttribute('options-error-label') || 'Options unavailable';
    }
    return '';
  }

  private syncStatus() {
    if (!this.statusNode) {
      return;
    }
    const label = this.stateLabel();
    const showStatus = Boolean(label) && !(this.optionsState === 'loading' && this.dynamicOptions?.hasFallbackOptions());
    this.statusNode.textContent = showStatus ? label : '';
    this.statusNode.hidden = !showStatus;
    this.statusNode.dataset.state = this.optionsState;
  }

  private syncInheritedOptionAttribute(option: HTMLElement, name: 'variant' | 'tone', value: string, active: boolean) {
    const marker = `data-nodel-segmented-inherited-${name}`;
    const inheritedValue = option.getAttribute(marker);

    if (!active) {
      if (inheritedValue !== null && option.getAttribute(name) === inheritedValue) {
        option.removeAttribute(name);
      }
      option.removeAttribute(marker);
      return;
    }

    if (inheritedValue !== null && option.getAttribute(name) !== inheritedValue) {
      // An author update supersedes a value previously provided by the group.
      option.removeAttribute(marker);
      return;
    }

    if (!option.hasAttribute(name) || inheritedValue !== null) {
      option.setAttribute(name, value);
      option.setAttribute(marker, value);
    }
  }

  private optionFromEvent(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return null;
    }

    const option = target.closest<HTMLElement>('nodel-button');
    return option && option.parentElement === this ? option : null;
  }

  private optionValue(option: HTMLElement) {
    return option.getAttribute('value') ?? option.getAttribute('arg') ?? option.textContent?.trim() ?? '';
  }

  private async selectOption(option: HTMLElement) {
    if (this.busy || this.hasAttribute('disabled') || !optionEnabled(option)) {
      return;
    }

    const optionValue = this.optionValue(option);
    const currentValue = this.getAttribute('value') ?? '';
    const nextValue = currentValue === optionValue && this.hasAttribute('allow-deselect') ? '' : optionValue;
    const action = this.getAttribute('action')?.trim() || this.getAttribute('join')?.trim() || '';
    const bindings = parseActionBindings({ action: this.getAttribute('action'), actions: this.getAttribute('actions'), join: this.getAttribute('join'), defaultPhase: 'select' });
    const payload = { arg: parseTypedArg(nextValue, normalizeArgType(this.getAttribute('arg-type'))) };
    const confirmSource = shouldConfirm(option) ? option : this;

    if (shouldConfirm(confirmSource)) {
      const confirmed = await requestConfirm(confirmSource, confirmRequestFromAttributes(confirmSource, {
        title: 'Confirm selection',
        text: `Select ${option.textContent?.trim() || nextValue}?`,
        tone: 'info'
      }));
      if (!confirmed) {
        return;
      }
    }

    if (bindings.length === 0) {
      this.setAttribute('value', nextValue);
      this.dispatchChange(action, payload, nextValue);
      return;
    }

    this.busy = true;
    this.render();
    try {
      const execution = await callActionBindings(bindings, 'select', payload);
      if (execution.failures.length > 0) {
        const detail = execution.failures.length === 1
          ? execution.failures[0].error ?? 'Failed to call action'
          : execution.failures.map((failure) => `${failure.action}: ${failure.error}`).join('; ');
        this.dispatchEvent(new CustomEvent('nodel-segmented-error', {
          bubbles: true,
          detail: { action, value: nextValue, payload, failures: execution.failures, error: detail }
        }));
        this.showToast({ message: 'Failed to call action', detail, tone: 'danger', durationMs: 7000 });
        return;
      }
      this.setAttribute('value', nextValue);
      this.dispatchChange(action, payload, nextValue);
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to call action');
      this.dispatchEvent(new CustomEvent('nodel-segmented-error', {
        bubbles: true,
        detail: { action, value: nextValue, payload, error: message }
      }));
      this.showToast({ message: 'Failed to call action', detail: message, tone: 'danger', durationMs: 7000 });
    } finally {
      this.busy = false;
      if (this.isConnected) {
        this.render();
      }
    }
  }

  private dispatchChange(action: string, payload: { arg: unknown }, value: string) {
    this.dispatchEvent(new CustomEvent('nodel-segmented-change', {
      bubbles: true,
      detail: { action, value, arg: payload.arg, payload }
    }));
  }

  private setDisabledFromValue(value: string) {
    const normalized = value.trim().toLocaleLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes') {
      this.setAttribute('disabled', '');
    } else {
      this.removeAttribute('disabled');
    }
  }

  private syncSignalSubscription() {
    const nextOptionsBindingKey = this.optionsBindingIdentity();
    const hasOptionsBinding = nextOptionsBindingKey !== '';
    const optionsBindingChanged = nextOptionsBindingKey !== this.optionsBindingKey;
    if (optionsBindingChanged) {
      if (this.optionsBindingKey !== '' || nextOptionsBindingKey === '') {
        this.dynamicOptions?.clear();
      }
      this.optionsSourceError = false;
      this.optionsBindingKey = nextOptionsBindingKey;
    }
    const nextState = this.dynamicOptions?.setBindingActive(hasOptionsBinding) ?? 'static';
    this.setOptionsState(this.optionsSourceError && hasOptionsBinding ? 'error' : nextState);
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      value: (value) => this.setAttribute('value', value),
      disabled: (value) => this.setDisabledFromValue(value),
      label: (value) => this.setAttribute('label', value),
      options: (_value, rawValue) => this.applyDynamicOptions(rawValue)
    }, {
      join: this.getAttribute('join'),
      optionsSignal: this.getAttribute('options-signal'),
      aggregators: {
        disabled: { evaluate: (value) => ['true', '1', 'on', 'yes'].includes(value.trim().toLocaleLowerCase()) }
      },
      onSourceState: (state) => {
        if (!this.hasOptionsBinding()) {
          return;
        }
        if (state.error) {
          this.optionsSourceError = true;
          this.setOptionsState('error');
          this.render();
        } else if (state.loading && this.dynamicOptions?.getState() === 'loading') {
          this.optionsSourceError = false;
          this.setOptionsState('loading');
          this.render();
        } else {
          this.optionsSourceError = false;
          this.setOptionsState(this.dynamicOptions?.getState() ?? 'static');
          this.render();
        }
      }
    });
    if (optionsBindingChanged) {
      this.render();
    }
  }

  private hasOptionsBinding() {
    return this.optionsBindingIdentity() !== '';
  }

  private optionsBindingIdentity() {
    return signalBindingKey(parseSignalBindings(null, this.getAttribute('signals'), undefined, null, this.getAttribute('options-signal')).filter((binding) => binding.target === 'options' && binding.mode === 'last'));
  }

  private setOptionsState(state: DynamicOptionsState) {
    this.optionsState = state;
    this.dataset.optionsState = state;
    this.syncStatus();
  }

  private applyDynamicOptions(rawValue: unknown) {
    const result = this.dynamicOptions!.applyPayload(rawValue);
    this.setOptionsState(result.state);
    if (result.ok) {
      if (result.removedFocused) {
        this.recoverFocusAfterRemoval(result.removedFocusedIndex);
      } else if (result.retainedFocused) {
        this.focusOption(this.options().find((option) => this.optionValue(option) === result.previousFocusedValue));
      }
      this.dispatchEvent(new CustomEvent('nodel-options-updated', { bubbles: true, detail: { count: result.count, state: result.state } }));
    } else {
      this.dispatchEvent(new CustomEvent('nodel-options-error', { bubbles: true, detail: { message: result.issues[0]?.message ?? 'Invalid options payload', issues: result.issues } }));
    }
    this.render();
  }

  private recoverFocusAfterRemoval(previousIndex: number) {
    const options = this.options();
    if (options.length === 0) {
      this.dataset.segmentedFocusSentinel = 'true';
      this.setAttribute('tabindex', '-1');
      this.focus();
      return;
    }
    const selected = options.find((option) => option.hasAttribute('active'));
    this.focusOption(options[Math.min(previousIndex, options.length - 1)] ?? selected ?? options[0]);
  }

  private showToast(detail: NodelToastDetail) {
    this.dispatchEvent(new CustomEvent<NodelToastDetail>(NODEL_TOAST, {
      bubbles: true,
      detail
    }));
  }

  private handleClick = (event: Event) => {
    const option = this.optionFromEvent(event);
    if (!option) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void this.selectOption(option);
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    const option = this.optionFromEvent(event);
    if (!option || this.busy || this.hasAttribute('disabled') || !optionEnabled(option)) {
      return;
    }
    const options = this.options();
    const enabledOptions = options.filter((item) => optionEnabled(item));
    const currentIndex = enabledOptions.indexOf(option);
    if (currentIndex === -1 || enabledOptions.length === 0) {
      return;
    }
    const orientation = normalizeOrientation(this.getAttribute('orientation'));
    const previousKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';

    if (event.key === 'Home') {
      event.preventDefault();
      void this.selectAndFocus(enabledOptions[0]);
    } else if (event.key === 'End') {
      event.preventDefault();
      void this.selectAndFocus(enabledOptions[enabledOptions.length - 1]);
    } else if (event.key === previousKey || event.key === nextKey) {
      event.preventDefault();
      const offset = event.key === nextKey ? 1 : -1;
      const nextIndex = (currentIndex + offset + enabledOptions.length) % enabledOptions.length;
      void this.selectAndFocus(enabledOptions[nextIndex]);
    }
  };

  private async selectAndFocus(option: HTMLElement | undefined) {
    if (!option) {
      return;
    }
    this.focusOption(option);
    await this.selectOption(option);
  }

  private focusOption(option: HTMLElement | null | undefined) {
    if (!option) {
      return;
    }
    for (const item of this.options()) {
      item.setAttribute('data-nodel-native-tabindex', item === option ? '0' : '-1');
    }
    (option.querySelector('button') as HTMLButtonElement | null)?.focus();
  }
}

if (!customElements.get('nodel-segmented')) {
  customElements.define('nodel-segmented', NodelSegmented);
}
