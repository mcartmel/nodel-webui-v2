const componentLoaders = {
  'nodel-description': () => import('./components/nodel-description'),
  'nodel-node-list': () => import('./components/nodel-node-list'),
  'nodel-add-node': () => import('./components/nodel-add-node'),
  'nodel-node-menu': () => import('./components/nodel-node-menu'),
  'nodel-diagnostics': () => import('./components/nodel-diagnostics'),
  'nodel-host-log': () => import('./components/nodel-host-log'),
  'nodel-diagnostic-charts': () => import('./components/nodel-diagnostic-charts'),
  'nodel-toolkit': () => import('./components/nodel-toolkit'),
  'nodel-console': () => import('./components/nodel-console'),
  'nodel-log': () => import('./components/nodel-log'),
  'nodel-actsig': () => import('./components/nodel-actsig'),
  'nodel-params': () => import('./components/nodel-params'),
  'nodel-bindings': () => import('./components/nodel-bindings'),
  'nodel-editor': () => import('./components/nodel-editor'),
  'nodel-link': () => import('./components/nodel-link')
} as const;

type NodelComponentTag = keyof typeof componentLoaders;

const maxTextLength = 200;
const pendingLoads = new Map<NodelComponentTag, Promise<void>>();
const componentSelector = Object.keys(componentLoaders).join(',');
let loaderBootstrapped = false;

function boundText(value: string, fallback: string) {
  const text = value.trim();
  if (!text) {
    return fallback;
  }
  return text.length <= maxTextLength ? text : `${text.slice(0, maxTextLength - 3)}...`;
}

function normalizeTagName(tagName: string): NodelComponentTag {
  if (typeof tagName !== 'string') {
    throw new Error('Nodel component tag name must be a string');
  }

  const normalizedTagName = tagName.trim().toLowerCase();
  if (!normalizedTagName.startsWith('nodel-') || !(normalizedTagName in componentLoaders)) {
    throw new Error(`Unknown Nodel component "${boundText(normalizedTagName, 'empty tag name')}"`);
  }

  return normalizedTagName as NodelComponentTag;
}

function errorText(error: unknown) {
  if (error instanceof Error) {
    return boundText(error.message, 'unknown component load error');
  }
  if (typeof error === 'string') {
    return boundText(error, 'unknown component load error');
  }
  return 'unknown component load error';
}

function reportLoadFailure(tagName: NodelComponentTag, error: unknown) {
  const message = boundText(`Failed to load Nodel component "${tagName}": ${errorText(error)}`, 'component load failed');
  window.dispatchEvent(new CustomEvent('nodel-component-load-error', {
    detail: { tagName, message }
  }));
  return new Error(message);
}

export async function loadNodelComponent(tagName: string): Promise<void> {
  const normalizedTagName = normalizeTagName(tagName);
  if (customElements.get(normalizedTagName)) {
    return;
  }

  const existingLoad = pendingLoads.get(normalizedTagName);
  if (existingLoad) {
    await existingLoad;
    return;
  }

  let loadPromise: Promise<void>;
  loadPromise = Promise.resolve()
    .then(async () => {
      await componentLoaders[normalizedTagName]();
      if (!customElements.get(normalizedTagName)) {
        throw new Error(`Module did not register ${normalizedTagName}`);
      }
      await customElements.whenDefined(normalizedTagName);
    })
    .catch((error: unknown) => {
      if (pendingLoads.get(normalizedTagName) === loadPromise) {
        pendingLoads.delete(normalizedTagName);
      }
      throw reportLoadFailure(normalizedTagName, error);
    });
  pendingLoads.set(normalizedTagName, loadPromise);

  await loadPromise;
}

function requestAutomaticLoad(tagName: string) {
  void loadNodelComponent(tagName).catch(() => undefined);
}

function isNodelComponentTag(tagName: string): tagName is NodelComponentTag {
  return Object.prototype.hasOwnProperty.call(componentLoaders, tagName);
}

function scanRoot(root: ParentNode) {
  if (root instanceof Element && isNodelComponentTag(root.localName)) {
    requestAutomaticLoad(root.localName);
  }
  for (const element of root.querySelectorAll<HTMLElement>(componentSelector)) {
    if (isNodelComponentTag(element.localName)) {
      requestAutomaticLoad(element.localName);
    }
  }
}

function scanAddedNode(node: Node) {
  if (node instanceof Element || node instanceof Document || node instanceof DocumentFragment) {
    scanRoot(node);
  }
}

export function bootstrapNodelComponentLoader(root: ParentNode = document): void {
  if (loaderBootstrapped) {
    return;
  }
  loaderBootstrapped = true;

  scanRoot(root);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        scanAddedNode(node);
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
}
