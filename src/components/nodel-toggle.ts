import { parseActionBindings } from '../data/action-bindings';
import {
  actionErrorMessage,
  actionName,
  buildActionPayload,
  ControlActionController,
  dispatchControlActionError,
  executeActionPhases
} from '../data/control-actions';
import { confirmRequestFromAttributes, requestConfirm, shouldConfirm } from '../data/confirm';
import { createSignalBindingController } from '../data/signal-bindings';
import { iconForName, renderFontAwesomeIcon } from '../icons/fontawesome';
import { syncInternalAccessibleLabel } from '../utils/accessibility';
import { trimPointReference } from '../utils/edge-whitespace';
import { isToggleOnish, resolveToggleState, toggleAriaChecked, type ToggleState } from '../utils/toggle-state';

type NodelToggleVariant = 'default' | 'primary' | 'success' | 'info' | 'warning' | 'danger';
type NodelToggleTone = 'solid' | 'soft' | 'outline';
type NodelToggleArgType = 'string' | 'number' | 'boolean' | 'json';
type NodelToggleStateLabel = 'show' | 'hide';

const variants: NodelToggleVariant[] = ['default', 'primary', 'success', 'info', 'warning', 'danger'];
const tones: NodelToggleTone[] = ['solid', 'soft', 'outline'];
const argTypes: NodelToggleArgType[] = ['string', 'number', 'boolean', 'json'];
const stateLabels: NodelToggleStateLabel[] = ['show', 'hide'];

function normalizeVariant(value: string | null): NodelToggleVariant {
  return variants.includes(value as NodelToggleVariant) ? (value as NodelToggleVariant) : 'success';
}

function normalizeOffVariant(value: string | null): NodelToggleVariant {
  return variants.includes(value as NodelToggleVariant) ? (value as NodelToggleVariant) : 'default';
}

function normalizeTone(value: string | null): NodelToggleTone {
  return tones.includes(value as NodelToggleTone) ? (value as NodelToggleTone) : 'solid';
}

function normalizeArgType(value: string | null): NodelToggleArgType {
  return argTypes.includes(value as NodelToggleArgType) ? (value as NodelToggleArgType) : 'boolean';
}

function normalizeStateLabel(value: string | null): NodelToggleStateLabel {
  return stateLabels.includes(value as NodelToggleStateLabel) ? (value as NodelToggleStateLabel) : 'hide';
}

export class NodelToggle extends HTMLElement {
  static observedAttributes = [
    'action', 'actions', 'join', 'on-arg', 'off-arg', 'arg-type', 'signal', 'signals', 'value', 'on-value', 'off-value',
    'partial-on-value', 'partial-off-value', 'label', 'on-label', 'off-label', 'on-icon', 'off-icon', 'state-label', 'variant', 'off-variant', 'tone',
    'disabled', 'confirm', 'confirm-title', 'confirm-text', 'confirm-label', 'cancel-label', 'confirm-tone', 'confirm-mode', 'confirm-code-signal',
    'aria-label', 'aria-labelledby', 'title'
  ];

  private buttonNode: HTMLButtonElement | null = null;
  private stateIconNode: HTMLElement | null = null;
  private stateNode: HTMLElement | null = null;
  private busy = false;
  private state: ToggleState = 'off';
  private signalBindings = createSignalBindingController(this);
  private actionController = new ControlActionController();

  connectedCallback() {
    this.actionController.connect();
    this.ensureShell();
    this.render();
    this.syncSignalSubscription();
    this.addEventListener('click', this.handleClick);
  }

  disconnectedCallback() {
    this.actionController.disconnect();
    this.busy = false;
    this.removeEventListener('click', this.handleClick);
    this.signalBindings.dispose();
  }

  attributeChangedCallback(name: string) {
    if (name === 'value') {
      this.state = this.stateFromValue(this.getAttribute('value') ?? '');
    }

    if (this.isConnected) {
      this.render();
      this.syncSignalSubscription();
    }
  }

