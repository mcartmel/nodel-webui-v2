import { getNodeDetails } from '../api/nodel-host-client';
import { NODEL_CONFIRM, type NodelConfirmDetail } from '../data/confirm';
import { subscribeConnectivity, type NodelConnectivityState } from '../data/connectivity';
import { getStoredTheme, getSystemThemeMediaQuery, isNodelTheme, resolveTheme, THEME_STORAGE_KEY } from '../theme/theme';
import { refreshNodeActivityForRestart } from '../data/node-activity-source';
import { refreshNodeConsoleForRestart, resetNodeConsoleCursor } from '../data/node-console-source';
import {
  acquireNodeRestartPageOwner,
  completeNodeRestartExpectation,
  isNodePage,
  watchNodeRestart,
  type NodeRestartDetail,
  type NodeRestartEvent,
  type NodeRestartRefreshContext,
  type NodeRestartRefreshResult,
  type NodeRestartWatcher
} from '../data/node-restart-source';
import { NODEL_TOAST, type NodelToastDetail, type NodelToastHost } from './nodel-toast-host';
import { normalizeOfflineMode, type NodelConnectivityHostElement } from './nodel-connectivity-host';
import { ConnectivityPresentationController } from '../data/connectivity-presentation';
import { NodeRestartRefreshController, type RestartRefreshSummary, type RestartRefreshTarget } from '../data/node-restart-refresh-controller';
import './nodel-confirm-host';
// Keep the type-only import next to the registration side effect.

import type { NodelConfirmHostElement } from './nodel-confirm-host';
import {
  NODEL_NAVIGATION_CHANGE,
  NODEL_NAV_SELECT,
  type NodelNavigationChangeDetail,
  type NodelNavigationHost,
  type NodelNavSelectDetail
} from '../navigation/navigation';
import { AppNavigationController, type AppNavigationPage, type AppNavigationTransition } from '../navigation/app-navigation-controller';
import { claimNodelPageActive, clearNodelPageActive } from '../data/visibility-scope';
import { getNodePathName, getSimpleName } from '../utils/node-name';
import { createSignalBindingController } from '../data/signal-bindings';
import { NODEL_APP_TITLE_CHANGE, type NodelAppTitleChangeDetail } from '../data/app-title';
import { updateHostFavicon } from '../icons/favicon';
import {
  NODEL_COMPONENT_LOAD_ERROR,
  isNodelComponentTag,
  type NodelComponentLoadErrorDetail
} from '../nodel-component-loader';

function setRootTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
}

interface RestartRefreshElement extends Element {
  refreshAfterRestart?: (context?: NodeRestartRefreshContext) => void | boolean | NodeRestartRefreshResult | Promise<void | boolean | NodeRestartRefreshResult>;
}

interface ActivatablePage extends HTMLElement {
  activate?: () => void | Promise<void>;
}

type ToastCustomEvent = CustomEvent<NodelToastDetail>;
type ConfirmCustomEvent = CustomEvent<NodelConfirmDetail>;
type ComponentLoadErrorEvent = CustomEvent<Partial<NodelComponentLoadErrorDetail>>;

const restartRefreshLabels: Record<string, string> = {
  'nodel-description': 'Description',
  'nodel-actsig': 'Actions and signals',
  'nodel-params': 'Parameters',
  'nodel-bindings': 'Bindings',
  'nodel-editor': 'Editor'
};

function restartRefreshLabel(element: Element) {
  return restartRefreshLabels[element.localName] ?? element.localName;
}

function isNodelPage(element: Element): element is HTMLElement {
  return element.localName === 'nodel-page';
}

function getDirectChildPages(page: HTMLElement): HTMLElement[] {
  const content = Array.from(page.children).find((child) => child.matches('[data-page-content]'));
  const authored = Array.from(page.children).filter(isNodelPage);
  const generated = content ? Array.from(content.children).filter(isNodelPage) : [];
  return [...new Set([...generated, ...authored])];
}

