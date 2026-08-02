import { getNodeDetails } from '../api/nodel-host-client';
import { NODEL_CONFIRM, type NodelConfirmDetail } from '../data/confirm';
import { subscribeConnectivity, type NodelConnectivityState } from '../data/connectivity';
import { getStoredTheme, getSystemThemeMediaQuery, isNodelTheme, resolveTheme, THEME_STORAGE_KEY } from '../theme/theme';
import { refreshNodeActivityForRestart } from '../data/node-activity-source';
import { refreshNodeConsoleForRestart, resetNodeConsoleCursor } from '../data/node-console-source';
import type { NodelSourceRefreshResult } from '../data/nodel-data-runtime';
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
import './nodel-confirm-host';
import type { NodelConfirmHostElement } from './nodel-confirm-host';
import './nodel-connectivity-host';
import { normalizeOfflineMode, type NodelConnectivityHostElement } from './nodel-connectivity-host';
import {
  NODEL_NAVIGATION_CHANGE,
  NODEL_NAV_SELECT,
  type NodelNavigationChangeDetail,
  type NodelNavigationHost,
  type NodelNavItem,
  type NodelNavSelectDetail,
  slugPageTitle
} from '../navigation/navigation';
import { getNodePathName, getSimpleName } from '../utils/node-name';
import { createSignalBindingController } from '../data/signal-bindings';
import { NODEL_APP_TITLE_CHANGE, type NodelAppTitleChangeDetail } from '../data/app-title';
import { updateHostFavicon } from '../icons/favicon';

function setRootTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
}

interface NavigationDiscovery {
  groupByChildId: Map<string, HTMLElement>;
  groupPages: Set<HTMLElement>;
  items: NodelNavItem[];
  pageById: Map<string, HTMLElement>;
}

interface RestartRefreshElement extends Element {
  refreshAfterRestart?: (context?: NodeRestartRefreshContext) => void | boolean | NodeRestartRefreshResult | Promise<void | boolean | NodeRestartRefreshResult>;
}

interface ActivatablePage extends HTMLElement {
  activate?: () => void | Promise<void>;
}

type ToastCustomEvent = CustomEvent<NodelToastDetail>;
type ConfirmCustomEvent = CustomEvent<NodelConfirmDetail>;

interface RestartRefreshOutcome {
  label: string;
  result: NodeRestartRefreshResult;
}

interface SourceRefreshOutcome {
  label: string;
  result: NodelSourceRefreshResult;
}

const restartRefreshLabels: Record<string, string> = {
  'nodel-description': 'Description',
  'nodel-actsig': 'Actions and signals',
  'nodel-params': 'Parameters',
  'nodel-bindings': 'Bindings',
  'nodel-editor': 'Editor'
};

