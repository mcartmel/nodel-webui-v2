import { callActionBindings, parseActionBindings } from '../data/action-bindings';
import { actionName, buildActionPayload, ControlActionController, formatActionFailures } from '../data/control-actions';
import type { ActionBindingResult } from '../data/action-bindings';
import type { ControlArgType } from '../utils/control-values';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';

const actionArgTypes: ControlArgType[] = ['string', 'number', 'boolean', 'json'];

function normalizeArgType(value: string | null): ControlArgType {
  return actionArgTypes.includes(value as ControlArgType) ? value as ControlArgType : 'string';
}

export class NodelPage extends HTMLElement {
  static observedAttributes = ['title'];

  private shellReady = false;
  private actionController = new ControlActionController();
  private groupPage = false;
  private contentNode: HTMLElement | null = null;

  connectedCallback() {
    this.actionController.connect();
    this.render();
  }

  disconnectedCallback() {
    this.actionController.disconnect();
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
    }
  }

  async activate() {
    const scope = this.actionController.captureScope();
    if (!scope) {
      return;
    }
    const bindings = parseActionBindings({
      action: this.getAttribute('action'),
      actions: this.getAttribute('actions'),
      defaultPhase: 'activate'
    });
    const action = actionName(bindings);
    if (bindings.length === 0) {
      return;
    }
    const payloadResult = buildActionPayload(this.hasAttribute('arg') ? this.getAttribute('arg') ?? '' : null, normalizeArgType(this.getAttribute('arg-type')));
    if (!payloadResult.ok) {
      this.dispatchPageActionError({ action, payload: {}, results: [], failures: [], error: payloadResult.error });
      return;
    }
    const payload = payloadResult.payload;
    try {
      const execution = await callActionBindings(bindings, 'activate', payload, scope);
      if (scope.isCurrent() && execution.failures.length > 0) {
        this.dispatchPageActionError({ action, payload, arg: payloadResult.arg, results: execution.results, failures: execution.failures, error: formatActionFailures(execution.failures) });
      }
    } catch (error) {
      if (scope.isCurrent()) {
        throw error;
      }
    }
  }

  private dispatchPageActionError(options: { action: string; payload: Record<string, unknown>; arg?: unknown; results: ActionBindingResult[]; failures: ActionBindingResult[]; error: string }) {
    this.dispatchEvent(new CustomEvent('nodel-page-action-error', {
      bubbles: true,
      composed: true,
      detail: {
        action: options.action,
        phase: 'activate',
        phases: ['activate'],
        arg: options.arg,
        payload: options.payload,
        results: options.results,
        failures: options.failures,
        committed: true,
        live: false,
        error: options.error
      }
    }));
    this.dispatchEvent(new CustomEvent<NodelToastDetail>(NODEL_TOAST, {
      bubbles: true,
      composed: true,
      detail: {
        message: 'Page action failed',
        detail: options.error,
        tone: 'danger',
        durationMs: 7000
      }
    }));
  }

  private render() {
    const children = this.shellReady ? [] : Array.from(this.childNodes);

    if (!this.shellReady) {
      this.groupPage = children.some(
        (child) => child instanceof HTMLElement && child.localName === 'nodel-page'
      );

      this.dataset.navGroupPage = String(this.groupPage);
      this.innerHTML = this.groupPage
        ? `<div data-page-content class="contents"></div>`
        : `
          <section data-page-content class="nodel-shell space-y-6 pb-6 pt-6">
          </section>
        `;
      this.contentNode = this.querySelector('[data-page-content]');
      this.shellReady = true;
      if (this.contentNode) {
        for (const child of children) {
          this.contentNode.appendChild(child);
        }
      }
    }
  }
}

if (!customElements.get('nodel-page')) {
  customElements.define('nodel-page', NodelPage);
}