function eventDetailValue(event: Event, key: string) {
  if (!('detail' in event) || typeof event.detail !== 'object' || event.detail === null) {
    return '';
  }

  const value = (event.detail as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function containsNodelPage(nodes: NodeList) {
  return Array.from(nodes).some((node) => {
    if (!(node instanceof Element)) {
      return false;
    }
    return node.localName === 'nodel-page' || node.querySelector('nodel-page') !== null;
  });
}

function classifyAppMutations(records: MutationRecord[], app: HTMLElement) {
  let directChildMutation = false;
  let pageStructureMutation = false;
  for (const record of records) {
    if (record.type !== 'childList') {
      continue;
    }
    if (record.target === app) {
      directChildMutation = true;
    }
    if (containsNodelPage(record.addedNodes) || containsNodelPage(record.removedNodes)) {
      pageStructureMutation = true;
    }
  }
  return { directChildMutation, pageStructureMutation };
}

export class NodelApp extends HTMLElement implements NodelNavigationHost {
  static observedAttributes = ['theme', 'title', 'offline-mode', 'signal', 'signals'];

  private navigation = new AppNavigationController<HTMLElement>();
  private mutationObserver: MutationObserver | null = null;
  private navigationQueued = false;
  private restartWatcher: NodeRestartWatcher | null = null;
  private restartPageOwner: { release(): void } | null = null;
  private restartRefresh: NodeRestartRefreshController | null = null;
  private signalBindings = createSignalBindingController(this);
  private signalTitle: string | null = null;
  private systemThemeMediaQuery: MediaQueryList | null = null;
  private titleLoadToken = 0;
  private connectivityPresentation = new ConnectivityPresentationController();
  private connectivityState: NodelConnectivityState = { offline: false, reason: '', retryAttempt: 0 };
  private connectivitySubscription: { dispose(): void } | null = null;
  private componentLoadGenerations = new Map<string, number>();

  connectedCallback() {
    this.resetPageVisibility();
    this.setAttribute('data-nodel-app', 'true');
    this.ensureConnectivityHost();
    this.ensureConfirmHost();
    this.ensureToastHost();
    updateHostFavicon();
    this.connectivitySubscription = subscribeConnectivity(this.handleConnectivityChange);
    this.syncTheme();
    this.startThemeSynchronization();
    this.syncTitle();
    this.syncSignalSubscription();
    this.addEventListener(NODEL_NAV_SELECT, this.handleNavSelect as EventListener);
    this.addEventListener(NODEL_CONFIRM, this.handleConfirmRequest as EventListener);
    this.addEventListener(NODEL_TOAST, this.handleToastRequest as EventListener);
    this.addEventListener('nodel-params-saved', this.handleParamsSaved);
    this.addEventListener('nodel-bindings-saved', this.handleBindingsSaved);
    this.addEventListener('nodel-editor-file-saved', this.handleEditorFileSaved);
    this.addEventListener('nodel-add-node-error', this.handleAddNodeError);
    this.addEventListener('nodel-params-error', this.handleParamsError);
    this.addEventListener('nodel-bindings-error', this.handleBindingsError);
    this.addEventListener('nodel-editor-error', this.handleEditorError);
    window.addEventListener('hashchange', this.handleHashChange);
    window.addEventListener(NODEL_COMPONENT_LOAD_ERROR, this.handleComponentLoadError as EventListener);
    this.mutationObserver = new MutationObserver((records) => {
      const { directChildMutation, pageStructureMutation } = classifyAppMutations(records, this);
      if (directChildMutation || pageStructureMutation) {
        this.queueNavigationSync();
      }
      if (directChildMutation) {
        this.syncConnectivityPresentation();
      }
    });
    this.mutationObserver.observe(this, { childList: true, subtree: true });
    this.queueNavigationSync();
    if (isNodePage()) {
      this.restartPageOwner = acquireNodeRestartPageOwner();
      this.restartRefresh = new NodeRestartRefreshController({
        resetConsoleCursor: resetNodeConsoleCursor,
        refreshConsole: refreshNodeConsoleForRestart,
        refreshActivity: refreshNodeActivityForRestart
      });
      this.restartWatcher = watchNodeRestart(this.handleNodeRestart, this.handleNodeRestartEvent);
    }
  }

  disconnectedCallback() {
    this.titleLoadToken += 1;
    this.signalTitle = null;
    this.removeEventListener(NODEL_NAV_SELECT, this.handleNavSelect as EventListener);
    this.removeEventListener(NODEL_CONFIRM, this.handleConfirmRequest as EventListener);
    this.removeEventListener(NODEL_TOAST, this.handleToastRequest as EventListener);
    this.removeEventListener('nodel-params-saved', this.handleParamsSaved);
    this.removeEventListener('nodel-bindings-saved', this.handleBindingsSaved);
    this.removeEventListener('nodel-editor-file-saved', this.handleEditorFileSaved);
    this.removeEventListener('nodel-add-node-error', this.handleAddNodeError);
    this.removeEventListener('nodel-params-error', this.handleParamsError);
    this.removeEventListener('nodel-bindings-error', this.handleBindingsError);
    this.removeEventListener('nodel-editor-error', this.handleEditorError);
    window.removeEventListener('hashchange', this.handleHashChange);
    window.removeEventListener(NODEL_COMPONENT_LOAD_ERROR, this.handleComponentLoadError as EventListener);
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.restartRefresh?.dispose();
    this.restartRefresh = null;
    this.restartWatcher?.dispose();
    this.restartWatcher = null;
    this.restartPageOwner?.release();
    this.restartPageOwner = null;
    this.connectivitySubscription?.dispose();
    this.connectivitySubscription = null;
    this.connectivityPresentation.reset();
    this.stopThemeSynchronization();
    this.signalBindings.dispose();
    this.clearPageClaims();
  }

  attributeChangedCallback(name: string) {
    if (!this.isConnected) {
      return;
    }
    if (name === 'theme') {
      this.syncTheme();
    } else if (name === 'title') {
      this.syncTitle();
    } else if (name === 'signal' || name === 'signals') {
      this.signalTitle = null;
      this.syncTitle();
      this.dispatchSignalTitleChange();
      this.syncSignalSubscription();
    } else if (name === 'offline-mode') {
      this.syncConnectivityPresentation();
    }
  }

  getNavigationState(): NodelNavigationChangeDetail {
    return this.navigation.getState();
  }

  getSignalTitle() {
    return this.signalTitle;
  }

  private handleNavSelect = (event: CustomEvent<NodelNavSelectDetail>) => {
    const pageId = event.detail?.pageId;
    if (!pageId) {
      return;
    }
    const transition = this.navigation.select(pageId);
    if (transition) {
      event.preventDefault();
      this.applyNavigationTransition(transition);
    }
  };

  private handleHashChange = () => {
    const transition = this.navigation.handleHash(window.location.hash);
    if (transition) {
      this.applyNavigationTransition(transition);
    }
  };

  private handleSystemThemeChange = () => {
    if (!this.hasExplicitTheme() && getStoredTheme() === null) {
      this.syncTheme();
    }
  };

  private handleThemeStorageChange = (event: StorageEvent) => {
    if ((event.key === THEME_STORAGE_KEY || event.key === null) && !this.hasExplicitTheme()) {
      this.syncTheme();
    }
  };

  private handleToastRequest = (event: ToastCustomEvent) => {
    this.showToast(event.detail);
  };

  private handleComponentLoadError = (event: ComponentLoadErrorEvent) => {
    const tagName = event.detail?.tagName;
    const rawGeneration = event.detail?.attemptGeneration;
    if (typeof tagName !== 'string' || !isNodelComponentTag(tagName)
      || typeof rawGeneration !== 'number' || !Number.isSafeInteger(rawGeneration) || rawGeneration < 1) {
      return;
    }
    const generation = rawGeneration;
    const previousGeneration = this.componentLoadGenerations.get(tagName);
    if (previousGeneration !== undefined && previousGeneration >= generation) {
      return;
    }
    this.componentLoadGenerations.set(tagName, generation);
    this.showToast({
      id: `nodel-component-load-${tagName}-${generation}`,
      message: `${tagName} could not be loaded.`,
      tone: 'danger'
    });
  };

  private handleConfirmRequest = (event: ConfirmCustomEvent) => {
    event.preventDefault();
    const eventTarget = event.target instanceof Element ? event.target : null;
    const activeElement = document.activeElement;
    const targetControl = eventTarget?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? null;
    const trigger = event.detail.trigger
      ?? (activeElement instanceof Element && eventTarget?.contains(activeElement) ? activeElement : null)
      ?? targetControl
      ?? eventTarget
      ?? activeElement;
    this.ensureConfirmHost().confirm(event.detail, trigger);
  };

  private handleConnectivityChange = (state: NodelConnectivityState) => {
    this.connectivityState = state;
    this.syncConnectivityPresentation();
  };

  private handleParamsSaved = () => {
    this.showToast({ message: 'Parameters saved', tone: 'success' });
  };

  private handleBindingsSaved = () => {
    this.showToast({ message: 'Bindings saved', tone: 'success' });
  };

  private handleEditorFileSaved = (event: Event) => {
    const path = eventDetailValue(event, 'path');
    if (path === 'script.py') {
      this.showScriptReloadPending();
      return;
    }
    this.showToast({
      message: 'File saved',
      detail: path,
      tone: 'success'
    });
  };

  private handleParamsError = (event: Event) => {
    this.showToast({
      message: 'Failed to save parameters',
      detail: eventDetailValue(event, 'error'),
      tone: 'danger',
      durationMs: 7000
    });
  };

  private handleAddNodeError = (event: Event) => {
    this.showToast({
      message: 'Failed to add node',
      detail: eventDetailValue(event, 'error'),
      tone: 'danger',
      durationMs: 7000
    });
  };

  private handleBindingsError = (event: Event) => {
    this.showToast({
      message: 'Failed to save bindings',
      detail: eventDetailValue(event, 'error'),
      tone: 'danger',
      durationMs: 7000
    });
  };

  private handleEditorError = (event: Event) => {
    this.showToast({
      message: 'Editor action failed',
      detail: eventDetailValue(event, 'message'),
      tone: 'danger',
      durationMs: 7000
    });
  };

  private handleNodeRestart = (detail: NodeRestartDetail) => {
    this.showToast({
      id: 'node-restart-refresh',
      message: 'Node restarted. Refreshing view...',
      tone: 'info',
      persistent: true
    });
    this.dispatchEvent(new CustomEvent('nodel-node-restarted', {
      bubbles: true,
      detail
    }));
    void this.restartRefresh?.startManual(this.restartTargets()).then((summary) => this.completeRestartRefresh(summary));
  };

  private handleNodeRestartEvent = (event: NodeRestartEvent) => {
    switch (event.type) {
      case 'expected-preparing':
        return;
      case 'expected-pending':
        this.restartRefresh?.invalidateForPending(event.expectation);
        this.showScriptReloadPending();
        return;
      case 'expected-timeout':
        this.showToast({
          id: 'node-restart-refresh',
          message: 'Reload was not confirmed within 30 seconds.',
          detail: 'Local edits are preserved. Check Console. A corrective save is available.',
          tone: 'warning',
          persistent: true
        });
        void this.restartRefresh?.refreshTimeoutDiagnostics(event.expectation);
        return;
      case 'expected-confirmed':
        {
          this.showToast({
            id: 'node-restart-refresh',
            message: 'Node restarted. Refreshing view...',
            tone: 'info',
            persistent: true
          });
          this.dispatchEvent(new CustomEvent('nodel-node-restarted', {
            bubbles: true,
            detail: {
              ...event.detail,
              expectation: event.expectation
            }
          }));
          void this.restartRefresh?.startExpected({
            expectation: event.expectation,
            detail: event.detail
          }, this.restartTargets()).then((summary) => this.completeRestartRefresh(summary));
          return;
        }
      case 'expected-superseded':
        this.restartRefresh?.supersede(event.expectation);
        return;
      case 'expected-verified':
      case 'expected-verification-failed':
        return;
      case 'restart':
        return;
    }
  };

  private showScriptReloadPending() {
    this.showToast({
      id: 'node-restart-refresh',
      message: 'script.py saved. Waiting for node reload...',
      detail: 'Newer edits stay local while the reload is pending.',
      tone: 'info',
      persistent: true
    });
  };

  private restartTargets(): RestartRefreshTarget[] {
    return Array.from(this.querySelectorAll<RestartRefreshElement>(
      'nodel-description,nodel-actsig,nodel-params,nodel-bindings,nodel-editor'
    ))
      .map((element) => ({
        label: restartRefreshLabel(element),
        refresh: (context?: NodeRestartRefreshContext) => {
          const refresh = element.refreshAfterRestart;
          return refresh ? refresh.call(element, context) : undefined;
        }
      }));
  }

  private completeRestartRefresh(summary: RestartRefreshSummary | null) {
    if (!summary || (summary.expectation && !completeNodeRestartExpectation(summary.expectation.id, summary.result))) {
      return;
    }
    this.showToast({
      id: 'node-restart-refresh',
      message: summary.failed
        ? 'Node reloaded, but view verification failed. Local edits were preserved.'
        : summary.conflict
          ? 'Node reloaded, but local editor content could not be reconciled. Local edits were preserved.'
          : summary.dirtyPreserved
            ? 'Node reloaded. View refreshed; unsaved editor changes were preserved.'
            : summary.diagnosticIssues
              ? 'Node reloaded. View is up to date; diagnostics need refresh.'
              : 'Node reloaded. View is up to date.',
      detail: summary.failed ? summary.failureDetail : summary.diagnosticDetail,
      tone: summary.failed || summary.conflict || summary.dirtyPreserved || summary.diagnosticIssues ? 'warning' : 'success',
      durationMs: summary.failed || summary.conflict || summary.diagnosticIssues ? 7000 : summary.dirtyPreserved ? 6000 : 3500
    });
  }

  private ensureToastHost() {
    const existing = Array.from(this.children).find((child): child is NodelToastHost => child.localName === 'nodel-toast-host');
    if (existing) {
      return existing;
    }

    const host = document.createElement('nodel-toast-host') as NodelToastHost;
    this.appendChild(host);
    return host;
  }

  private ensureConfirmHost() {
    const existing = Array.from(this.children).find((child): child is NodelConfirmHostElement => child.localName === 'nodel-confirm-host');
    if (existing) {
      return existing;
    }

    const host = document.createElement('nodel-confirm-host') as NodelConfirmHostElement;
    this.appendChild(host);
    return host;
  }

  private ensureConnectivityHost() {
    const existing = Array.from(this.children).find((child): child is NodelConnectivityHostElement => child.localName === 'nodel-connectivity-host');
    if (existing) {
      return existing;
    }

    const host = document.createElement('nodel-connectivity-host') as NodelConnectivityHostElement;
    this.prepend(host);
    return host;
  }

  private syncConnectivityPresentation() {
    if (!this.isConnected) {
      return;
    }
    const mode = normalizeOfflineMode(this.getAttribute('offline-mode'));
    const host = this.ensureConnectivityHost();
    host.update(this.connectivityState, mode);
    const transition = this.connectivityPresentation.update(this.connectivityState, mode);
    if (transition.requestFocus) {
      queueMicrotask(() => {
        if (this.connectivityPresentation.isFocusCurrent(transition.focusToken)) {
          host.focusDialog();
        }
      });
    }
  }

  private showToast(detail: NodelToastDetail) {
    this.ensureToastHost().show(detail);
  }

  private queueNavigationSync() {
    if (this.navigationQueued) {
      return;
    }

    this.navigationQueued = true;
    queueMicrotask(() => {
      this.navigationQueued = false;
      if (this.isConnected) {
        this.syncNavigation();
      }
    });
  }

  private syncNavigation() {
    this.applyNavigationTransition(this.navigation.sync(this.navigationSnapshot(), window.location.hash));
  }

  private navigationSnapshot(): AppNavigationPage<HTMLElement>[] {
    const snapshot = (page: HTMLElement): AppNavigationPage<HTMLElement> => ({
      page,
      navId: page.getAttribute('nav-id'),
      navLabel: page.getAttribute('nav-label'),
      title: page.getAttribute('title')
    });
    return Array.from(this.children).filter(isNodelPage).map((page) => ({
      ...snapshot(page),
      children: getDirectChildPages(page).map(snapshot)
    }));
  }

  private resetPageVisibility() {
    for (const page of this.querySelectorAll<HTMLElement>('nodel-page')) {
      clearNodelPageActive(page, this);
      page.hidden = true;
      page.toggleAttribute('active', false);
      page.dataset.activePage = 'false';
    }
  }

  private applyNavigationTransition(transition: AppNavigationTransition<HTMLElement>) {
    this.dataset.activePage = transition.detail.activePageId;
    this.resetPageVisibility();
    for (const state of transition.visibility) {
      state.page.dataset.pageId = state.id;
      state.page.dataset.navGroupPage = String(state.group);
      state.page.hidden = !state.active;
      state.page.toggleAttribute('active', state.active);
      state.page.dataset.activePage = String(state.active);
      if (state.active) {
        claimNodelPageActive(state.page, this);
      }
    }
    if (transition.hashWrite) {
      history.replaceState(undefined, '', transition.hashWrite);
    }
    this.dispatchEvent(
      new CustomEvent<NodelNavigationChangeDetail>(NODEL_NAVIGATION_CHANGE, {
        detail: transition.detail
      })
    );
    if (transition.pageToActivate) {
      void (transition.pageToActivate as ActivatablePage).activate?.();
    }
  }

  private clearPageClaims() {
    for (const page of this.querySelectorAll<HTMLElement>('nodel-page')) {
      clearNodelPageActive(page, this);
    }
  }

  private hasExplicitTheme() {
    return isNodelTheme(this.getAttribute('theme'));
  }

  private startThemeSynchronization() {
    this.systemThemeMediaQuery = getSystemThemeMediaQuery();
    if (this.systemThemeMediaQuery) {
      if (typeof this.systemThemeMediaQuery.addEventListener === 'function') {
        this.systemThemeMediaQuery.addEventListener('change', this.handleSystemThemeChange);
      } else {
        this.systemThemeMediaQuery.addListener(this.handleSystemThemeChange);
      }
    }
    window.addEventListener('storage', this.handleThemeStorageChange);
  }

  private stopThemeSynchronization() {
    if (this.systemThemeMediaQuery) {
      if (typeof this.systemThemeMediaQuery.removeEventListener === 'function') {
        this.systemThemeMediaQuery.removeEventListener('change', this.handleSystemThemeChange);
      } else {
        this.systemThemeMediaQuery.removeListener(this.handleSystemThemeChange);
      }
      this.systemThemeMediaQuery = null;
    }
    window.removeEventListener('storage', this.handleThemeStorageChange);
  }

  private syncTheme() {
    const theme = resolveTheme(this.getAttribute('theme'));
    setRootTheme(theme);
    this.dispatchEvent(
      new CustomEvent('nodel-theme-change', {
        bubbles: true,
        detail: { theme }
      })
    );
  }

  private syncTitle() {
    const token = ++this.titleLoadToken;
    if (this.signalTitle !== null) {
      document.title = this.signalTitle;
      return;
    }
    const title = this.getAttribute('title');
    if (title) {
      document.title = title;
      return;
    }

    if (!getNodePathName()) {
      return;
    }

    void this.loadNodeTitle(token);
  }

  private async loadNodeTitle(token: number) {
    try {
      const data = await getNodeDetails();
      if (token !== this.titleLoadToken || this.hasAttribute('title') || this.signalTitle !== null) {
        return;
      }

      const name = typeof data.name === 'string' ? getSimpleName(data.name).trim() : '';
      if (name) {
        document.title = name;
      }
    } catch {
      // Node title lookup is best-effort; leave the static page title in place if it fails.
    }
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'title', {
      title: (value) => {
        this.signalTitle = value;
        this.syncTitle();
        this.dispatchSignalTitleChange();
      }
    });
  }

  private dispatchSignalTitleChange() {
    this.dispatchEvent(new CustomEvent<NodelAppTitleChangeDetail>(NODEL_APP_TITLE_CHANGE, {
      detail: { title: this.signalTitle }
    }));
  }
}

if (!customElements.get('nodel-app')) {
  customElements.define('nodel-app', NodelApp);
}
