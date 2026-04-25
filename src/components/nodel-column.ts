const responsiveSpanAttributes = ['span', 'sm', 'md', 'lg', 'xl', '2xl'] as const;

type ResponsiveSpanAttribute = (typeof responsiveSpanAttributes)[number];

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

export class NodelColumn extends HTMLElement {
  static observedAttributes = responsiveSpanAttributes;

  private shellReady = false;
  private columnNode: HTMLElement | null = null;

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
    }
  }

  private render() {
    const children = this.shellReady ? [] : Array.from(this.childNodes);
    this.syncResponsiveSpans();

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
      return;
    }
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
}

if (!customElements.get('nodel-column')) {
  customElements.define('nodel-column', NodelColumn);
}
