export async function copyTextToClipboard(value: string) {
  let modernError: unknown;
  if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (error) {
      modernError = error;
    }
  }

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);

  let copied = false;
  let fallbackError: unknown;
  try {
    textarea.focus();
    textarea.select();
    copied = document.execCommand('copy');
  } catch (error) {
    fallbackError = error;
  } finally {
    textarea.remove();
    if (previousFocus?.isConnected) {
      previousFocus.focus();
    }
  }

  if (!copied) {
    throw fallbackError ?? modernError ?? new Error('Clipboard access unavailable');
  }
}
