import { callActionBindings, parseActionArg, parseActionBindings, type ActionArgType } from '../data/action-bindings';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';

const actionArgTypes: ActionArgType[] = ['string', 'number', 'boolean', 'json'];

function normalizeArgType(value: string | null): ActionArgType {
  return actionArgTypes.includes(value as ActionArgType) ? value as ActionArgType : 'string';
}

export class NodelPage extends HTMLElement {
  static observedAttributes = ['title'];

  private shellReady = false;
  private activationGeneration = 0;
  private groupPage = false;
  private contentNode: HTMLElement | null = null;

  connectedCallback() {
    this.render();
  }

  disconnectedCallback() {
    this.activationGeneration += 1;
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
    }
  }

  async activate() {
    const generation = this.activationGeneration;
    const bindings = parseActionBindings({
      action: this.getAttribute('action'),
      actions: this.getAttribute('actions'),
      defaultPhase: 'activate'
    });
    if (bindings.length === 0) {
      return;
    }
    const payload = this.hasAttribute('arg')
      ? { arg: parseActionArg(this.getAttribute('arg') ?? '', normalizeArgType(this.getAttribute('arg-type'))) }
      : {};
    const execution = await callActionBindings(bindings, 'activate', payload);
    if (generation === this.activationGeneration && this.isConnected && execution.failures.length > 0) {
      this.dispatchEvent(new CustomEvent<NodelToastDetail>(NODEL_TOAST, {
        bubbles: true,
        composed: true,
        detail: {
          message: 'Page action failed',
          detail: execution.failures.map((failure) => `${failure.action}: ${failure.error ?? 'Failed to call action'}`).join('; '),
          tone: 'danger',
          durationMs: 7000
        }
      }));
    }
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
