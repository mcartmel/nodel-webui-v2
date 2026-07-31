import type { NodelConnectivityState } from '../data/connectivity';
import { renderFontAwesomeIcon, toastIcons } from '../icons/fontawesome';

export type NodelOfflineMode = 'modal' | 'overlay';

export function normalizeOfflineMode(value: string | null | undefined): NodelOfflineMode {
  return value?.trim().toLocaleLowerCase() === 'overlay' ? 'overlay' : 'modal';
}

export class NodelConnectivityHost extends HTMLElement {
  private state: NodelConnectivityState = { offline: false, reason: '', retryAttempt: 0 };
  private mode: NodelOfflineMode = 'modal';

  connectedCallback() {
    this.classList.add('nodel-connectivity-host');
    this.render();
  }

  update(state: NodelConnectivityState, mode: NodelOfflineMode) {
    const changed = this.state.offline !== state.offline || this.mode !== mode;
    this.state = state;
    this.mode = mode;
    if (changed) {
      this.render();
    }
  }

  focusDialog() {
    this.querySelector<HTMLElement>('[role="alertdialog"]')?.focus();
  }

  private render() {
    this.hidden = !this.state.offline;
    this.classList.toggle('is-modal', this.mode === 'modal');
    this.classList.toggle('is-overlay', this.mode === 'overlay');
    if (!this.state.offline) {
      this.innerHTML = '';
      return;
    }

    const icon = renderFontAwesomeIcon(toastIcons.warning, 'h-5 w-5');
    const message = 'Controls are unavailable while this Nodel host cannot be reached. Retrying...';
    this.innerHTML = this.mode === 'modal' ? `
      <div class="nodel-connectivity-backdrop"></div>
      <section class="nodel-connectivity-dialog nodel-panel" role="alertdialog" aria-modal="true" aria-labelledby="nodel-connectivity-title" aria-describedby="nodel-connectivity-message" tabindex="-1">
        <span class="nodel-connectivity-icon" aria-hidden="true">${icon}</span>
        <div>
          <h2 id="nodel-connectivity-title" class="nodel-connectivity-title">Offline</h2>
          <p id="nodel-connectivity-message" class="nodel-connectivity-message">${message}</p>
        </div>
      </section>
    ` : `
      <div class="nodel-connectivity-banner nodel-alert nodel-alert-warning" role="alert" aria-live="assertive" aria-atomic="true">
        <span class="nodel-connectivity-icon" aria-hidden="true">${icon}</span>
        <div>
          <strong>Offline</strong>
          <span>${message}</span>
        </div>
      </div>
    `;
  }
}

export interface NodelConnectivityHostElement extends HTMLElement {
  update(state: NodelConnectivityState, mode: NodelOfflineMode): void;
  focusDialog(): void;
}

if (!customElements.get('nodel-connectivity-host')) {
  customElements.define('nodel-connectivity-host', NodelConnectivityHost);
}
