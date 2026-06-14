import { NODEL_CONFIRM, type NodelConfirmDetail, type NodelConfirmRequest } from '../data/confirm';
import { renderFontAwesomeIcon, toastIcons } from '../icons/fontawesome';
import type { NodelToastTone } from './nodel-toast-host';

interface ConfirmState extends Required<Omit<NodelConfirmRequest, 'tone'>> {
  tone: NodelToastTone;
  resolve: (confirmed: boolean) => void;
  trigger: Element | null;
}

const toneIconMarkup: Record<NodelToastTone, string> = {
  danger: renderFontAwesomeIcon(toastIcons.danger, 'h-5 w-5'),
  info: renderFontAwesomeIcon(toastIcons.info, 'h-5 w-5'),
  success: renderFontAwesomeIcon(toastIcons.success, 'h-5 w-5'),
  warning: renderFontAwesomeIcon(toastIcons.warning, 'h-5 w-5')
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeTone(tone: NodelConfirmRequest['tone']): NodelToastTone {
  return tone === 'success' || tone === 'warning' || tone === 'danger' ? tone : 'info';
}

export class NodelConfirmHost extends HTMLElement {
  private state: ConfirmState | null = null;

  connectedCallback() {
    this.classList.add('nodel-confirm-host');
    this.hidden = true;
    this.addEventListener('click', this.handleClick);
    this.addEventListener('keydown', this.handleKeydown);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('keydown', this.handleKeydown);
    this.resolve(false);
  }

  confirm(detail: NodelConfirmDetail, trigger: Element | null = document.activeElement): void {
    this.resolve(false);
    this.state = {
      title: detail.title?.trim() || 'Confirm action',
      text: detail.text?.trim() || 'Continue?',
      confirmLabel: detail.confirmLabel?.trim() || 'Confirm',
      cancelLabel: detail.cancelLabel?.trim() || 'Cancel',
      tone: normalizeTone(detail.tone),
      resolve: detail.resolve,
      trigger
    };
    this.render();
    queueMicrotask(() => this.querySelector<HTMLButtonElement>('[data-confirm-action="confirm"]')?.focus());
  }

  private resolve(confirmed: boolean) {
    const state = this.state;
    if (!state) {
      return;
    }

    this.state = null;
    this.hidden = true;
    this.innerHTML = '';
    state.resolve(confirmed);
    if (state.trigger instanceof HTMLElement && state.trigger.isConnected) {
      state.trigger.focus();
    }
  }

  private handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const action = target.closest<HTMLElement>('[data-confirm-action]');
    if (action && this.contains(action)) {
      this.resolve(action.dataset.confirmAction === 'confirm');
      return;
    }

    if (target.classList.contains('nodel-confirm-backdrop')) {
      this.resolve(false);
    }
  };

  private handleKeydown = (event: KeyboardEvent) => {
    if (!this.state) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.resolve(false);
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusables = Array.from(this.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((element) => !element.hasAttribute('disabled'));
    if (focusables.length === 0) {
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  private render() {
    const state = this.state;
    this.hidden = !state;
    if (!state) {
      this.innerHTML = '';
      return;
    }

    const confirmClass = state.tone === 'danger' ? 'nodel-button nodel-button-danger' : 'nodel-button nodel-button-primary';
    this.innerHTML = `
      <div class="nodel-confirm-backdrop" data-confirm-action="cancel"></div>
      <section class="nodel-confirm-dialog nodel-panel nodel-confirm-${state.tone}" role="dialog" aria-modal="true" aria-labelledby="nodel-confirm-title" aria-describedby="nodel-confirm-text">
        <div class="nodel-confirm-icon" aria-hidden="true">${toneIconMarkup[state.tone]}</div>
        <div class="nodel-confirm-body">
          <h2 id="nodel-confirm-title" class="nodel-confirm-title">${escapeHtml(state.title)}</h2>
          <p id="nodel-confirm-text" class="nodel-confirm-text">${escapeHtml(state.text)}</p>
          <div class="nodel-confirm-actions">
            <button type="button" class="nodel-button nodel-button-outline" data-confirm-action="cancel">${escapeHtml(state.cancelLabel)}</button>
            <button type="button" class="${confirmClass}" data-confirm-action="confirm">${escapeHtml(state.confirmLabel)}</button>
          </div>
        </div>
      </section>
    `;
  }
}

export type NodelConfirmHostElement = NodelConfirmHost;

if (!customElements.get('nodel-confirm-host')) {
  customElements.define('nodel-confirm-host', NodelConfirmHost);
}
