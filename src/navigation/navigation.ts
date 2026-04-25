export const NODEL_NAVIGATION_CHANGE = 'nodel-navigation-change';
export const NODEL_NAV_SELECT = 'nodel-nav-select';

export type NodelNavItem =
  | {
      type: 'page';
      id: string;
      title: string;
    }
  | {
      type: 'group';
      id: string;
      title: string;
      children: NodelNavItem[];
    };

export interface NodelNavigationChangeDetail {
  activePageId: string;
  items: NodelNavItem[];
}

export interface NodelNavSelectDetail {
  pageId: string;
}

export interface NodelNavigationHost {
  getNavigationState(): NodelNavigationChangeDetail;
}

export function slugPageTitle(title: string): string {
  const slug = title.replace(/[^A-Za-z0-9]/g, '');
  return slug || 'Page';
}
