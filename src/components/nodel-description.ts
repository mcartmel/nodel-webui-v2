import { getNodeDetails } from '../api/nodel-host-client';
import { renderMarkdown } from '../utils/markdown';

const defaultCollapsedHeight = '8rem';

function lengthToPixels(value: string) {
  const trimmed = value.trim().toLowerCase();
  const amount = Number.parseFloat(trimmed);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  if (trimmed.endsWith('rem')) {
    return amount * 16;
  }

  if (trimmed.endsWith('em')) {
    return amount * 16;
  }

  return amount;
}

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
        <section class="nodel-description nodel-panel" aria-label="Description">
          <div data-description-body class="nodel-description-body">
            <div data-description-content class="nodel-description-content"></div>
          </div>
          <div data-description-actions class="nodel-description-actions" hidden>
            <button data-description-toggle type="button" class="nodel-button nodel-button-ghost">Show more</button>
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
      this.buttonNode.textContent = expanded ? 'Show less' : 'Show more';
      this.buttonNode.setAttribute('aria-expanded', String(expanded));
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
    const collapsedHeight = lengthToPixels(this.collapsedHeightValue());
    const overflow = collapsedHeight > 0 && this.contentNode.scrollHeight > collapsedHeight + 1;

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