  private ensureShell() {
    if (this.buttonNode) {
      return;
    }

    const initialText = Array.from(this.childNodes)
      .map((child) => child.nodeType === Node.TEXT_NODE ? child.textContent?.trim() ?? '' : '')
      .filter(Boolean)
      .join(' ')
      .trim();
    if (initialText && !this.hasAttribute('label')) {
      this.setAttribute('label', initialText);
    }

    this.innerHTML = `
      <button type="button" class="nodel-toggle" role="switch">
        <span class="nodel-toggle-track" aria-hidden="true"><span class="nodel-toggle-thumb"><span class="nodel-toggle-state-icon" data-toggle-state-icon hidden></span></span></span>
        <span class="nodel-toggle-state-content" aria-hidden="true">
          <span class="nodel-toggle-state" data-toggle-state></span>
        </span>
      </button>
    `;
    this.buttonNode = this.querySelector('button');
    this.stateIconNode = this.querySelector('[data-toggle-state-icon]');
    this.stateNode = this.querySelector('[data-toggle-state]');
  }

  private render() {
    this.ensureShell();
    const variant = normalizeVariant(this.getAttribute('variant'));
    const offVariant = normalizeOffVariant(this.getAttribute('off-variant'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const stateLabelMode = normalizeStateLabel(this.getAttribute('state-label'));
    const disabled = this.hasAttribute('disabled') || this.busy;
    const label = this.getAttribute('label') || this.getAttribute('aria-label') || 'Toggle';
    const onLabel = this.getAttribute('on-label') || 'On';
    const offLabel = this.getAttribute('off-label') || 'Off';
    const onish = isToggleOnish(this.state);
    const stateLabel = onish ? onLabel : offLabel;
    const stateIcon = iconForName(onish ? this.getAttribute('on-icon') : this.getAttribute('off-icon'));

    this.dataset.state = this.state;
    this.dataset.variant = variant;
    this.dataset.offVariant = offVariant;
    this.dataset.tone = tone;
    this.dataset.stateLabel = stateLabelMode;
    this.dataset.disabled = String(disabled);

    this.buttonNode!.className = `nodel-toggle${this.busy ? ' is-busy' : ''}`;
    this.buttonNode!.disabled = disabled;
    this.buttonNode!.setAttribute('aria-checked', toggleAriaChecked(this.state));
    syncInternalAccessibleLabel(this, this.buttonNode!, label);

    for (const attribute of ['title']) {
      const value = this.getAttribute(attribute);
      if (value) {
        this.buttonNode!.setAttribute(attribute, value);
      } else {
        this.buttonNode!.removeAttribute(attribute);
      }
    }

    if (this.stateNode) {
      this.stateNode.hidden = stateLabelMode !== 'show';
      this.stateNode.textContent = stateLabelMode === 'show'
        ? (this.state.startsWith('partially-') ? `Partial ${stateLabel}` : stateLabel)
        : '';
    }
    if (this.stateIconNode) {
      this.stateIconNode.hidden = !stateIcon;
      this.stateIconNode.innerHTML = stateIcon ? renderFontAwesomeIcon(stateIcon, 'h-full w-full') : '';
    }
  }

  private payloadFor(nextOn: boolean) {
    const raw = nextOn
      ? this.getAttribute('on-arg') ?? 'true'
      : this.getAttribute('off-arg') ?? 'false';
    return buildActionPayload(raw, normalizeArgType(this.getAttribute('arg-type')));
  }

  private async submitAction(action: string) {
    const scope = this.actionController.captureScope();
    if (!scope || !this.actionController.startSingleFlight(scope)) {
      return;
    }

    try {
      const nextOn = !isToggleOnish(this.state);
      const bindings = parseActionBindings({
        action: this.getAttribute('action'),
        actions: this.getAttribute('actions'),
        join: this.getAttribute('join'),
        defaultPhase: 'toggle'
      });
      const phase = nextOn ? 'on' : 'off';
      const phases = ['toggle', phase];
      const payloadResult = this.payloadFor(nextOn);
      if (!payloadResult.ok) {
        dispatchControlActionError(this, {
          eventName: 'nodel-toggle-error',
          action: actionName(bindings, action),
          phase,
          phases,
          value: phase,
          payload: {},
          committed: true,
          live: false,
          error: payloadResult.error
        });
        return;
      }
      const payload = payloadResult.payload;
      if (shouldConfirm(this)) {
        const confirmed = await requestConfirm(this, confirmRequestFromAttributes(this, {
          title: 'Confirm toggle',
          text: `Set ${this.getAttribute('label') || 'toggle'} ${nextOn ? 'on' : 'off'}?`,
          tone: nextOn ? 'success' : 'info'
        }), this.buttonNode, scope.signal);
        if (!confirmed || !scope.isCurrent()) {
          return;
        }
      }

      if (!scope.isCurrent()) {
        return;
      }
      this.busy = true;
      this.render();

      try {
        const execution = await executeActionPhases(bindings, phases, payload, scope);
        if (!scope.isCurrent()) {
          return;
        }
        if (execution.failures.length > 0) {
          dispatchControlActionError(this, {
            eventName: 'nodel-toggle-error',
            action: actionName(bindings, action),
            phase,
            phases,
            value: phase,
            payload,
            arg: payloadResult.arg,
            committed: true,
            live: false,
            results: execution.results,
            failures: execution.failures
          });
          return;
        }
        this.dispatchEvent(new CustomEvent('nodel-toggle-change', {
          bubbles: true,
          detail: { action: actionName(bindings, action), phase, phases, state: phase, value: phase, arg: payloadResult.arg, payload, results: execution.results, failures: [], committed: true, live: false }
        }));
      } catch (error) {
        if (!scope.isCurrent()) {
          return;
        }
        dispatchControlActionError(this, {
          eventName: 'nodel-toggle-error',
          action: actionName(bindings, action),
          phase,
          phases,
          value: phase,
          payload,
          arg: payloadResult.arg,
          committed: true,
          live: false,
          error: actionErrorMessage(error)
        });
      } finally {
        if (scope.isCurrent()) {
          this.busy = false;
          this.render();
        }
      }
    } finally {
      this.actionController.finishSingleFlight(scope);
      if (!this.busy && scope.isCurrent()) {
        this.render();
      }
    }
  }

  private stateFromValue(value: string) {
    return resolveToggleState(value, {
      onValue: this.getAttribute('on-value'),
      offValue: this.getAttribute('off-value'),
      partialOnValue: this.getAttribute('partial-on-value'),
      partialOffValue: this.getAttribute('partial-off-value')
    });
  }

  private setStateFromValue(value: string) {
    this.state = this.stateFromValue(value);
    this.setAttribute('value', value);
    this.render();
  }

  private setDisabledFromValue(value: string) {
    const disabled = resolveToggleState(value) === 'on';
    if (disabled) {
      this.setAttribute('disabled', '');
    } else {
      this.removeAttribute('disabled');
    }
  }

  private setLabel(value: string) {
    this.setAttribute('label', value);
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'state', {
      state: (value) => this.setStateFromValue(value),
      disabled: (value) => this.setDisabledFromValue(value),
      label: (value) => this.setLabel(value)
    }, {
      join: this.getAttribute('join'),
      aggregators: {
        disabled: { evaluate: (value) => resolveToggleState(value) === 'on' }
      }
    });
  }

  private handleClick = (event: Event) => {
    if (event.target !== this.buttonNode && !this.buttonNode?.contains(event.target as Node)) {
      return;
    }

    const action = trimPointReference(this.getAttribute('action') ?? '') || trimPointReference(this.getAttribute('join') ?? '');
    const bindings = parseActionBindings({ action: this.getAttribute('action'), actions: this.getAttribute('actions'), join: this.getAttribute('join'), defaultPhase: 'toggle' });
    if (bindings.length === 0 || this.hasAttribute('disabled')) {
      return;
    }

    event.preventDefault();
    void this.submitAction(action);
  };
}

if (!customElements.get('nodel-toggle')) {
  customElements.define('nodel-toggle', NodelToggle);
}
