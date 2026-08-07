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

export const NODEL_COMPONENT_LOAD_ERROR = 'nodel-component-load-error';
export interface NodelComponentLoadErrorDetail {
  tagName: string;
  message: string;
  attemptGeneration: number;
}
export type NodelComponentLoadErrorEvent = CustomEvent<NodelComponentLoadErrorDetail>;

export function isNodelComponentTag(tagName: string): tagName is keyof typeof componentLoaders {
  return typeof tagName === 'string' && Object.prototype.hasOwnProperty.call(componentLoaders, tagName);
}

type ComponentLoader = () => Promise<unknown>;
type LoadState = 'idle' | 'loading' | 'failed' | 'loaded';

export interface NodelComponentLoaderOptions {
  loaders?: Record<string, ComponentLoader>;
  customElements?: CustomElementRegistry;
  document?: Document;
  window?: Window;
  reload?: () => void;
}

export interface NodelComponentLoaderInstance {
  loadNodelComponent(tagName: string): Promise<void>;
  bootstrapNodelComponentLoader(root?: ParentNode): void;
  dispose(): void;
}

const maxTextLength = 200;
const fallbackText = 'This Nodel component could not be loaded.';

function boundText(value: string, fallback: string, limit = maxTextLength) {
  const text = value.trim();
  if (!text) return fallback;
  return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}

function errorText(error: unknown) {
  if (error instanceof Error) return boundText(error.message, 'unknown component load error');
  if (typeof error === 'string') return boundText(error, 'unknown component load error');
  return 'unknown component load error';
}

function errorForTag(tagName: string, error?: unknown) {
  return new Error(boundText(
    `Failed to load Nodel component "${tagName}": ${errorText(error)}`,
    'Component load failed.'
  ));
}

function normalizeTagName(tagName: string, loaders: Map<string, ComponentLoader>) {
  if (typeof tagName !== 'string') throw new Error('Nodel component tag name must be a string');
  const normalized = tagName.trim().toLowerCase();
  if (!normalized.startsWith('nodel-') || !loaders.has(normalized)) {
    throw new Error(boundText(`Unknown Nodel component "${normalized}"`, 'Unknown Nodel component.'));
  }
  return normalized;
}

