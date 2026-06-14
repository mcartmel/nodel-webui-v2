import type { NodelToastTone } from '../components/nodel-toast-host';

export const NODEL_CONFIRM = 'nodel-confirm';

export interface NodelConfirmRequest {
  title?: string;
  text?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: NodelToastTone;
}

export interface NodelConfirmDetail extends NodelConfirmRequest {
  resolve: (confirmed: boolean) => void;
}

export function shouldConfirm(element: HTMLElement) {
  return element.hasAttribute('confirm') || element.hasAttribute('confirm-title') || element.hasAttribute('confirm-text');
}

export function confirmRequestFromAttributes(element: HTMLElement, defaults: NodelConfirmRequest = {}): NodelConfirmRequest {
  return {
    title: element.getAttribute('confirm-title') ?? defaults.title,
    text: element.getAttribute('confirm-text') ?? element.getAttribute('confirm') ?? defaults.text,
    confirmLabel: element.getAttribute('confirm-label') ?? defaults.confirmLabel,
    cancelLabel: element.getAttribute('cancel-label') ?? defaults.cancelLabel,
    tone: (element.getAttribute('confirm-tone') as NodelToastTone | null) ?? defaults.tone
  };
}

export function requestConfirm(element: HTMLElement, request: NodelConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    const event = new CustomEvent<NodelConfirmDetail>(NODEL_CONFIRM, {
      bubbles: true,
      cancelable: true,
      detail: { ...request, resolve }
    });

    const handled = !element.dispatchEvent(event);
    if (!handled) {
      resolve(window.confirm(request.text || request.title || 'Continue?'));
    }
  });
}
