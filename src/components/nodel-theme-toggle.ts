import { renderFontAwesomeIcon, themeIcons } from '../icons/fontawesome';
import { resolveTheme, storeTheme } from '../theme/theme';

export class NodelThemeToggle extends HTMLElement {
  private buttonNode: HTMLButtonElement | null = null;
  private thumbNode: HTMLElement | null = null;
  private appNode: HTMLElement | null = null;

  connectedCallback() {
    this.appNode = this.closest('nodel-app');
    this.render();
    this.addEventListener('click', this.handleClick);
    this.appNode?.addEventListener('nodel-theme-change', this.handleThemeChange as EventListener);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.handleClick);
    this.appNode?.removeEventListener('nodel-theme-change', this.handleThemeChange as EventListener);
    this.appNode = null;
  }

  private handleClick = () => {
    const app = this.appNode ?? this.closest('nodel-app');
    if (!app) {
      return;
    }

    const current = resolveTheme(app.getAttribute('theme'));
    const next = current === 'dark' ? 'light' : 'dark';
    storeTheme(next);
    app.setAttribute('theme', next);
  };

  private handleThemeChange = (event: Event) => {
    const detail = (event as CustomEvent<{ theme?: string }>).detail;
    if (detail?.theme) {
      this.updateLabel(detail.theme);
    }
  };

  private render() {
    this.innerHTML = `
      <button data-theme-toggle type="button" role="switch" class="nodel-theme-switch">
        <span data-theme-toggle-thumb class="nodel-theme-switch-thumb"></span>
      </button>
    `;
    this.buttonNode = this.querySelector('button');
    this.thumbNode = this.querySelector('[data-theme-toggle-thumb]');
    this.syncLabel();
  }

  private syncLabel() {
    const app = this.appNode ?? this.closest('nodel-app');
    const theme = resolveTheme(app?.getAttribute('theme'));
    this.updateLabel(theme);
  }

  private updateLabel(theme: string) {
    const dark = theme === 'dark';

    if (this.thumbNode) {
      this.thumbNode.innerHTML = renderFontAwesomeIcon(dark ? themeIcons.moon : themeIcons.sun);
    }

    if (this.buttonNode) {
      this.buttonNode.dataset.theme = dark ? 'dark' : 'light';
      this.buttonNode.setAttribute('aria-checked', String(dark));
      this.buttonNode.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      this.buttonNode.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
    }
  }
}

if (!customElements.get('nodel-theme-toggle')) {
  customElements.define('nodel-theme-toggle', NodelThemeToggle);
}