function messageFromUnknown(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function restartRefreshLabel(element: Element) {
  return restartRefreshLabels[element.localName] ?? element.localName;
}

function isRestartRefreshResult(value: unknown): value is NodeRestartRefreshResult {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const status = (value as Partial<NodeRestartRefreshResult>).status;
  return status === 'verified'
    || status === 'dirty-preserved'
    || status === 'conflict'
    || status === 'failed'
    || status === 'aborted'
    || status === 'superseded';
}

function normalizeRestartRefreshOutcome(label: string, settled: PromiseSettledResult<void | boolean | NodeRestartRefreshResult>): RestartRefreshOutcome {
  if (settled.status === 'rejected') {
    return { label, result: { status: 'failed', detail: messageFromUnknown(settled.reason, `${label} refresh failed.`) } };
  }

  if (settled.value === true) {
    return { label, result: { status: 'verified' } };
  }
  if (settled.value === false || settled.value === undefined) {
    return { label, result: { status: 'failed', detail: `${label} did not report a verified refresh.` } };
  }
  if (isRestartRefreshResult(settled.value)) {
    return { label, result: settled.value };
  }

  return { label, result: { status: 'failed', detail: `${label} returned an invalid refresh result.` } };
}

function normalizeSourceRefreshOutcome(label: string, settled: PromiseSettledResult<NodelSourceRefreshResult>): SourceRefreshOutcome {
  if (settled.status === 'rejected') {
    return { label, result: { status: 'failed', detail: messageFromUnknown(settled.reason, `${label} refresh failed.`) } };
  }

  if (settled.value && typeof settled.value === 'object') {
    return { label, result: settled.value };
  }

  return { label, result: { status: 'failed', detail: `${label} returned an invalid refresh result.` } };
}

function formatRefreshIssues(outcomes: Array<RestartRefreshOutcome | SourceRefreshOutcome>) {
  return outcomes
    .map((outcome) => `${outcome.label}: ${outcome.result.detail ?? outcome.result.status}`)
    .join(' ')
    .slice(0, 500);
}

function isNodelPage(element: Element): element is HTMLElement {
  return element.localName === 'nodel-page';
}

function getPageTitle(page: HTMLElement): string {
  return page.getAttribute('nav-label') ?? page.getAttribute('title') ?? 'Page';
}

function getNearestPageParent(page: HTMLElement): HTMLElement | null {
  return page.parentElement?.closest('nodel-page') ?? null;
}

function getDirectChildPages(page: HTMLElement): HTMLElement[] {
  return Array.from(page.querySelectorAll('nodel-page')).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && getNearestPageParent(child) === page
  );
}

function uniquePageId(page: HTMLElement, seen: Map<string, number>) {
  const configuredId = page.getAttribute('nav-id');
  const baseId = configuredId || slugPageTitle(getPageTitle(page));
  const count = seen.get(baseId) ?? 0;
  seen.set(baseId, count + 1);
  return count === 0 ? baseId : `${baseId}${count + 1}`;
}

