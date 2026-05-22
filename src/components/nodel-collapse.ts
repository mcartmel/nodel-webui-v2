interface NodelCollapsePreviewDetail {
  text: string;
  source?: string;
}

export class NodelCollapse extends HTMLElement {
  static observedAttributes = ['label', 'open', 'preview'];

  private shellReady = false;
  private detailsNode: HTMLDetailsElement | null = null;
  private labelNode: HTMLElement | null = null;
  private previewNode: HTMLElement | null = null;
  private contentNode: HTMLElement | null = null;
  private previewText = '';
  private dynamicPreview = false;

  connectedCallback() {
    this.render();
    this.detailsNode?.addEventListener('toggle', this.handleToggle);
    this.addEventListener('nodel-collapse-preview', this.handlePreview as EventListener);
  }

  disconnectedCallback() {
    this.detailsNode?.removeEventListener('toggle', this.handleToggle);
    this.removeEventListener('nodel-collapse-preview', this.handlePreview as EventListener);
  }

  attributeChangedCallback() {
    if (!this.isConnected) {
      return;
    }

    this.syncLabel();
    this.syncPreviewFromAttribute();
    this.syncOpenState();
  }

  private render() {
    const children = this.shellReady ? [] : Array.from(this.childNodes);

    if (!this.shellReady) {
      this.innerHTML = `
        <details data-collapse-details class="nodel-collapse nodel-panel">
          <summary class="nodel-collapse-summary">
            <span data-collapse-label class="nodel-collapse-label"></span>
            <span data-collapse-preview class="nodel-collapse-preview" hidden></span>
            <span class="nodel-collapse-icon" aria-hidden="true"></span>
          </summary>
          <div data-collapse-content class="nodel-collapse-content"></div>
        </details>
      `;
      this.detailsNode = this.querySelector('[data-collapse-details]');
      this.labelNode = this.querySelector('[data-collapse-label]');
      this.previewNode = this.querySelector('[data-collapse-preview]');
      this.contentNode = this.querySelector('[data-collapse-content]');
      this.shellReady = true;
      if (this.contentNode) {
        for (const child of children) {
          this.contentNode.appendChild(child);
        }
      }
    }

    this.syncLabel();
    this.syncPreviewFromAttribute();
    this.syncOpenState();
  }

  private syncLabel() {
    if (this.labelNode) {
      this.labelNode.textContent = this.getAttribute('label') ?? 'Details';
    }
  }

  private syncOpenState() {
    if (this.detailsNode) {
      this.detailsNode.open = this.hasAttribute('open');
    }
  }

  private syncPreviewFromAttribute() {
    if (!this.dynamicPreview) {
      this.setPreviewText(this.getAttribute('preview') ?? '');
    }
  }

  private setPreviewText(text: string) {
    this.previewText = text.trim();
    if (this.previewNode) {
      this.previewNode.textContent = this.previewText;
      this.previewNode.hidden = !this.previewText;
    }
  }

  private handlePreview = (event: CustomEvent<NodelCollapsePreviewDetail>) => {
    const target = event.target;
    if (!(target instanceof Node) || !this.contentNode?.contains(target)) {
      return;
    }

    this.dynamicPreview = true;
    this.setPreviewText(event.detail?.text ?? '');
    event.stopPropagation();
  };

  private handleToggle = (event: Event) => {
    if (event.target !== this.detailsNode || !this.detailsNode) {
      return;
    }

    const open = this.detailsNode.open;
    if (open) {
      if (!this.hasAttribute('open')) {
        this.setAttribute('open', '');
      }
    } else if (this.hasAttribute('open')) {
      this.removeAttribute('open');
    }

    this.dispatchEvent(new CustomEvent('nodel-collapse-toggle', {
      bubbles: true,
      detail: { open }
    }));
  };
}

if (!customElements.get('nodel-collapse')) {
  customElements.define('nodel-collapse', NodelCollapse);
}
