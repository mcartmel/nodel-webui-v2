import { callActionBindings, parseActionBindings, type ActionBindingResult } from '../data/action-bindings';
import { actionName, buildActionPayload, ControlActionController, formatActionFailures } from '../data/control-actions';
import type { ControlArgType } from '../utils/control-values';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';
import { releaseNodelPageActive } from '../data/visibility-scope';

const actionArgTypes: ControlArgType[] = ['string', 'number', 'boolean', 'json'];

function normalizeArgType(value: string | null): ControlArgType {
  return actionArgTypes.includes(value as ControlArgType) ? value as ControlArgType : 'string';
}

export class NodelPage extends HTMLElement {
  static observedAttributes = ['action', 'actions', 'arg', 'arg-type', 'min-height'];

  private shellReady = false;
  private actionController = new ControlActionController();
  private groupPage = false;
  private contentNode: HTMLElement | null = null;
  private pageObserver: MutationObserver | null = null;
  private normalizing = false;

  connectedCallback() {
    this.actionController.connect();
    this.render();
    this.observeStructure();
    this.normalizeStructure();
  }

  disconnectedCallback() {
    this.actionController.disconnect();
    this.pageObserver?.disconnect();
    this.pageObserver = null;
    releaseNodelPageActive(this);
  }

  attributeChangedCallback() {
    this.syncPageState();
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

  private observeStructure() {
    this.pageObserver?.disconnect();
    this.pageObserver = new MutationObserver(() => {
      if (!this.normalizing) this.normalizeStructure();
    });
    this.pageObserver.observe(this, { childList: true });
    if (this.contentNode) this.pageObserver.observe(this.contentNode, { childList: true });
  }

  private normalizeStructure() {
    if (!this.shellReady || !this.contentNode || this.normalizing) return;

    this.normalizing = true;
    try {
      this.normalizeHostChildren();
      const groupPage = Array.from(this.contentNode.children).some(isDirectPageNode);
      if (groupPage !== this.groupPage) this.replaceContentWrapper(groupPage);
      this.syncPageState();
    } finally {
      this.normalizing = false;
    }
    this.observeStructure();
  }

  private normalizeHostChildren() {
    if (!this.contentNode) return;
    const outside = Array.from(this.childNodes).filter((node) => node !== this.contentNode);
    if (outside.length === 0) return;

    const shellIndex = Array.from(this.childNodes).indexOf(this.contentNode);
    const beforeShell = outside.filter((node) => Array.from(this.childNodes).indexOf(node) < shellIndex);
    const afterShell = outside.filter((node) => Array.from(this.childNodes).indexOf(node) > shellIndex);
    for (const node of beforeShell.reverse()) this.contentNode.insertBefore(node, this.contentNode.firstChild);
    for (const node of afterShell) this.contentNode.appendChild(node);
  }

  private replaceContentWrapper(groupPage: boolean) {
    if (!this.contentNode) return;

    const oldContent = this.contentNode;
    const nextContent = document.createElement(groupPage ? 'div' : 'section');
    nextContent.dataset.pageContent = '';
    nextContent.className = groupPage ? 'contents' : 'nodel-shell space-y-6 pb-6 pt-6';
    while (oldContent.firstChild) nextContent.appendChild(oldContent.firstChild);
    oldContent.replaceWith(nextContent);
    this.contentNode = nextContent;
    this.groupPage = groupPage;
  }

  private syncPageState() {
    if (!this.shellReady || !this.contentNode) return;

    this.dataset.navGroupPage = String(this.groupPage);

    const requested = this.getAttribute('min-height');
    this.dataset.minHeight = !this.groupPage && requested === 'viewport' ? 'viewport' : 'auto';
  }
}

function isDirectPageNode(node: Node): boolean {
  return node instanceof HTMLElement && node.localName === 'nodel-page';
}

if (!customElements.get('nodel-page')) {
  customElements.define('nodel-page', NodelPage);
}