export function createNodelComponentLoader(options: NodelComponentLoaderOptions = {}): NodelComponentLoaderInstance {
  const registry = options.customElements ?? customElements;
  const ownerDocument = options.document ?? document;
  const ownerWindow = options.window ?? window;
  const reload = options.reload ?? (() => ownerWindow.location.reload());
  const loaders = new Map(Object.entries(options.loaders ?? componentLoaders));
  const selector = Array.from(loaders.keys()).join(',');
  const states = new Map<string, {
    status: LoadState;
    attemptGeneration: number;
    promise?: Promise<void>;
    instances: Set<HTMLElement>;
    fallbacks: Map<HTMLElement, HTMLElement>;
  }>();
  let observer: MutationObserver | null = null;
  let disposed = false;
  const disposedError = () => new Error('Nodel component loader is disposed.');

  const getState = (tagName: string) => {
    let state = states.get(tagName);
    if (!state) {
      state = { status: 'idle', attemptGeneration: 0, instances: new Set(), fallbacks: new Map() };
      states.set(tagName, state);
    }
    return state;
  };

  const removeFallback = (state: ReturnType<typeof getState>, element: HTMLElement) => {
    const fallback = state.fallbacks.get(element);
    fallback?.remove();
    state.fallbacks.delete(element);
  };

  const removeInstance = (state: ReturnType<typeof getState>, element: HTMLElement) => {
    removeFallback(state, element);
    state.instances.delete(element);
  };

  const renderFallback = (tagName: string, state: ReturnType<typeof getState>, element: HTMLElement) => {
    if (!element.isConnected) return;
    const existingFallback = state.fallbacks.get(element);
    if (existingFallback) {
      if (existingFallback.previousElementSibling !== element) {
        element.insertAdjacentElement('afterend', existingFallback);
      }
      return;
    }
    const fallback = ownerDocument.createElement('div');
    fallback.className = 'nodel-component-fallback nodel-alert nodel-alert-danger nodel-alert-md';
    fallback.setAttribute('role', 'alert');
    fallback.dataset.nodelComponentFallback = tagName;
    fallback.dataset.nodelComponentAttempt = String(state.attemptGeneration);
    const message = ownerDocument.createElement('span');
    message.textContent = boundText(`${tagName}: ${fallbackText}`, 'Nodel component could not be loaded.', 160);
    const retry = ownerDocument.createElement('button');
    retry.type = 'button';
    retry.className = 'nodel-button nodel-button-danger';
    retry.textContent = 'Retry';
    retry.dataset.nodelComponentRetry = tagName;
    const reloadButton = ownerDocument.createElement('button');
    reloadButton.type = 'button';
    reloadButton.className = 'nodel-button nodel-button-ghost';
    reloadButton.textContent = 'Reload';
    reloadButton.dataset.nodelComponentReload = tagName;
    const actions = ownerDocument.createElement('span');
    actions.className = 'nodel-component-fallback-actions';
    actions.append(retry, reloadButton);
    fallback.append(message, actions);
    retry.addEventListener('click', () => {
      void retryLoad(tagName).catch(() => undefined);
    });
    reloadButton.addEventListener('click', () => reload());
    element.insertAdjacentElement('afterend', fallback);
    state.fallbacks.set(element, fallback);
  };

  const markLoaded = (state: ReturnType<typeof getState>) => {
    state.status = 'loaded';
    state.promise = undefined;
    for (const element of state.instances) removeFallback(state, element);
    state.instances.clear();
  };

  const setRetryDisabled = (tagName: string, disabled: boolean) => {
    const state = getState(tagName);
    for (const fallback of state.fallbacks.values()) {
      const retry = fallback.querySelector<HTMLButtonElement>('[data-nodel-component-retry]');
      if (retry) retry.disabled = disabled;
    }
  };

  const reportFailure = (tagName: string, attemptGeneration: number, cause: unknown) => {
    const error = errorForTag(tagName, cause);
    ownerWindow.dispatchEvent(new CustomEvent<NodelComponentLoadErrorDetail>(NODEL_COMPONENT_LOAD_ERROR, {
      detail: { tagName, message: error.message, attemptGeneration }
    }));
    return error;
  };

  const startLoad = (tagName: string) => {
    const state = getState(tagName);
    if (registry.get(tagName)) {
      markLoaded(state);
      return Promise.resolve();
    }
    if (state.promise) return state.promise;
    state.status = 'loading';
    state.attemptGeneration += 1;
    const generation = state.attemptGeneration;
    for (const fallback of state.fallbacks.values()) {
      fallback.dataset.nodelComponentAttempt = String(generation);
    }
    const promise = Promise.resolve().then(async () => {
      await loaders.get(tagName)?.();
      if (!registry.get(tagName)) throw new Error('Component definition missing');
      await registry.whenDefined(tagName);
    }).then(() => {
      markLoaded(state);
    }).catch((cause: unknown) => {
      state.status = 'failed';
      state.promise = undefined;
      if (disposed) {
        for (const element of state.instances) removeInstance(state, element);
        throw errorForTag(tagName, cause);
      }
      for (const element of state.instances) renderFallback(tagName, state, element);
      throw reportFailure(tagName, generation, cause);
    });
    state.promise = promise;
    return promise;
  };

  const retryLoad = (tagName: string) => {
    const state = getState(tagName);
    setRetryDisabled(tagName, true);
    if (state.status === 'failed') {
      state.status = 'idle';
      state.promise = undefined;
    }
    const promise = startLoad(tagName);
    return promise.catch((error: unknown) => {
      setRetryDisabled(tagName, false);
      throw error;
    }).finally(() => {
      if (getState(tagName).status === 'loaded') setRetryDisabled(tagName, false);
    });
  };

  const requestAutomaticLoad = (element: HTMLElement) => {
    const tagName = element.localName;
    if (!loaders.has(tagName) || !element.isConnected) return;
    const state = getState(tagName);
    state.instances.add(element);
    if (state.status === 'failed') {
      renderFallback(tagName, state, element);
      return;
    }
    void startLoad(tagName).catch(() => undefined);
  };

  const scanRoot = (root: ParentNode) => {
    if (root instanceof Element && loaders.has(root.localName)) requestAutomaticLoad(root as HTMLElement);
    for (const element of root.querySelectorAll<HTMLElement>(selector)) requestAutomaticLoad(element);
  };

  const scanRemoved = () => {
    for (const state of states.values()) {
      for (const element of state.instances) if (!element.isConnected) removeInstance(state, element);
      for (const [element, fallback] of state.fallbacks) {
        if (!fallback.isConnected) state.fallbacks.delete(element);
      }
    }
  };

  const bootstrap = (root: ParentNode = ownerDocument) => {
    if (disposed || observer) return;
    scanRoot(root);
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element || node instanceof Document || node instanceof DocumentFragment) scanRoot(node);
        }
      }
      scanRemoved();
    });
    observer.observe(root, { childList: true, subtree: true });
  };

  return {
    loadNodelComponent: async (tagName: string) => {
      if (disposed) throw disposedError();
      const normalized = normalizeTagName(tagName, loaders);
      if (registry.get(normalized)) {
        markLoaded(getState(normalized));
        return;
      }
      await (getState(normalized).status === 'failed' ? retryLoad(normalized) : startLoad(normalized));
    },
    bootstrapNodelComponentLoader: bootstrap,
    dispose: () => {
      disposed = true;
      observer?.disconnect();
      observer = null;
      for (const state of states.values()) {
        for (const element of state.instances) removeInstance(state, element);
      }
      states.clear();
    }
  };
}

const productionLoader = createNodelComponentLoader();
export const loadNodelComponent = productionLoader.loadNodelComponent;
export const bootstrapNodelComponentLoader = productionLoader.bootstrapNodelComponentLoader;
