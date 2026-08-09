import type { NodelNavItem, NodelNavigationChangeDetail } from './navigation';
import { slugPageTitle } from './navigation';
import { encodeUrlPathSegment } from '../utils/urls';

export interface AppNavigationPage<T> {
  page: T;
  navId: string | null;
  navLabel: string | null;
  title: string | null;
  children?: readonly AppNavigationPage<T>[];
}

export interface AppNavigationVisibility<T> {
  page: T;
  id: string;
  group: boolean;
  active: boolean;
}

export interface AppNavigationTransition<T> {
  detail: NodelNavigationChangeDetail;
  visibility: AppNavigationVisibility<T>[];
  pageToActivate: T | null;
  hashWrite: string | null;
}

interface NavigationModel<T> {
  items: NodelNavItem[];
  pageById: Map<string, T>;
  groupByChildId: Map<string, T>;
  groupPages: Set<T>;
  pageIds: Map<T, string>;
}

function pageTitle<T>(page: AppNavigationPage<T>) {
  return page.navLabel ?? page.title ?? 'Page';
}

function uniquePageId<T>(page: AppNavigationPage<T>, seen: Map<string, number>) {
  const base = page.navId || slugPageTitle(pageTitle(page));
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}${count + 1}`;
}

function decodeHash(hash: string) {
  try {
    return decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return '';
  }
}

/** Pure navigation state and page model for an app-provided page snapshot. */
export class AppNavigationController<T> {
  private activePageId = '';
  private initialPageActivated = false;
  private lastHandledHash = '';
  private model: NavigationModel<T> = {
    items: [],
    pageById: new Map(),
    groupByChildId: new Map(),
    groupPages: new Set(),
    pageIds: new Map()
  };

  getState(): NodelNavigationChangeDetail {
    return { activePageId: this.activePageId, items: this.model.items };
  }

  sync(pages: readonly AppNavigationPage<T>[], hash: string): AppNavigationTransition<T> {
    this.model = this.discover(pages);
    const hashPageId = decodeHash(hash);
    const validHash = hashPageId && this.model.pageById.has(hashPageId) ? hashPageId : '';
    const nextPageId = validHash
      || (this.activePageId && this.model.pageById.has(this.activePageId) ? this.activePageId : '')
      || this.model.pageById.keys().next().value
      || '';
    const hashActivation = Boolean(validHash && hash !== this.lastHandledHash);
    const activate = Boolean(nextPageId) && (!this.initialPageActivated || hashActivation);
    if (nextPageId) {
      this.initialPageActivated = true;
    }
    if (validHash) {
      this.lastHandledHash = hash;
    }
    return this.transition(nextPageId, activate, null);
  }

  select(pageId: string): AppNavigationTransition<T> | null {
    if (!this.model.pageById.has(pageId)) {
      return null;
    }
    const hashWrite = `#${encodeUrlPathSegment(pageId)}`;
    this.lastHandledHash = hashWrite;
    return this.transition(pageId, true, hashWrite);
  }

  handleHash(hash: string): AppNavigationTransition<T> | null {
    const pageId = decodeHash(hash);
    if (!pageId || !this.model.pageById.has(pageId)) {
      return null;
    }
    if (hash === this.lastHandledHash && pageId === this.activePageId) {
      return null;
    }
    this.lastHandledHash = hash;
    return this.transition(pageId, true, null);
  }

  private discover(pages: readonly AppNavigationPage<T>[]): NavigationModel<T> {
    const items: NodelNavItem[] = [];
    const pageById = new Map<string, T>();
    const groupByChildId = new Map<string, T>();
    const groupPages = new Set<T>();
    const pageIds = new Map<T, string>();
    const seen = new Map<string, number>();

    for (const page of pages) {
      const id = uniquePageId(page, seen);
      const title = pageTitle(page);
      pageIds.set(page.page, id);
      const children = page.children ?? [];
      if (children.length > 0) {
        groupPages.add(page.page);
        const childItems: NodelNavItem[] = [];
        for (const child of children) {
          const childId = uniquePageId(child, seen);
          pageIds.set(child.page, childId);
          pageById.set(childId, child.page);
          groupByChildId.set(childId, page.page);
          childItems.push({ type: 'page', id: childId, title: pageTitle(child) });
        }
        items.push({ type: 'group', id, title, children: childItems });
      } else {
        pageById.set(id, page.page);
        items.push({ type: 'page', id, title });
      }
    }
    return { items, pageById, groupByChildId, groupPages, pageIds };
  }

  private transition(pageId: string, activate: boolean, hashWrite: string | null): AppNavigationTransition<T> {
    this.activePageId = pageId;
    const activeGroup = this.model.groupByChildId.get(pageId) ?? null;
    const visibility = [...this.model.pageIds].map(([page, id]) => {
      const group = this.model.groupPages.has(page);
      return { page, id, group, active: group ? page === activeGroup : id === pageId };
    });
    return {
      detail: this.getState(),
      visibility,
      pageToActivate: activate ? this.model.pageById.get(pageId) ?? null : null,
      hashWrite
    };
  }
}
