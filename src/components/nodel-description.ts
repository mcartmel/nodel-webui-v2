import { getNodeDetails } from '../api/nodel-host-client';
import { renderMarkdown } from '../utils/markdown';

const defaultCollapsedHeight = '8rem';

export class NodelDescription extends HTMLElement {
  static observedAttributes = ['collapsed-height', 'open'];

  private abortController: AbortController | null = null;
  private bodyNode: HTMLElement | null = null;
  private buttonNode: HTMLButtonElement | null = null;
  private contentNode: HTMLElement | null = null;
  private loadingToken = 0;
  private resizeObserver: ResizeObserver | null = null;
  private shellReady = false;

  connectedCallback() {
    this.hidden = true;
    this.renderShell();
    this.addEventListener('click', this.handleClick);
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this.queueOverflowSync());
    }
    if (this.contentNode && this.resizeObserver) {
      this.resizeObserver.observe(this.contentNode);
    }
    void this.loadDescription();
  }

  disconnectedCallback() {
    this.loadingToken += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.removeEventListener('click', this.handleClick);
  }

  refreshAfterRestart() {
    return this.loadDescription();
  }

  attributeChangedCallback() {
    if (!this.isConnected) {
      return;
    }

    this.syncCollapsedHeight();
    this.syncExpandedState();
    this.queueOverflowSync();
  }

  private renderShell() {
    if (!this.shellReady) {
      this.innerHTML = `
        <section class="nodel-description nodel-description-panel" aria-label="Description">
          <div data-description-body class="nodel-description-body">
            <div data-description-content class="nodel-description-content"></div>
          </div>
          <div data-description-actions class="nodel-description-actions" hidden>
            <button data-description-toggle type="button" class="nodel-description-toggle">
              <span class="nodel-collapse-icon" aria-hidden="true"></span>
            </button>
          </div>
        </section>
      `;
      this.bodyNode = this.querySelector('[data-description-body]');
      this.contentNode = this.querySelector('[data-description-content]');
      this.buttonNode = this.querySelector('[data-description-toggle]');
      this.shellReady = true;
    }

    this.syncCollapsedHeight();
    this.syncExpandedState();
  }

  private async loadDescription() {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const token = ++this.loadingToken;

    try {
      const details = await getNodeDetails({ signal: this.abortController.signal });
      if (token !== this.loadingToken) {
        return;
      }

      const description = typeof details.desc === 'string' ? details.desc.trim() : '';
      if (!description || !this.contentNode) {
        this.hidden = true;
        return;
      }

      this.contentNode.innerHTML = renderMarkdown(description);
      this.hidden = false;
      this.queueOverflowSync();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      this.hidden = true;
    }
  }

  private syncCollapsedHeight() {
    const value = this.collapsedHeightValue();
    this.style.setProperty('--nodel-description-collapsed-height', value);
  }

  private collapsedHeightValue() {
    return this.getAttribute('collapsed-height')?.trim() || defaultCollapsedHeight;
  }

  private syncExpandedState() {
    const expanded = this.hasAttribute('open');
    this.dataset.expanded = String(expanded);
    this.bodyNode?.classList.toggle('is-expanded', expanded);
    if (this.buttonNode) {
      this.buttonNode.setAttribute('aria-label', expanded ? 'Show less' : 'Show more');
      this.buttonNode.setAttribute('aria-expanded', String(expanded));
      this.buttonNode.setAttribute('title', expanded ? 'Show less' : 'Show more');
    }
  }

  private queueOverflowSync() {
    const callback = () => this.syncOverflowState();
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(callback);
    } else {
      window.setTimeout(callback, 0);
    }
  }

  private syncOverflowState() {
    if (this.hidden || !this.bodyNode || !this.contentNode || !this.buttonNode) {
      return;
    }

    const actionNode = this.buttonNode.parentElement;
    const wasExpanded = this.bodyNode.classList.contains('is-expanded');

    if (wasExpanded) {
      this.bodyNode.classList.remove('is-expanded');
    }

    const overflow = this.bodyNode.scrollHeight > this.bodyNode.clientHeight;

    if (wasExpanded) {
      this.bodyNode.classList.add('is-expanded');
    }

    this.dataset.overflow = String(overflow);
    this.bodyNode.classList.toggle('is-overflowing', overflow);
    if (actionNode) {
      actionNode.hidden = !overflow;
    }
  }

  private handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest('[data-description-toggle]');
    if (!button || !this.contains(button)) {
      return;
    }

    event.preventDefault();
    this.toggleAttribute('open', !this.hasAttribute('open'));
  };
}

if (!customElements.get('nodel-description')) {
  customElements.define('nodel-description', NodelDescription);
}
