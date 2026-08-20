const responsiveSpanAttributes = ['span', 'sm', 'md', 'lg', 'xl', '2xl'] as const;
const responsiveOrderAttributes = ['order', 'sm-order', 'md-order', 'lg-order', 'xl-order', '2xl-order'] as const;

type ResponsiveSpanAttribute = (typeof responsiveSpanAttributes)[number];
type ResponsiveOrderAttribute = (typeof responsiveOrderAttributes)[number];

function normalizeSpan(value: string | null, fallback: number | null) {
  if (value === null) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback ?? 12;
  }

  return Math.min(12, Math.max(1, Math.trunc(parsed)));
}

function cssVariableName(attribute: ResponsiveSpanAttribute) {
  return attribute === 'span' ? '--nodel-column-span' : `--nodel-column-${attribute}`;
}

function normalizeOrder(value: string | null) {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(12, Math.max(-12, Math.trunc(parsed))) : null;
}

function orderVariableName(attribute: ResponsiveOrderAttribute) {
  return attribute === 'order' ? '--nodel-column-order' : `--nodel-column-${attribute}`;
}

export class NodelColumn extends HTMLElement {
  static observedAttributes = [...responsiveSpanAttributes, ...responsiveOrderAttributes];

  private shellReady = false;
  private columnNode: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private hostObserver: MutationObserver | null = null;
  private normalizingHost = false;

  connectedCallback() {
    this.render();
    this.observeColumn();
    this.syncFillChild();
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    this.observer = null;
    this.hostObserver?.disconnect();
    this.hostObserver = null;
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
    }
  }

  private render() {
    const children = this.shellReady ? [] : Array.from(this.childNodes);
    this.syncResponsiveSpans();
    this.syncResponsiveOrders();

    if (!this.shellReady) {
      this.innerHTML = `
        <div data-column class="min-w-0"></div>
      `;
      this.columnNode = this.querySelector('[data-column]');
      this.shellReady = true;
      if (this.columnNode) {
        for (const child of children) {
          this.columnNode.appendChild(child);
        }
      }
      this.syncFillChild();
      return;
    }
  }

  private observeColumn() {
    if (!this.columnNode || this.observer) return;
    this.observer = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'childList' && record.target === this.columnNode
        || record.type === 'attributes' && record.target.parentNode === this.columnNode
        || record.type === 'characterData' && record.target.parentNode === this.columnNode)) {
        this.syncFillChild();
      }
    });
    this.observer.observe(this.columnNode, {
      attributeFilter: ['fill', 'hidden'],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    });

    this.hostObserver = new MutationObserver(() => {
      if (!this.normalizingHost) this.normalizeHostChildren();
    });
    this.hostObserver.observe(this, { childList: true });
    this.normalizeHostChildren();
  }

  private normalizeHostChildren() {
    if (!this.columnNode || this.normalizingHost) return;
    const outside = Array.from(this.childNodes).filter((node) => node !== this.columnNode);
    if (outside.length === 0) return;

    this.normalizingHost = true;
    try {
      const shellIndex = Array.from(this.childNodes).indexOf(this.columnNode);
      const beforeShell = outside.filter((node) => Array.from(this.childNodes).indexOf(node) < shellIndex);
      const afterShell = outside.filter((node) => Array.from(this.childNodes).indexOf(node) > shellIndex);
      for (const node of [...beforeShell].reverse()) this.columnNode.insertBefore(node, this.columnNode.firstChild);
      for (const node of afterShell) this.columnNode.appendChild(node);
    } finally {
      this.normalizingHost = false;
    }
    this.syncFillChild();
  }

  private syncFillChild() {
    if (!this.columnNode) return;

    const substantiveNodes = Array.from(this.columnNode.childNodes).filter((node) => {
      if (node.nodeType === Node.COMMENT_NODE) return false;
      if (node.nodeType === Node.TEXT_NODE) return Boolean(node.textContent?.trim());
      return node.nodeType === Node.ELEMENT_NODE && !(node as HTMLElement).hidden && !(node as HTMLElement).hasAttribute('hidden');
    });
    const child = substantiveNodes.length === 1 ? substantiveNodes[0] : null;
    const active = child instanceof HTMLElement
      && (child.localName === 'nodel-group' || child.localName === 'nodel-control-grid')
      && child.hasAttribute('fill');

    if (active) this.dataset.fillChild = 'true';
    else delete this.dataset.fillChild;
  }

  private syncResponsiveSpans() {
    const baseSpan = normalizeSpan(this.getAttribute('span'), 12) ?? 12;
    this.dataset.span = String(baseSpan);
    this.style.setProperty('--nodel-column-span', String(baseSpan));

    for (const attribute of responsiveSpanAttributes) {
      if (attribute === 'span') {
        continue;
      }

      const span = normalizeSpan(this.getAttribute(attribute), null);
      const variableName = cssVariableName(attribute);

      if (span === null) {
        this.removeAttribute(`data-${attribute}`);
        this.style.removeProperty(variableName);
      } else {
        this.setAttribute(`data-${attribute}`, String(span));
        this.style.setProperty(variableName, String(span));
      }
    }
  }

  private syncResponsiveOrders() {
    for (const attribute of responsiveOrderAttributes) {
      const order = normalizeOrder(this.getAttribute(attribute));
      const variableName = orderVariableName(attribute);
      if (order === null) {
        this.removeAttribute(`data-${attribute}`);
        this.style.removeProperty(variableName);
      } else {
        this.setAttribute(`data-${attribute}`, String(order));
        this.style.setProperty(variableName, String(order));
      }
    }
  }
}

if (!customElements.get('nodel-column')) {
  customElements.define('nodel-column', NodelColumn);
}
