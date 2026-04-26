import { resolveTheme } from '../theme/theme';
import {
  NODEL_NAVIGATION_CHANGE,
  NODEL_NAV_SELECT,
  type NodelNavigationChangeDetail,
  type NodelNavigationHost,
  type NodelNavItem,
  type NodelNavSelectDetail,
  slugPageTitle
} from '../navigation/navigation';

function setRootTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
}

interface NavigationDiscovery {
  groupByChildId: Map<string, HTMLElement>;
  groupPages: Set<HTMLElement>;
  items: NodelNavItem[];
  pageById: Map<string, HTMLElement>;
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

export class NodelApp extends HTMLElement implements NodelNavigationHost {
  static observedAttributes = ['theme', 'title'];

  private activePageId = '';
  private groupByChildId = new Map<string, HTMLElement>();
  private groupPages = new Set<HTMLElement>();
  private mutationObserver: MutationObserver | null = null;
  private navItems: NodelNavItem[] = [];
  private navigationQueued = false;
  private pageById = new Map<string, HTMLElement>();

  connectedCallback() {
    this.setAttribute('data-nodel-app', 'true');
    this.syncTheme();
    this.syncTitle();
    this.addEventListener(NODEL_NAV_SELECT, this.handleNavSelect as EventListener);
    window.addEventListener('hashchange', this.handleHashChange);
    this.mutationObserver = new MutationObserver(() => this.queueNavigationSync());
    this.mutationObserver.observe(this, { childList: true });
    this.queueNavigationSync();
  }

  disconnectedCallback() {
    this.removeEventListener(NODEL_NAV_SELECT, this.handleNavSelect as EventListener);
    window.removeEventListener('hashchange', this.handleHashChange);
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
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
    const title = this.getAttribute('title');
    if (title) {
      document.title = title;
    }
  }
}

if (!customElements.get('nodel-app')) {
  customElements.define('nodel-app', NodelApp);
}
