import { createSignalBindingController } from '../data/signal-bindings';
import { renderMarkdown } from '../utils/markdown';
import { trimPointReference } from '../utils/edge-whitespace';

type MarkdownMaxHeight = 'none' | 'sm' | 'md' | 'lg' | 'screen';

const maxHeights: MarkdownMaxHeight[] = ['none', 'sm', 'md', 'lg', 'screen'];

function normalizeMaxHeight(value: string | null): MarkdownMaxHeight {
  return maxHeights.includes(value as MarkdownMaxHeight) ? value as MarkdownMaxHeight : 'none';
}

export class NodelMarkdown extends HTMLElement {
  static observedAttributes = ['value', 'signal', 'signals', 'max-height'];

  private contentNode: HTMLElement | null = null;
  private signalBindings = createSignalBindingController(this);
  private sourceError = '';
  private sourceLoading = false;

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
    if (this.contentNode) {
      return;
    }
    this.innerHTML = '<div class="nodel-markdown-region"><div class="nodel-markdown-content nodel-description-content"></div></div>';
    this.contentNode = this.querySelector('.nodel-markdown-content');
  }

  private render() {
    this.ensureShell();
    const maxHeight = normalizeMaxHeight(this.getAttribute('max-height'));
    this.dataset.maxHeight = maxHeight;
    const region = this.querySelector<HTMLElement>('.nodel-markdown-region');
    region?.setAttribute('aria-busy', String(this.sourceLoading));
    if (!this.contentNode) {
      return;
    }
    if (this.sourceLoading) {
      this.renderFallback('Loading content...', 'status');
      return;
    }
    if (this.sourceError) {
      this.renderFallback('Content unavailable.', 'alert');
      return;
    }
    const value = this.getAttribute('value') ?? '';
    if (!value.trim()) {
      this.renderFallback('No content available.', 'status');
      return;
    }
    this.contentNode.innerHTML = renderMarkdown(value);
  }

  private renderFallback(message: string, role: 'status' | 'alert') {
    const fallback = document.createElement('p');
    fallback.className = 'nodel-markdown-fallback';
    fallback.setAttribute('role', role);
    fallback.textContent = message;
    this.contentNode?.replaceChildren(fallback);
  }

  private syncSignalSubscription() {
    const hasBindings = Boolean(trimPointReference(this.getAttribute('signal') ?? '') || trimPointReference(this.getAttribute('signals') ?? ''));
    this.sourceLoading = hasBindings && !this.hasAttribute('value');
    this.sourceError = '';
    this.render();
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      value: (value) => {
        this.setAttribute('value', value);
        this.sourceLoading = false;
        this.sourceError = '';
        this.render();
      }
    }, {
      onSourceState: (state) => {
        this.sourceLoading = state.loading;
        this.sourceError = state.error;
        this.render();
      }
    });
  }
}

if (!customElements.get('nodel-markdown')) {
  customElements.define('nodel-markdown', NodelMarkdown);
}
