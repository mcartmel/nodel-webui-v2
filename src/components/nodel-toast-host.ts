export const NODEL_TOAST = 'nodel-toast';

export type NodelToastTone = 'success' | 'info' | 'warning' | 'danger';

export interface NodelToastDetail {
  id?: string;
  message: string;
  detail?: string;
  tone?: NodelToastTone;
  durationMs?: number;
  persistent?: boolean;
}

interface ToastItem {
  id: string;
  message: string;
  detail: string;
  tone: NodelToastTone;
  durationMs: number;
  persistent: boolean;
}

const defaultToastDurationMs = 3500;
const updateToastDurationMs = 3200;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeTone(tone: NodelToastDetail['tone']): NodelToastTone {
  return tone === 'success' || tone === 'warning' || tone === 'danger' ? tone : 'info';
}

export class NodelToastHost extends HTMLElement {
  private sequence = 0;
  private timers = new Map<string, number>();
  private toasts: ToastItem[] = [];

  connectedCallback() {
    this.classList.add('nodel-toast-host');
    this.setAttribute('aria-live', 'polite');
    this.addEventListener('click', this.handleClick);
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.handleClick);
    for (const timer of this.timers.values()) {
      window.clearTimeout(timer);
    }
    this.timers.clear();
  }

  show(detail: NodelToastDetail) {
    if (!detail.message.trim()) {
      return '';
    }

    const id = detail.id || `toast-${Date.now()}-${(this.sequence += 1)}`;
    const existing = this.toasts.findIndex((toast) => toast.id === id);
    const toast: ToastItem = {
      id,
      message: detail.message,
      detail: detail.detail ?? '',
      tone: normalizeTone(detail.tone),
      durationMs: detail.durationMs ?? (existing >= 0 ? updateToastDurationMs : defaultToastDurationMs),
      persistent: detail.persistent ?? false
    };

    if (existing >= 0) {
      this.toasts[existing] = toast;
    } else {
      this.toasts = [...this.toasts, toast];
    }

    this.schedule(toast);
    this.render();
    return id;
  }

  dismiss(id: string) {
    if (!id) {
      return;
    }

    const timer = this.timers.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.timers.delete(id);
    }

    this.toasts = this.toasts.filter((toast) => toast.id !== id);
    this.render();
  }

  private schedule(toast: ToastItem) {
    const existingTimer = this.timers.get(toast.id);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
      this.timers.delete(toast.id);
    }

    if (toast.persistent) {
      return;
    }

    const timer = window.setTimeout(() => this.dismiss(toast.id), Math.max(0, toast.durationMs));
    this.timers.set(toast.id, timer);
  }

  private handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const closeButton = target.closest<HTMLElement>('[data-toast-dismiss]');
    if (!closeButton || !this.contains(closeButton)) {
      return;
    }

    this.dismiss(closeButton.dataset.toastDismiss ?? '');
  };

  private render() {
    this.hidden = this.toasts.length === 0;
    this.innerHTML = this.toasts.map((toast) => {
      const role = toast.tone === 'danger' ? 'alert' : 'status';
      const ariaLive = toast.tone === 'danger' ? 'assertive' : 'polite';
      const detail = toast.detail
        ? `<div class="nodel-toast-detail">${escapeHtml(toast.detail)}</div>`
        : '';

      return `
        <section class="nodel-toast nodel-toast-${toast.tone}" data-toast-id="${escapeHtml(toast.id)}" role="${role}" aria-live="${ariaLive}">
          <div class="nodel-toast-body">
            <div class="nodel-toast-message">${escapeHtml(toast.message)}</div>
            ${detail}
          </div>
          <button class="nodel-toast-close" type="button" data-toast-dismiss="${escapeHtml(toast.id)}" aria-label="Dismiss notification">&times;</button>
        </section>
      `;
    }).join('');
  }
}

if (!customElements.get('nodel-toast-host')) {
  customElements.define('nodel-toast-host', NodelToastHost);
}
