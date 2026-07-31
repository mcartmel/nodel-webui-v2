const fixedFooterHeights = new WeakMap<HTMLElement, Map<HTMLElement, number>>();

function applyFooterReservation(app: HTMLElement) {
  const heights = fixedFooterHeights.get(app);
  if (!heights || heights.size === 0) {
    fixedFooterHeights.delete(app);
    app.removeAttribute('data-fixed-footer');
    app.style.removeProperty('--nodel-fixed-footer-height');
    return;
  }
  app.setAttribute('data-fixed-footer', 'true');
  app.style.setProperty('--nodel-fixed-footer-height', `${Math.max(...heights.values())}px`);
}

function setFooterHeight(app: HTMLElement, footer: HTMLElement, height: number) {
  const heights = fixedFooterHeights.get(app) ?? new Map<HTMLElement, number>();
  heights.set(footer, height);
  fixedFooterHeights.set(app, heights);
  applyFooterReservation(app);
}

function removeFooterHeight(app: HTMLElement, footer: HTMLElement) {
  fixedFooterHeights.get(app)?.delete(footer);
  applyFooterReservation(app);
}

export class NodelFooter extends HTMLElement {
  static observedAttributes = ['fixed'];

  private appNode: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private shellNode: HTMLElement | null = null;

  connectedCallback() {
    this.ensureShell();
    this.appNode = this.closest('nodel-app');
    this.syncMode();
  }

  disconnectedCallback() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clearAppReservation();
    this.appNode = null;
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.syncMode();
    }
  }

  private ensureShell() {
    if (this.shellNode) {
      return;
    }
    const children = Array.from(this.childNodes);
    const shell = document.createElement('footer');
    shell.className = 'nodel-footer-shell';
    shell.setAttribute('data-footer-shell', '');
    for (const child of children) {
      shell.append(child);
    }
    this.append(shell);
    this.shellNode = shell;
  }

  private syncMode() {
    const fixed = this.hasAttribute('fixed');
    this.dataset.fixed = String(fixed);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (!fixed) {
      this.clearAppReservation();
      return;
    }
    const app = this.appNode ?? this.closest('nodel-app');
    this.appNode = app;
    if (app) {
      setFooterHeight(app, this, 0);
    }
    if (typeof ResizeObserver === 'function' && this.shellNode) {
      this.resizeObserver = new ResizeObserver(() => this.updateAppReservation());
      this.resizeObserver.observe(this.shellNode);
    }
    queueMicrotask(() => this.updateAppReservation());
  }

  private updateAppReservation() {
    if (!this.hasAttribute('fixed') || !this.shellNode || !this.appNode) {
      return;
    }
    const height = Math.ceil(this.shellNode.getBoundingClientRect().height);
    setFooterHeight(this.appNode, this, height);
  }

  private clearAppReservation() {
    const app = this.appNode;
    if (!app) {
      return;
    }
    removeFooterHeight(app, this);
  }
}

if (!customElements.get('nodel-footer')) {
  customElements.define('nodel-footer', NodelFooter);
}
