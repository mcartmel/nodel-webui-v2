export interface ModalFocusControllerOptions {
  container: HTMLElement;
  dialog: HTMLElement;
  onCancel?: () => void;
  trigger?: Element | null;
  inertRoot?: ParentNode;
}

interface ModalLayer {
  container: HTMLElement;
  dialog: HTMLElement;
  trigger: Element | null;
  onCancel?: () => void;
  inertRoot: ParentNode;
  inertEntries: Array<{ element: HTMLElement; inert: boolean; ariaHidden: string | null }>;
  inertElements: Set<HTMLElement>;
  keydown: (event: KeyboardEvent) => void;
  observer: MutationObserver | null;
}

const focusSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const stack: ModalLayer[] = [];

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusSelector))
    .filter((element) => !element.hidden && !element.closest('[hidden]'));
}

function isTopLayer(layer: ModalLayer) {
  return stack[stack.length - 1] === layer;
}

function applyInert(layer: ModalLayer) {
  for (const child of Array.from(layer.inertRoot.children)) {
    if (!(child instanceof HTMLElement) || child === layer.container || layer.container.contains(child) || child.contains(layer.container)) {
      continue;
    }
    if (layer.inertElements.has(child)) {
      continue;
    }
    layer.inertElements.add(child);
    layer.inertEntries.push({ element: child, inert: child.hasAttribute('inert') || Boolean(child.inert), ariaHidden: child.getAttribute('aria-hidden') });
    child.inert = true;
    child.setAttribute('inert', '');
    child.setAttribute('aria-hidden', 'true');
  }
}

function restoreInert(layer: ModalLayer) {
  for (const entry of layer.inertEntries) {
    entry.element.inert = entry.inert;
    entry.element.toggleAttribute('inert', entry.inert);
    if (entry.ariaHidden === null) {
      entry.element.removeAttribute('aria-hidden');
    } else {
      entry.element.setAttribute('aria-hidden', entry.ariaHidden);
    }
  }
  layer.inertEntries = [];
  layer.inertElements.clear();
}

function handleTab(layer: ModalLayer, event: KeyboardEvent) {
  const focusables = focusableElements(layer.dialog);
  if (focusables.length === 0) {
    event.preventDefault();
    layer.dialog.focus();
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
  } else if (!layer.dialog.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
}

export class ModalFocusController {
  private layer: ModalLayer | null = null;

  activate(options: ModalFocusControllerOptions) {
    this.deactivate({ restoreFocus: false });
    const layer: ModalLayer = {
      container: options.container,
      dialog: options.dialog,
      trigger: options.trigger ?? document.activeElement,
      onCancel: options.onCancel,
      inertRoot: options.inertRoot ?? document.body,
      inertEntries: [],
      inertElements: new Set(),
      observer: null,
      keydown: (event) => {
        if (!isTopLayer(layer)) {
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          layer.onCancel?.();
          return;
        }
        if (event.key === 'Tab') {
          handleTab(layer, event);
        }
      }
    };
    this.layer = layer;
    stack.push(layer);
    applyInert(layer);
    layer.observer = new MutationObserver(() => applyInert(layer));
    if (layer.inertRoot instanceof Element || layer.inertRoot instanceof Document || layer.inertRoot instanceof DocumentFragment) {
      layer.observer.observe(layer.inertRoot, { childList: true });
    }
    document.addEventListener('keydown', layer.keydown, true);
  }

  deactivate(options: { restoreFocus?: boolean } = {}) {
    const layer = this.layer;
    if (!layer) {
      return;
    }
    const wasTop = isTopLayer(layer);
    const index = stack.indexOf(layer);
    if (index >= 0) {
      stack.splice(index, 1);
    }
    document.removeEventListener('keydown', layer.keydown, true);
    layer.observer?.disconnect();
    layer.observer = null;
    restoreInert(layer);
    this.layer = null;
    if (options.restoreFocus !== false && wasTop && layer.trigger instanceof HTMLElement && layer.trigger.isConnected) {
      queueMicrotask(() => layer.trigger instanceof HTMLElement && layer.trigger.isConnected && layer.trigger.focus());
    }
  }

  focusInitial(preferred?: HTMLElement | null) {
    const layer = this.layer;
    if (!layer || !isTopLayer(layer)) {
      return;
    }
    const target = preferred ?? focusableElements(layer.dialog)[0] ?? layer.dialog;
    queueMicrotask(() => {
      if (this.layer === layer && target.isConnected) {
        target.focus();
      }
    });
  }
}
