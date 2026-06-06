const responsiveColumnAttributes = ['columns', 'sm', 'md', 'lg', 'xl', '2xl'] as const;

type ResponsiveColumnAttribute = (typeof responsiveColumnAttributes)[number];

function normalizeColumnCount(value: string | null, fallback: number | null) {
  if (value === null) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback ?? 1;
  }

  return Math.min(12, Math.max(1, Math.trunc(parsed)));
}

function cssVariableName(attribute: ResponsiveColumnAttribute) {
  return attribute === 'columns' ? '--nodel-control-grid-columns' : `--nodel-control-grid-${attribute}`;
}

export class NodelControlGrid extends HTMLElement {
  static observedAttributes = responsiveColumnAttributes;

  connectedCallback() {
    this.syncColumnCounts();
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.syncColumnCounts();
    }
  }

  private syncColumnCounts() {
    const baseColumns = normalizeColumnCount(this.getAttribute('columns'), 1) ?? 1;
    this.dataset.columns = String(baseColumns);
    this.style.setProperty('--nodel-control-grid-columns', String(baseColumns));

    for (const attribute of responsiveColumnAttributes) {
      if (attribute === 'columns') {
        continue;
      }

      const columns = normalizeColumnCount(this.getAttribute(attribute), null);
      const variableName = cssVariableName(attribute);

      if (columns === null) {
        this.removeAttribute(`data-${attribute}`);
        this.style.removeProperty(variableName);
      } else {
        this.setAttribute(`data-${attribute}`, String(columns));
        this.style.setProperty(variableName, String(columns));
      }
    }
  }
}

if (!customElements.get('nodel-control-grid')) {
  customElements.define('nodel-control-grid', NodelControlGrid);
}