function eventDetailValue(event: Event, key: string) {
  if (!('detail' in event) || typeof event.detail !== 'object' || event.detail === null) {
    return '';
  }

  const value = (event.detail as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

export class NodelApp extends HTMLElement implements NodelNavigationHost {
  static observedAttributes = ['theme', 'title', 'offline-mode', 'signal', 'signals'];

  private activePageId = '';
  private initialPageActivated = false;
  private lastHandledHash = '';
  private groupByChildId = new Map<string, HTMLElement>();
  private groupPages = new Set<HTMLElement>();
  private mutationObserver: MutationObserver | null = null;
  private navItems: NodelNavItem[] = [];
  private navigationQueued = false;
  private pageById = new Map<string, HTMLElement>();
  private restartWatcher: NodeRestartWatcher | null = null;
  private restartPageOwner: { release(): void } | null = null;
  private restartRefreshGeneration = 0;
  private restartRefreshAbortController: AbortController | null = null;
  private restartRefreshExpectationId: number | null = null;
  private restartRefreshExpectationGeneration: number | null = null;
  private restartDiagnosticsGeneration = 0;
  private restartDiagnosticsAbortController: AbortController | null = null;
  private signalBindings = createSignalBindingController(this);
  private signalTitle: string | null = null;
  private systemThemeMediaQuery: MediaQueryList | null = null;
  private titleLoadToken = 0;
  private confirmHost: NodelConfirmHostElement | null = null;
  private connectivityHost: NodelConnectivityHostElement | null = null;
  private connectivityModalActive = false;
  private connectivityState: NodelConnectivityState = { offline: false, reason: '', retryAttempt: 0 };
  private connectivitySubscription: { dispose(): void } | null = null;
  private toastHost: NodelToastHost | null = null;

  connectedCallback() {
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
    this.mutationObserver = new MutationObserver(() => {
      this.queueNavigationSync();
      this.syncConnectivityPresentation();
    });
    this.mutationObserver.observe(this, { childList: true });
    this.queueNavigationSync();
    if (isNodePage()) {
      this.restartPageOwner = acquireNodeRestartPageOwner();
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
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.restartRefreshGeneration += 1;
    this.restartRefreshAbortController?.abort();
    this.restartRefreshAbortController = null;
    this.restartRefreshExpectationId = null;
    this.restartRefreshExpectationGeneration = null;
    this.restartDiagnosticsGeneration += 1;
    this.restartDiagnosticsAbortController?.abort();
    this.restartDiagnosticsAbortController = null;
    this.restartWatcher?.dispose();
    this.restartWatcher = null;
    this.restartPageOwner?.release();
    this.restartPageOwner = null;
    this.connectivitySubscription?.dispose();
    this.connectivitySubscription = null;
    this.connectivityModalActive = false;
    this.stopThemeSynchronization();
    this.signalBindings.dispose();
    this.confirmHost = null;
    this.connectivityHost = null;
    this.toastHost = null;
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
    return {
      activePageId: this.activePageId,
      items: this.navItems
    };
  }

  getSignalTitle() {
    return this.signalTitle;
  }

  private handleNavSelect = (event: CustomEvent<NodelNavSelectDetail>) => {
    const pageId = event.detail?.pageId;
    if (!pageId || !this.pageById.has(pageId)) {
      return;
    }

    event.preventDefault();
    this.setActivePage(pageId, true, true);
  };

  private handleHashChange = () => {
    const pageId = this.getHashPageId();
    if (pageId && this.pageById.has(pageId)) {
      this.lastHandledHash = window.location.hash;
      this.setActivePage(pageId, false, true);
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
    const refreshGeneration = ++this.restartRefreshGeneration;
    const controller = this.beginRestartRefresh();
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
    void this.refreshAfterNodeRestart(detail, undefined, refreshGeneration, controller.signal).finally(() => {
      if (this.restartRefreshAbortController === controller) {
        this.restartRefreshAbortController = null;
        this.restartRefreshExpectationId = null;
        this.restartRefreshExpectationGeneration = null;
      }
    });
  };

  private handleNodeRestartEvent = (event: NodeRestartEvent) => {
    switch (event.type) {
      case 'expected-preparing':
        return;
      case 'expected-pending':
        if (this.restartRefreshAbortController
          && (this.restartRefreshExpectationId !== event.expectation.id
            || this.restartRefreshExpectationGeneration !== event.expectation.generation)) {
          this.restartRefreshAbortController.abort();
          this.restartRefreshAbortController = null;
          this.restartRefreshExpectationId = null;
          this.restartRefreshExpectationGeneration = null;
          this.restartRefreshGeneration += 1;
        }
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
        void this.refreshRestartDiagnostics(event.expectation.id, event.expectation.generation);
        return;
      case 'expected-confirmed':
        {
          const refreshGeneration = ++this.restartRefreshGeneration;
          const controller = this.beginRestartRefresh(event.expectation.id, event.expectation.generation);
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
          void this.refreshAfterNodeRestart(event.detail, {
            expectation: event.expectation,
            detail: event.detail
          }, refreshGeneration, controller.signal).finally(() => {
            if (this.restartRefreshAbortController === controller) {
              this.restartRefreshAbortController = null;
              this.restartRefreshExpectationId = null;
              this.restartRefreshExpectationGeneration = null;
            }
          });
          return;
        }
      case 'expected-superseded':
        if (this.restartRefreshExpectationId === event.expectation.id
          && this.restartRefreshExpectationGeneration === event.expectation.generation) {
          this.restartRefreshAbortController?.abort();
          this.restartRefreshAbortController = null;
          this.restartRefreshExpectationId = null;
          this.restartRefreshExpectationGeneration = null;
          this.restartRefreshGeneration += 1;
        }
        if (this.restartDiagnosticsAbortController
          && this.restartDiagnosticsExpectationId === event.expectation.id
          && this.restartDiagnosticsExpectationGeneration === event.expectation.generation) {
          this.restartDiagnosticsAbortController.abort();
          this.restartDiagnosticsAbortController = null;
          this.restartDiagnosticsExpectationId = null;
          this.restartDiagnosticsExpectationGeneration = null;
          this.restartDiagnosticsGeneration += 1;
        }
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

  private beginRestartRefresh(expectationId: number | null = null, expectationGeneration: number | null = null) {
    this.restartRefreshAbortController?.abort();
    this.restartDiagnosticsAbortController?.abort();
    this.restartDiagnosticsAbortController = null;
    this.restartDiagnosticsExpectationId = null;
    this.restartDiagnosticsExpectationGeneration = null;
    this.restartDiagnosticsGeneration += 1;
    const controller = new AbortController();
    this.restartRefreshAbortController = controller;
    this.restartRefreshExpectationId = expectationId;
    this.restartRefreshExpectationGeneration = expectationGeneration;
    return controller;
  }

  private async refreshAfterNodeRestart(
    detail: NodeRestartDetail,
    context?: NodeRestartRefreshContext,
    refreshGeneration = this.restartRefreshGeneration,
    signal?: AbortSignal
  ) {
    const refreshTargets = Array.from(this.querySelectorAll<RestartRefreshElement>(
      'nodel-description,nodel-actsig,nodel-params,nodel-bindings,nodel-editor'
    ))
      .map((element) => ({
        label: restartRefreshLabel(element),
        refresh: (() => {
        try {
          const refresh = element.refreshAfterRestart;
          return Promise.resolve(refresh ? refresh.call(element, context) : undefined);
        } catch (error) {
          return Promise.reject(error);
        }
        })()
      }));

    const refreshResults = await Promise.allSettled(refreshTargets.map((target) => target.refresh));
    if (!this.isConnected || refreshGeneration !== this.restartRefreshGeneration) {
      return;
    }
    resetNodeConsoleCursor();
    const sourceRefreshTargets = [
      {
        label: 'Console',
        refresh: Promise.resolve().then(() => refreshNodeConsoleForRestart({ signal, force: true }))
      },
      {
        label: 'Activity',
        refresh: Promise.resolve().then(() => refreshNodeActivityForRestart({ signal, force: true }))
      }
    ];
    const sourceResults = await Promise.allSettled(sourceRefreshTargets.map((target) => target.refresh));
    if (!this.isConnected || refreshGeneration !== this.restartRefreshGeneration) {
      return;
    }

    const refreshOutcomes = refreshResults.map((result, index) => normalizeRestartRefreshOutcome(refreshTargets[index].label, result));
    const sourceOutcomes = sourceResults.map((result, index) => normalizeSourceRefreshOutcome(sourceRefreshTargets[index].label, result));
    const viewFailures = refreshOutcomes.filter((outcome) => outcome.result.status === 'failed'
      || outcome.result.status === 'aborted'
      || outcome.result.status === 'superseded');
    const diagnosticIssues = sourceOutcomes.filter((outcome) => outcome.result.status !== 'verified'
      && outcome.result.status !== 'absent');
    const editorConflict = refreshOutcomes.some((outcome) => outcome.result.status === 'conflict');
    const dirtyPreserved = refreshOutcomes.some((outcome) => outcome.result.status === 'dirty-preserved');
    const conflictDetail = refreshOutcomes.find((outcome) => outcome.result.status === 'conflict')?.result.detail;
    const failed = viewFailures.length > 0;
    const diagnosticDetail = diagnosticIssues.length > 0
      ? `Some diagnostics did not refresh: ${formatRefreshIssues(diagnosticIssues)}`
      : '';
    const failureDetail = failed
      ? formatRefreshIssues(viewFailures)
      : '';
    const result: NodeRestartRefreshResult = failed
      ? { status: 'failed', detail: failureDetail || 'One or more node-backed views failed verification.' }
      : editorConflict
        ? { status: 'conflict', detail: conflictDetail ?? 'A node-backed view could not reconcile its remote content.' }
      : dirtyPreserved
        ? { status: 'dirty-preserved', detail: 'Unsaved editor changes were preserved.' }
        : { status: 'verified' };

    if (context) {
      if (!completeNodeRestartExpectation(context.expectation.id, result)) {
        return;
      }
    }

    this.showToast({
      id: 'node-restart-refresh',
      message: failed
        ? 'Node reloaded, but view verification failed. Local edits were preserved.'
        : editorConflict
          ? 'Node reloaded, but local editor content could not be reconciled. Local edits were preserved.'
          : dirtyPreserved
            ? 'Node reloaded. View refreshed; unsaved editor changes were preserved.'
            : diagnosticIssues.length > 0
              ? 'Node reloaded. View is up to date; diagnostics need refresh.'
              : 'Node reloaded. View is up to date.',
      detail: failed ? failureDetail : diagnosticDetail,
      tone: failed || editorConflict || dirtyPreserved || diagnosticIssues.length > 0 ? 'warning' : 'success',
      durationMs: failed || editorConflict || diagnosticIssues.length > 0 ? 7000 : dirtyPreserved ? 6000 : 3500
    });
  }

  private restartDiagnosticsExpectationId: number | null = null;
  private restartDiagnosticsExpectationGeneration: number | null = null;

  private async refreshRestartDiagnostics(expectationId: number, expectationGeneration: number) {
    const generation = ++this.restartDiagnosticsGeneration;
    this.restartDiagnosticsAbortController?.abort();
    const controller = new AbortController();
    this.restartDiagnosticsAbortController = controller;
    this.restartDiagnosticsExpectationId = expectationId;
    this.restartDiagnosticsExpectationGeneration = expectationGeneration;
    resetNodeConsoleCursor();
    await Promise.allSettled([
      Promise.resolve().then(() => refreshNodeConsoleForRestart({ signal: controller.signal, force: true })),
      Promise.resolve().then(() => refreshNodeActivityForRestart({ signal: controller.signal, force: true }))
    ]);
    if (this.restartDiagnosticsAbortController === controller
      && generation === this.restartDiagnosticsGeneration
      && this.restartDiagnosticsExpectationId === expectationId
      && this.restartDiagnosticsExpectationGeneration === expectationGeneration) {
      this.restartDiagnosticsAbortController = null;
      this.restartDiagnosticsExpectationId = null;
      this.restartDiagnosticsExpectationGeneration = null;
    }
  }

  private ensureToastHost() {
    const existing = Array.from(this.children).find((child): child is NodelToastHost => child.localName === 'nodel-toast-host');
    if (existing) {
      this.toastHost = existing;
      return existing;
    }

    const host = document.createElement('nodel-toast-host') as NodelToastHost;
    this.appendChild(host);
    this.toastHost = host;
    return host;
  }

  private ensureConfirmHost() {
    const existing = Array.from(this.children).find((child): child is NodelConfirmHostElement => child.localName === 'nodel-confirm-host');
    if (existing) {
      this.confirmHost = existing;
      return existing;
    }

    const host = document.createElement('nodel-confirm-host') as NodelConfirmHostElement;
    this.appendChild(host);
    this.confirmHost = host;
    return host;
  }

  private ensureConnectivityHost() {
    const existing = Array.from(this.children).find((child): child is NodelConnectivityHostElement => child.localName === 'nodel-connectivity-host');
    if (existing) {
      this.connectivityHost = existing;
      return existing;
    }

    const host = document.createElement('nodel-connectivity-host') as NodelConnectivityHostElement;
    this.prepend(host);
    this.connectivityHost = host;
    return host;
  }

  private syncConnectivityPresentation() {
    if (!this.isConnected) {
      return;
    }
    const mode = normalizeOfflineMode(this.getAttribute('offline-mode'));
    const host = this.ensureConnectivityHost();
    host.update(this.connectivityState, mode);
    const modalOffline = this.connectivityState.offline && mode === 'modal';

    if (!modalOffline) {
      this.connectivityModalActive = false;
      return;
    }

    const enteredModal = !this.connectivityModalActive;
    if (enteredModal) {
      this.connectivityModalActive = true;
      queueMicrotask(() => {
        if (this.connectivityModalActive) {
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
    const discovery = this.discoverNavigation();
    this.groupByChildId = discovery.groupByChildId;
    this.groupPages = discovery.groupPages;
    this.navItems = discovery.items;
    this.pageById = discovery.pageById;

    const hashPageId = this.getHashPageId();
    const nextPageId =
      (hashPageId && this.pageById.has(hashPageId) && hashPageId) ||
      (this.activePageId && this.pageById.has(this.activePageId) && this.activePageId) ||
      this.pageById.keys().next().value ||
      '';

    const hashActivation = Boolean(hashPageId && this.pageById.has(hashPageId) && window.location.hash !== this.lastHandledHash);
    const activate = Boolean(nextPageId) && (!this.initialPageActivated || hashActivation);
    this.setActivePage(nextPageId, false, activate);
    if (nextPageId) {
      this.initialPageActivated = true;
    }
    if (hashPageId && this.pageById.has(hashPageId)) {
      this.lastHandledHash = window.location.hash;
    }
  }

  private discoverNavigation(): NavigationDiscovery {
    const items: NodelNavItem[] = [];
    const pageById = new Map<string, HTMLElement>();
    const groupByChildId = new Map<string, HTMLElement>();
    const groupPages = new Set<HTMLElement>();
    const seen = new Map<string, number>();
    const topPages = Array.from(this.children).filter(isNodelPage);

    for (const page of topPages) {
      const childPages = getDirectChildPages(page);
      const id = uniquePageId(page, seen);
      const title = getPageTitle(page);

      page.dataset.pageId = id;

      if (childPages.length > 0) {
        groupPages.add(page);
        page.dataset.navGroupPage = 'true';
        const children: NodelNavItem[] = [];

        for (const childPage of childPages) {
          const childId = uniquePageId(childPage, seen);
          childPage.dataset.pageId = childId;
          childPage.dataset.navGroupPage = 'false';
          pageById.set(childId, childPage);
          groupByChildId.set(childId, page);
          children.push({
            type: 'page',
            id: childId,
            title: getPageTitle(childPage)
          });
        }

        items.push({
          type: 'group',
          id,
          title,
          children
        });
      } else {
        page.dataset.navGroupPage = 'false';
        pageById.set(id, page);
        items.push({
          type: 'page',
          id,
          title
        });
      }
    }

    return { groupByChildId, groupPages, items, pageById };
  }

  private setActivePage(pageId: string, updateHash: boolean, activate = false) {
    this.activePageId = pageId;
    this.dataset.activePage = pageId;
    this.applyPageVisibility(pageId);
    if (updateHash && pageId) {
      history.replaceState(undefined, '', `#${pageId}`);
      this.lastHandledHash = window.location.hash;
    }
    this.dispatchNavigationChange();
    if (activate) {
      void (this.pageById.get(pageId) as ActivatablePage | undefined)?.activate?.();
    }
  }

  private applyPageVisibility(activePageId: string) {
    const activeGroup = this.groupByChildId.get(activePageId) ?? null;

    for (const page of this.querySelectorAll('nodel-page')) {
      if (!(page instanceof HTMLElement)) {
        continue;
      }

      const pageId = page.dataset.pageId ?? '';
      const isGroup = this.groupPages.has(page);
      const active = isGroup ? page === activeGroup : pageId === activePageId;

      page.hidden = !active;
      page.toggleAttribute('active', active);
      page.dataset.activePage = String(active);
    }
  }

  private dispatchNavigationChange() {
    this.dispatchEvent(
      new CustomEvent<NodelNavigationChangeDetail>(NODEL_NAVIGATION_CHANGE, {
        detail: this.getNavigationState()
      })
    );
  }

  private getHashPageId() {
    return window.location.hash.replace(/^#/, '');
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
