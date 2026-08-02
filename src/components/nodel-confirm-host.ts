import { NODEL_CONFIRM, type NodelConfirmDetail, type NodelConfirmRequest } from '../data/confirm';
import { getControlRuntime } from '../data/control-runtime';
import { renderFontAwesomeIcon, toastIcons } from '../icons/fontawesome';
import type { NodelToastTone } from './nodel-toast-host';
import { ModalFocusController } from '../utils/modal-focus-controller';

type CodeStatus = 'loading' | 'ready' | 'unavailable';

interface ConfirmState {
  title: string;
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: NodelToastTone;
  mode: 'standard' | 'code';
  codeSignal: string;
  codeStatus: CodeStatus;
  expectedCode: string | null;
  enteredCode: string;
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
  private codeSignalSubscription: { dispose(): void } | null = null;
  private modal = new ModalFocusController();
  private requestSignal: AbortSignal | null = null;
  private requestAbort: (() => void) | null = null;

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
    if (detail.signal?.aborted) {
      detail.resolve(false);
      return;
    }
    this.state = {
      title: detail.title?.trim() || 'Confirm action',
      text: detail.text?.trim() || 'Continue?',
      confirmLabel: detail.confirmLabel?.trim() || 'Confirm',
      cancelLabel: detail.cancelLabel?.trim() || 'Cancel',
      tone: normalizeTone(detail.tone),
      mode: detail.mode === 'code' ? 'code' : 'standard',
      codeSignal: detail.codeSignal?.trim() || 'ConfirmCode',
      codeStatus: 'loading',
      expectedCode: null,
      enteredCode: '',
      resolve: detail.resolve,
      trigger
    };
    if (detail.signal) {
      this.requestSignal = detail.signal;
      this.requestAbort = () => this.resolve(false);
      detail.signal.addEventListener('abort', this.requestAbort, { once: true });
    }
    this.render();
    if (this.state.mode === 'code') {
      this.subscribeCodeSignal();
    }
    queueMicrotask(() => this.focusInitialControl());
  }

  private resolve(confirmed: boolean) {
    const state = this.state;
    if (!state) {
      return;
    }

    this.codeSignalSubscription?.dispose();
    this.codeSignalSubscription = null;
    if (this.requestSignal && this.requestAbort) {
      this.requestSignal.removeEventListener('abort', this.requestAbort);
    }
    this.requestSignal = null;
    this.requestAbort = null;
    this.state = null;
    this.hidden = true;
    this.innerHTML = '';
    this.modal.deactivate({ restoreFocus: true });
    state.resolve(confirmed);
  }

  private handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const action = target.closest<HTMLElement>('[data-confirm-action]');
    if (action && this.contains(action)) {
      const actionName = action.dataset.confirmAction;
      if (actionName === 'cancel') {
        this.resolve(false);
      } else if (actionName === 'confirm') {
        if (this.state?.mode !== 'code' || this.codeMatches()) {
          this.resolve(true);
        }
      } else if (this.state?.mode === 'code' && this.state.codeStatus === 'ready') {
        if (actionName === 'clear') {
          this.state.enteredCode = '';
        } else if (actionName === 'backspace') {
          this.state.enteredCode = this.state.enteredCode.slice(0, -1);
        }
        this.renderPreservingFocus(action);
      }
      return;
    }

    const digit = target.closest<HTMLElement>('[data-confirm-code-digit]');
    if (digit && this.contains(digit) && this.state?.mode === 'code' && this.state.codeStatus === 'ready') {
      this.appendCodeDigit(digit.dataset.confirmCodeDigit ?? '');
      this.renderPreservingFocus(digit);
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
      return;
    }

    if (this.state.mode === 'code') {
      if (/^\d$/.test(event.key) && this.state.codeStatus === 'ready') {
        event.preventDefault();
        this.appendCodeDigit(event.key);
        this.renderPreservingFocus(event.target instanceof Element ? event.target : null);
        return;
      }
      if (event.key === 'Backspace' && this.state.codeStatus === 'ready') {
        event.preventDefault();
        this.state.enteredCode = this.state.enteredCode.slice(0, -1);
        this.renderPreservingFocus(event.target instanceof Element ? event.target : null);
        return;
      }
      if (event.key === 'Delete' && this.state.codeStatus === 'ready') {
        event.preventDefault();
        this.state.enteredCode = '';
        this.renderPreservingFocus(event.target instanceof Element ? event.target : null);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (this.codeMatches()) {
          this.resolve(true);
        }
        return;
      }
    }

  };

  private subscribeCodeSignal() {
    const state = this.state;
    if (!state || state.mode !== 'code') {
      return;
    }

    this.codeSignalSubscription?.dispose();
    this.codeSignalSubscription = getControlRuntime().subscribeSignals(this, (sourceState) => {
      const current = this.state;
      if (!current || current.mode !== 'code') {
        return;
      }

      if (sourceState.loading) {
        this.setCodeUnavailable('loading');
        return;
      }
      if (!sourceState.connected || sourceState.error) {
        this.setCodeUnavailable('unavailable');
        return;
      }

      const entry = [...sourceState.entries].reverse().find((candidate) => (
        candidate.source === 'local'
        && candidate.type === 'event'
        && String(candidate.alias ?? '') === current.codeSignal
      ));
      if (entry) {
        this.setExpectedCode(entry.arg);
      } else if (current.codeStatus === 'loading') {
        this.setCodeUnavailable('unavailable');
      }
    });
  }

  private normalizeExpectedCode(value: unknown) {
    if (typeof value === 'string') {
      return /^\d{1,64}$/.test(value) ? value : null;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      return String(value);
    }
    if (typeof value === 'bigint' && value >= 0n) {
      const normalized = String(value);
      return normalized.length <= 64 ? normalized : null;
    }
    return null;
  }

  private setExpectedCode(value: unknown) {
    const state = this.state;
    if (!state || state.mode !== 'code') {
      return;
    }
    const expectedCode = this.normalizeExpectedCode(value);
    if (expectedCode !== state.expectedCode) {
      state.enteredCode = '';
    }
    state.expectedCode = expectedCode;
    state.codeStatus = expectedCode === null ? 'unavailable' : 'ready';
    this.renderPreservingFocus(document.activeElement instanceof Element ? document.activeElement : null);
  }

  private setCodeUnavailable(status: Extract<CodeStatus, 'loading' | 'unavailable'>) {
    const state = this.state;
    if (!state || state.mode !== 'code') {
      return;
    }
    state.codeStatus = status;
    state.expectedCode = null;
    state.enteredCode = '';
    this.renderPreservingFocus(document.activeElement instanceof Element ? document.activeElement : null);
  }

  private appendCodeDigit(value: string) {
    const state = this.state;
    if (!state || state.mode !== 'code' || !/^\d$/.test(value) || state.enteredCode.length >= 64) {
      return;
    }
    state.enteredCode += value;
  }

  private codeMatches() {
    const state = this.state;
    return Boolean(state && state.mode === 'code' && state.codeStatus === 'ready' && state.expectedCode !== null && state.enteredCode === state.expectedCode);
  }

  private focusToken(element: Element | null) {
    if (!(element instanceof HTMLElement) || !this.contains(element)) {
      return '';
    }
    if (element.dataset.confirmCodeDigit) {
      return `digit:${element.dataset.confirmCodeDigit}`;
    }
    return element.dataset.confirmAction ? `action:${element.dataset.confirmAction}` : '';
  }

  private focusTokenElement(token: string) {
    if (token.startsWith('digit:')) {
      return this.querySelector<HTMLButtonElement>(`[data-confirm-code-digit="${token.slice(6)}"]`);
    }
    if (token.startsWith('action:')) {
      return this.querySelector<HTMLButtonElement>(`[data-confirm-action="${token.slice(7)}"]`);
    }
    return null;
  }

  private renderPreservingFocus(element: Element | null) {
    const token = this.focusToken(element);
    const hadFocus = Boolean(token);
    this.render();
    if (hadFocus) {
      queueMicrotask(() => {
        const target = this.focusTokenElement(token);
        if (target && !target.disabled) {
          target.focus();
        } else {
          this.querySelector<HTMLButtonElement>('button[data-confirm-action="cancel"]')?.focus();
        }
      });
    }
  }

  private focusInitialControl() {
    const selector = this.state?.mode === 'code'
      ? '[data-confirm-code-digit="1"]:not(:disabled), button[data-confirm-action="cancel"]'
      : this.state?.tone === 'danger'
        ? 'button[data-confirm-action="cancel"]'
        : '[data-confirm-action="confirm"]';
    this.querySelector<HTMLButtonElement>(selector)?.focus();
  }

  private syncModalFocus() {
    const state = this.state;
    const dialog = this.querySelector<HTMLElement>('.nodel-confirm-dialog');
    if (!state || !dialog) {
      this.modal.deactivate({ restoreFocus: false });
      return;
    }

    this.modal.activate({
      container: this,
      dialog,
      inertRoot: this.closest('nodel-app') ?? this.parentElement ?? document.body,
      onCancel: () => this.resolve(false),
      trigger: state.trigger
    });
  }

  private render() {
    const state = this.state;
    this.hidden = !state;
    if (!state) {
      this.innerHTML = '';
      return;
    }

    const confirmClass = state.tone === 'danger' ? 'nodel-button nodel-button-danger' : 'nodel-button nodel-button-primary';
    const codeReady = state.mode === 'code' && state.codeStatus === 'ready';
    const codeStatus = state.codeStatus === 'loading' ? 'Loading operator code...' : state.codeStatus === 'ready' ? 'Enter operator code.' : 'Operator code unavailable.';
    const enteredCount = state.enteredCode.length;
    const codeMarkup = state.mode === 'code' ? `
      <div class="nodel-confirm-code">
        <p id="nodel-confirm-code-status" class="nodel-confirm-code-status" role="status" aria-live="polite">${codeStatus}</p>
        <div class="nodel-confirm-code-entry" role="status" aria-label="${enteredCount} digit${enteredCount === 1 ? '' : 's'} entered">
          <span aria-hidden="true">${enteredCount > 0 ? '•'.repeat(enteredCount) : 'No digits entered'}</span>
        </div>
        <div class="nodel-confirm-keypad" role="group" aria-label="Numeric keypad">
          ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => `<button type="button" class="nodel-button nodel-confirm-key" data-confirm-code-digit="${digit}" aria-label="Digit ${digit}"${codeReady ? '' : ' disabled'}>${digit}</button>`).join('')}
          <button type="button" class="nodel-button nodel-confirm-key nodel-confirm-key-text" data-confirm-action="clear"${codeReady ? '' : ' disabled'}>Clear</button>
          <button type="button" class="nodel-button nodel-confirm-key" data-confirm-code-digit="0" aria-label="Digit 0"${codeReady ? '' : ' disabled'}>0</button>
          <button type="button" class="nodel-button nodel-confirm-key nodel-confirm-key-text" data-confirm-action="backspace" aria-label="Backspace"${codeReady ? '' : ' disabled'}>Backspace</button>
        </div>
      </div>
    ` : '';
    const describedBy = state.mode === 'code' ? 'nodel-confirm-text nodel-confirm-code-status' : 'nodel-confirm-text';
    this.innerHTML = `
      <div class="nodel-confirm-backdrop" data-confirm-action="cancel"></div>
      <section class="nodel-confirm-dialog nodel-panel nodel-confirm-${state.tone}" role="dialog" aria-modal="true" aria-labelledby="nodel-confirm-title" aria-describedby="${describedBy}">
        <div class="nodel-confirm-icon" aria-hidden="true">${toneIconMarkup[state.tone]}</div>
        <div class="nodel-confirm-body">
          <h2 id="nodel-confirm-title" class="nodel-confirm-title">${escapeHtml(state.title)}</h2>
          <p id="nodel-confirm-text" class="nodel-confirm-text">${escapeHtml(state.text)}</p>
          ${codeMarkup}
          <div class="nodel-confirm-actions">
            <button type="button" class="nodel-button nodel-button-outline" data-confirm-action="cancel">${escapeHtml(state.cancelLabel)}</button>
            <button type="button" class="${confirmClass}" data-confirm-action="confirm"${state.mode === 'code' && !this.codeMatches() ? ' disabled' : ''}>${escapeHtml(state.confirmLabel)}</button>
          </div>
        </div>
      </section>
    `;
    this.syncModalFocus();
  }
}

export type NodelConfirmHostElement = NodelConfirmHost;

if (!customElements.get('nodel-confirm-host')) {
  customElements.define('nodel-confirm-host', NodelConfirmHost);
}
