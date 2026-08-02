import type { NodelToastTone } from '../components/nodel-toast-host';
import { asciiToken } from '../utils/text-normalization';

export const NODEL_CONFIRM = 'nodel-confirm';

export type NodelConfirmMode = 'standard' | 'code';

export interface NodelConfirmRequest {
  title?: string;
  text?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: NodelToastTone;
  mode?: NodelConfirmMode;
  codeSignal?: string;
}

export interface NodelConfirmDetail extends NodelConfirmRequest {
  trigger?: Element | null;
  signal?: AbortSignal;
  resolve: (confirmed: boolean) => void;
}

export function shouldConfirm(element: HTMLElement) {
  return element.hasAttribute('confirm')
    || element.hasAttribute('confirm-title')
    || element.hasAttribute('confirm-text')
    || element.hasAttribute('confirm-mode')
    || element.hasAttribute('confirm-code-signal');
}

function normalizeConfirmMode(value: string | null | undefined): NodelConfirmMode {
  return asciiToken(value) === 'code' ? 'code' : 'standard';
}

export function confirmRequestFromAttributes(element: HTMLElement, defaults: NodelConfirmRequest = {}): NodelConfirmRequest {
  const mode = normalizeConfirmMode(element.getAttribute('confirm-mode') ?? defaults.mode);
  return {
    title: element.getAttribute('confirm-title') ?? defaults.title,
    text: element.getAttribute('confirm-text') ?? element.getAttribute('confirm') ?? defaults.text,
    confirmLabel: element.getAttribute('confirm-label') ?? defaults.confirmLabel,
    cancelLabel: element.getAttribute('cancel-label') ?? defaults.cancelLabel,
    tone: (element.getAttribute('confirm-tone') as NodelToastTone | null) ?? defaults.tone,
    mode,
    codeSignal: element.getAttribute('confirm-code-signal')?.trim() || defaults.codeSignal?.trim() || (mode === 'code' ? 'ConfirmCode' : undefined)
  };
}

export function requestConfirm(element: HTMLElement, request: NodelConfirmRequest, trigger?: Element | null, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    let handled = false;
    let settled = false;
    const activeElement = document.activeElement;
    const focusTrigger = trigger
      ?? (activeElement instanceof Element && element.contains(activeElement) ? activeElement : null)
      ?? element.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ?? element;
    const finish = (confirmed: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener('abort', abort);
      resolve(confirmed);
      if (!handled) {
        window.setTimeout(() => {
          if (focusTrigger instanceof HTMLElement && focusTrigger.isConnected) {
            focusTrigger.focus();
          }
        }, 0);
      }
    };
    const abort = () => finish(false);
    if (signal?.aborted) {
      finish(false);
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    const event = new CustomEvent<NodelConfirmDetail>(NODEL_CONFIRM, {
      bubbles: true,
      cancelable: true,
      detail: { ...request, trigger: focusTrigger, signal, resolve: finish }
    });

    handled = !element.dispatchEvent(event);
    if (!handled) {
      finish(request.mode === 'code' ? false : window.confirm(request.text || request.title || 'Continue?'));
    }
  });
}
