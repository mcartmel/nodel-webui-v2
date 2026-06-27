type NodelGroupSurface = 'card' | 'panel' | 'none';
type NodelGroupPadding = 'default' | 'compact' | 'none';

const labelableChildren = new Set([
  'nodel-toggle',
  'nodel-segmented',
  'nodel-select',
  'nodel-fader',
  'nodel-stepper',
  'nodel-pad',
  'nodel-readout',
  'nodel-palette',
  'nodel-meter',
  'nodel-image',
  'nodel-icon'
]);

let groupIdCounter = 0;

function normalizeSurface(value: string | null): NodelGroupSurface {
  return value === 'panel' || value === 'none' ? value : 'card';
}

function normalizePadding(value: string | null): NodelGroupPadding {
  return value === 'compact' || value === 'none' ? value : 'default';
}

function directElementChildren(element: HTMLElement) {
  return Array.from(element.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
}

export class NodelGroup extends HTMLElement {
  static observedAttributes = ['label', 'surface', 'padding'];

  private shellReady = false;
  private shellNode: HTMLElement | null = null;
  private labelNode: HTMLElement | null = null;
  private bodyNode: HTMLElement | null = null;
  private labelId = '';
  private observer: MutationObserver | null = null;

  connectedCallback() {
    this.ensureShell();
    this.render();
    this.observeBody();
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    this.observer = null;
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
    }
  }

  private ensureShell() {
    if (this.shellReady) {
      return;
    }

    const children = Array.from(this.childNodes);
    this.labelId = `nodel-group-label-${++groupIdCounter}`;
    this.innerHTML = `
      <div class="nodel-group-shell">
        <div class="nodel-group-label" hidden></div>
        <div class="nodel-group-body"></div>
      </div>
    `;
    this.shellNode = this.querySelector('.nodel-group-shell');
    this.labelNode = this.querySelector('.nodel-group-label');
    this.bodyNode = this.querySelector('.nodel-group-body');
    this.labelNode!.id = this.labelId;
    for (const child of children) {
      this.bodyNode?.appendChild(child);
    }
    this.shellReady = true;
  }

  private render() {
    this.ensureShell();
    const label = this.getAttribute('label') ?? '';
    const surface = normalizeSurface(this.getAttribute('surface'));
    const padding = normalizePadding(this.getAttribute('padding'));

    this.dataset.surface = surface;
    this.dataset.padding = padding;
    this.shellNode!.dataset.surface = surface;
    this.shellNode!.dataset.padding = padding;
    this.labelNode!.hidden = !label;
    this.labelNode!.textContent = label;

    if (label) {
      this.shellNode!.setAttribute('role', 'group');
      this.shellNode!.setAttribute('aria-labelledby', this.labelId);
    } else {
      this.shellNode!.removeAttribute('role');
      this.shellNode!.removeAttribute('aria-labelledby');
    }

    this.syncAutoLabel();
  }

  private observeBody() {
    if (!this.bodyNode || this.observer) {
      return;
    }

    this.observer = new MutationObserver(() => this.syncAutoLabel());
    this.observer.observe(this.bodyNode, {
      attributes: true,
      attributeFilter: ['aria-label', 'aria-labelledby', 'label'],
      childList: true,
      subtree: true
    });
  }

  private syncAutoLabel() {
    if (!this.bodyNode || !this.labelNode || this.labelNode.hidden) {
      this.clearAutoLabels();
      return;
    }

    const children = directElementChildren(this.bodyNode);
    const target = children.length === 1 && labelableChildren.has(children[0].localName) ? children[0] : null;

    for (const child of children) {
      if (child !== target) {
        this.clearAutoLabel(child);
      }
    }

    if (!target) {
      return;
    }

    const autoId = target.dataset.nodelGroupAutoLabelledby;
    const hasExplicitLabel = target.hasAttribute('label')
      || target.hasAttribute('aria-label')
      || (target.hasAttribute('aria-labelledby') && target.getAttribute('aria-labelledby') !== autoId);

    if (hasExplicitLabel) {
      this.clearAutoLabel(target);
      return;
    }

    if (target.getAttribute('aria-labelledby') !== this.labelId) {
      target.setAttribute('aria-labelledby', this.labelId);
    }
    target.dataset.nodelGroupAutoLabelledby = this.labelId;
  }

  private clearAutoLabels() {
    if (!this.bodyNode) {
      return;
    }
    for (const child of directElementChildren(this.bodyNode)) {
      this.clearAutoLabel(child);
    }
  }

  private clearAutoLabel(child: HTMLElement) {
    const autoId = child.dataset.nodelGroupAutoLabelledby;
    if (!autoId) {
      return;
    }
    if (child.getAttribute('aria-labelledby') === autoId) {
      child.removeAttribute('aria-labelledby');
    }
    delete child.dataset.nodelGroupAutoLabelledby;
  }
}

if (!customElements.get('nodel-group')) {
  customElements.define('nodel-group', NodelGroup);
}
