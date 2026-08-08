export interface ModalFocusControllerOptions {
  container: HTMLElement;
  dialog: HTMLElement;
  onCancel?: () => void;
  trigger?: Element | null;
  inertRoot?: ParentNode;
}

interface InertState {
  inert: boolean;
  inertAttribute: boolean;
  ariaHidden: string | null;
}

interface ModalLayer {
  container: HTMLElement;
  dialog: HTMLElement;
  trigger: Element | null;
  onCancel?: () => void;
  inertRoot: ParentNode;
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
const managedInert = new Map<HTMLElement, InertState>();

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusSelector))
    .filter((element) => !element.hidden && !element.closest('[hidden]'));
}

function isTopLayer(layer: ModalLayer) {
  return stack[stack.length - 1] === layer;
}

function childElements(parent: ParentNode) {
  if (parent instanceof Element || parent instanceof Document || parent instanceof DocumentFragment) {
    return Array.from(parent.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  }
  return [];
}

function desiredInertBranches(layer: ModalLayer) {
  const branches = new Set<HTMLElement>();
  let current: Node | null = layer.container;

  while (current && current !== layer.inertRoot) {
    const parent: ParentNode | null = current.parentNode;
    if (!parent) {
      return new Set<HTMLElement>();
    }
    for (const child of childElements(parent)) {
      if (child !== current) {
        branches.add(child);
      }
    }
    current = parent;
  }

  return current === layer.inertRoot ? branches : new Set<HTMLElement>();
}

function restoreInert(element: HTMLElement, state: InertState) {
  element.inert = state.inert;
  element.toggleAttribute('inert', state.inertAttribute);
  if (state.ariaHidden === null) {
    element.removeAttribute('aria-hidden');
  } else {
    element.setAttribute('aria-hidden', state.ariaHidden);
  }
}

function removeLayer(layer: ModalLayer) {
  const index = stack.indexOf(layer);
  if (index >= 0) {
    stack.splice(index, 1);
  }
  document.removeEventListener('keydown', layer.keydown, true);
  layer.observer?.disconnect();
  layer.observer = null;
}

function pruneDisconnectedLayers() {
  for (const layer of [...stack]) {
    if (!layer.container.isConnected || !layer.dialog.isConnected) {
      removeLayer(layer);
    }
  }
}

function focusIntoLayer(layer: ModalLayer) {
  if (layer.container.contains(document.activeElement)) {
    return;
  }
  (focusableElements(layer.dialog)[0] ?? layer.dialog).focus();
}

function recomputeInertness(options: { applyBackground?: boolean } = {}) {
  const applyBackground = options.applyBackground ?? true;
  const previousTop = stack[stack.length - 1];
  pruneDisconnectedLayers();
  const top = stack[stack.length - 1];
  const desired = top ? desiredInertBranches(top) : new Set<HTMLElement>();

  for (const [element, state] of managedInert) {
    if (!desired.has(element)) {
      restoreInert(element, state);
      managedInert.delete(element);
    }
  }

  if (!applyBackground) {
    return;
  }

  for (const element of desired) {
    if (managedInert.has(element)) {
      continue;
    }
    managedInert.set(element, {
      inert: Boolean(element.inert) || element.hasAttribute('inert'),
      inertAttribute: element.hasAttribute('inert'),
      ariaHidden: element.getAttribute('aria-hidden')
    });
    element.inert = true;
    element.setAttribute('inert', '');
    element.setAttribute('aria-hidden', 'true');
  }

  // A disconnected top layer may have owned focus when it was removed. Only
  // restore focus when pruning changes the top layer; ordinary mutations must
  // not steal focus from the active subtree.
  if (top && top !== previousTop) {
    focusIntoLayer(top);
  }
}

function observeLayer(layer: ModalLayer) {
  if (!(layer.inertRoot instanceof Element || layer.inertRoot instanceof Document || layer.inertRoot instanceof DocumentFragment)) {
    return;
  }
  layer.observer?.disconnect();
  layer.observer = new MutationObserver(() => recomputeInertness());
  layer.observer.observe(layer.inertRoot, { childList: true, subtree: true });
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
  if (!first || !last) {
    layer.dialog.focus();
    return;
  }
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
    const existingLayer = this.layer;
    if (existingLayer && stack.includes(existingLayer)) {
      existingLayer.container = options.container;
      existingLayer.dialog = options.dialog;
      if (options.onCancel) {
        existingLayer.onCancel = options.onCancel;
      } else {
        delete existingLayer.onCancel;
      }
      existingLayer.inertRoot = options.inertRoot ?? document.body;

      // A host may replace its dialog during a render. Keep this layer at its
      // current depth so an underlying render cannot promote itself over a
      // newer modal, while recalculating paths for the replacement DOM.
      recomputeInertness({ applyBackground: false });
      if (isTopLayer(existingLayer)) {
        focusIntoLayer(existingLayer);
      }
      recomputeInertness();
      observeLayer(existingLayer);
      return;
    }

    if (existingLayer) {
      // A disconnected dialog can be pruned by the observer before its host
      // rerenders. Its next activation is a genuinely new layer.
      removeLayer(existingLayer);
      this.layer = null;
    }

    this.deactivate({ restoreFocus: false });
    const layer: ModalLayer = {
      container: options.container,
      dialog: options.dialog,
      trigger: options.trigger ?? document.activeElement,
      ...(options.onCancel ? { onCancel: options.onCancel } : {}),
      inertRoot: options.inertRoot ?? document.body,
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
    // A competing top layer can still be inert from the previous layer.
    // Restore its interaction path before native focus handling, then inert
    // the former layer after focus has moved into the new dialog.
    recomputeInertness({ applyBackground: false });
    focusIntoLayer(layer);
    recomputeInertness();
    observeLayer(layer);
    document.addEventListener('keydown', layer.keydown, true);
  }

  deactivate(options: { restoreFocus?: boolean } = {}) {
    const layer = this.layer;
    if (!layer) {
      return;
    }
    const wasTop = isTopLayer(layer);
    removeLayer(layer);
    this.layer = null;
    recomputeInertness();

    const survivingLayer = stack[stack.length - 1];
    if (wasTop && survivingLayer) {
      focusIntoLayer(survivingLayer);
      return;
    }

    if (options.restoreFocus !== false && wasTop && layer.trigger instanceof HTMLElement && layer.trigger.isConnected) {
      window.setTimeout(() => {
        const activeElement = document.activeElement;
        if (
          layer.trigger instanceof HTMLElement
          && layer.trigger.isConnected
          && (activeElement === document.body || activeElement === document.documentElement)
        ) {
          layer.trigger.focus();
        }
      }, 0);
    }
  }

  isTopLayerActive() {
    return this.layer !== null && isTopLayer(this.layer);
  }

  focusInitial(preferred?: HTMLElement | null) {
    const layer = this.layer;
    if (!layer || !isTopLayer(layer)) {
      return;
    }
    const target = preferred ?? focusableElements(layer.dialog)[0] ?? layer.dialog;
    queueMicrotask(() => {
      if (this.layer === layer && isTopLayer(layer) && target.isConnected) {
        target.focus();
      }
    });
  }
}
