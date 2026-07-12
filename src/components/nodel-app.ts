import { getNodeDetails } from '../api/nodel-host-client';
import { NODEL_CONFIRM, type NodelConfirmDetail } from '../data/confirm';
import { getStoredTheme, getSystemThemeMediaQuery, isNodelTheme, resolveTheme, THEME_STORAGE_KEY } from '../theme/theme';
import { refreshNodeActivity } from '../data/node-activity-source';
import { refreshNodeConsole, resetNodeConsoleCursor } from '../data/node-console-source';
import { isNodePage, watchNodeRestart, type NodeRestartDetail, type NodeRestartWatcher } from '../data/node-restart-source';
import { NODEL_TOAST, type NodelToastDetail, type NodelToastHost } from './nodel-toast-host';
import './nodel-confirm-host';
import type { NodelConfirmHostElement } from './nodel-confirm-host';
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
  refreshAfterRestart?: () => void | Promise<void>;
}

type ToastCustomEvent = CustomEvent<NodelToastDetail>;
type ConfirmCustomEvent = CustomEvent<NodelConfirmDetail>;

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
  static observedAttributes = ['theme', 'title'];

  private activePageId = '';
  private groupByChildId = new Map<string, HTMLElement>();
  private groupPages = new Set<HTMLElement>();
  private mutationObserver: MutationObserver | null = null;
  private navItems: NodelNavItem[] = [];
  private navigationQueued = false;
  private pageById = new Map<string, HTMLElement>();
  private restartWatcher: NodeRestartWatcher | null = null;
  private systemThemeMediaQuery: MediaQueryList | null = null;
  private titleLoadToken = 0;
  private confirmHost: NodelConfirmHostElement | null = null;
  private toastHost: NodelToastHost | null = null;

  connectedCallback() {
    this.setAttribute('data-nodel-app', 'true');
    this.ensureConfirmHost();
    this.ensureToastHost();
    this.syncTheme();
    this.startThemeSynchronization();
    this.syncTitle();
    this.addEventListener(NODEL_NAV_SELECT, this.handleNavSelect as EventListener);
    this.addEventListener(NODEL_CONFIRM, this.handleConfirmRequest as EventListener);
    this.addEventListener(NODEL_TOAST, this.handleToastRequest as EventListener);
    this.addEventListener('nodel-params-saved', this.handleParamsSaved);
    this.addEventListener('nodel-bindings-saved', this.handleBindingsSaved);
    this.addEventListener('nodel-editor-file-saved', this.handleEditorFileSaved);
    this.addEventListener('nodel-params-error', this.handleParamsError);
    this.addEventListener('nodel-bindings-error', this.handleBindingsError);
    this.addEventListener('nodel-editor-error', this.handleEditorError);
    window.addEventListener('hashchange', this.handleHashChange);
    this.mutationObserver = new MutationObserver(() => this.queueNavigationSync());
    this.mutationObserver.observe(this, { childList: true });
    this.queueNavigationSync();
    if (isNodePage()) {
      this.restartWatcher = watchNodeRestart(this.handleNodeRestart);
    }
  }

  disconnectedCallback() {
    this.titleLoadToken += 1;
    this.removeEventListener(NODEL_NAV_SELECT, this.handleNavSelect as EventListener);
    this.removeEventListener(NODEL_CONFIRM, this.handleConfirmRequest as EventListener);
    this.removeEventListener(NODEL_TOAST, this.handleToastRequest as EventListener);
    this.removeEventListener('nodel-params-saved', this.handleParamsSaved);
    this.removeEventListener('nodel-bindings-saved', this.handleBindingsSaved);
    this.removeEventListener('nodel-editor-file-saved', this.handleEditorFileSaved);
    this.removeEventListener('nodel-params-error', this.handleParamsError);
    this.removeEventListener('nodel-bindings-error', this.handleBindingsError);
    this.removeEventListener('nodel-editor-error', this.handleEditorError);
    window.removeEventListener('hashchange', this.handleHashChange);
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.restartWatcher?.dispose();
    this.restartWatcher = null;
    this.stopThemeSynchronization();
    this.confirmHost = null;
    this.toastHost = null;
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.syncTheme();
      this.syncTitle();
    }
  }

  getNavigationState(): NodelNavigationChangeDetail {
    return {
      activePageId: this.activePageId,
      items: this.navItems
    };
  }

  private handleNavSelect = (event: CustomEvent<NodelNavSelectDetail>) => {
    const pageId = event.detail?.pageId;
    if (!pageId || !this.pageById.has(pageId)) {
      return;
    }

    event.preventDefault();
    this.setActivePage(pageId, true);
  };

  private handleHashChange = () => {
    const pageId = this.getHashPageId();
    if (pageId && this.pageById.has(pageId)) {
      this.setActivePage(pageId, false);
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
    this.ensureConfirmHost().confirm(event.detail, event.target instanceof Element ? event.target : document.activeElement);
  };

  private handleParamsSaved = () => {
    this.showToast({ message: 'Parameters saved', tone: 'success' });
  };

  private handleBindingsSaved = () => {
    this.showToast({ message: 'Bindings saved', tone: 'success' });
  };

  private handleEditorFileSaved = (event: Event) => {
    this.showToast({
      message: 'File saved',
      detail: eventDetailValue(event, 'path'),
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
    void this.refreshAfterNodeRestart();
  };

  private async refreshAfterNodeRestart() {
    const refreshes = Array.from(this.querySelectorAll<RestartRefreshElement>(
      'nodel-description,nodel-actsig,nodel-params,nodel-bindings,nodel-editor'
    ))
      .map((element) => {
        try {
          return element.refreshAfterRestart?.();
        } catch (error) {
          return Promise.reject(error);
        }
      })
      .filter((result): result is void | Promise<void> => result !== undefined);

    const refreshResults = await Promise.allSettled(refreshes);
    resetNodeConsoleCursor();
    const sourceRefreshes = [
      refreshNodeConsole(),
      Promise.resolve().then(() => refreshNodeActivity())
    ];
    const sourceResults = await Promise.allSettled(sourceRefreshes);
    const failed = [...refreshResults, ...sourceResults].some((result) => result.status === 'rejected');

    this.showToast({
      id: 'node-restart-refresh',
      message: failed ? 'Node reloaded, but some sections failed to refresh.' : 'Node reloaded. View is up to date.',
      tone: failed ? 'warning' : 'success',
      durationMs: failed ? 7000 : 3500
    });
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
      this.syncNavigation();
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

    this.setActivePage(nextPageId, false);
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

  private setActivePage(pageId: string, updateHash: boolean) {
    this.activePageId = pageId;
    this.dataset.activePage = pageId;
    this.applyPageVisibility(pageId);
    if (updateHash && pageId) {
      history.replaceState(undefined, '', `#${pageId}`);
    }
    this.dispatchNavigationChange();
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
      if (token !== this.titleLoadToken || this.hasAttribute('title')) {
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
}

if (!customElements.get('nodel-app')) {
  customElements.define('nodel-app', NodelApp);
}
