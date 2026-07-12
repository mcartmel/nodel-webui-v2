import {
  NODEL_NAVIGATION_CHANGE,
  NODEL_NAV_SELECT,
  type NodelNavigationChangeDetail,
  type NodelNavigationHost,
  type NodelNavItem,
  type NodelNavSelectDetail
} from '../navigation/navigation';
import { renderFontAwesomeIcon, uiIcons } from '../icons/fontawesome';
import { getNodePathName, getSimpleName } from '../utils/node-name';
import './nodel-host-icon';

type NavigationAppElement = HTMLElement & NodelNavigationHost;

export class NodelToolbar extends HTMLElement {
  static observedAttributes = ['title', 'icon-src', 'icon-alt'];

  private appNode: NavigationAppElement | null = null;
  private activePageId = '';
  private navItems: NodelNavItem[] = [];
  private navNode: HTMLElement | null = null;
  private navContainerNode: HTMLElement | null = null;
  private openGroupId = '';
  private shellReady = false;
  private autoTitle = '';
  private titleLoadToken = 0;
  private iconNode: HTMLImageElement | null = null;
  private hostIconNode: HTMLElement | null = null;
  private titleNode: HTMLElement | null = null;
  private actionsNode: HTMLElement | null = null;

  connectedCallback() {
    this.appNode = this.closest('nodel-app') as NavigationAppElement | null;
    this.render();
    void this.loadDefaultTitle();
    this.addEventListener('click', this.handleClick);
    this.appNode?.addEventListener(NODEL_NAVIGATION_CHANGE, this.handleNavigationChange as EventListener);
    document.addEventListener('click', this.handleDocumentClick);
    document.addEventListener('keydown', this.handleDocumentKeydown);
    window.addEventListener('resize', this.positionOpenGroupMenu);
    window.addEventListener('scroll', this.positionOpenGroupMenu, true);
    this.syncNavigationFromApp();
  }

  disconnectedCallback() {
    this.titleLoadToken += 1;
    this.removeEventListener('click', this.handleClick);
    this.appNode?.removeEventListener(NODEL_NAVIGATION_CHANGE, this.handleNavigationChange as EventListener);
    document.removeEventListener('click', this.handleDocumentClick);
    document.removeEventListener('keydown', this.handleDocumentKeydown);
    window.removeEventListener('resize', this.positionOpenGroupMenu);
    window.removeEventListener('scroll', this.positionOpenGroupMenu, true);
    this.appNode = null;
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
      void this.loadDefaultTitle();
    }
  }

  private render() {
    const title = this.getAttribute('title') ?? this.autoTitle;
    const hasTitle = title.trim().length > 0;
    const iconSrc = this.getAttribute('icon-src');
    const iconAlt = this.getAttribute('icon-alt') ?? title;
    const children = this.shellReady ? [] : Array.from(this.childNodes);

    if (!this.shellReady) {
      this.innerHTML = `
        <div class="nodel-shell nodel-toolbar-shell">
          <div data-toolbar-brand class="nodel-toolbar-brand">
            <img data-toolbar-icon class="hidden h-12 w-24 shrink-0 object-contain" alt="" />
            <nodel-host-icon data-toolbar-host-icon class="nodel-toolbar-host-icon" href="" title="Browse this host"></nodel-host-icon>
            <span data-toolbar-title class="truncate text-base font-semibold tracking-wide"></span>
          </div>
          <nav data-toolbar-nav class="nodel-toolbar-nav" aria-label="Page navigation">
            <div data-toolbar-nav-list class="nodel-toolbar-nav-list"></div>
          </nav>
          <div data-toolbar-actions class="nodel-toolbar-actions"></div>
        </div>
      `;
      this.iconNode = this.querySelector('[data-toolbar-icon]');
      this.hostIconNode = this.querySelector('[data-toolbar-host-icon]');
      this.titleNode = this.querySelector('[data-toolbar-title]');
      this.navContainerNode = this.querySelector('[data-toolbar-nav]');
      this.navNode = this.querySelector('[data-toolbar-nav-list]');
      this.actionsNode = this.querySelector('[data-toolbar-actions]');
      this.shellReady = true;
      if (this.actionsNode) {
        for (const child of children) {
          this.actionsNode.appendChild(child);
        }
      }
    }

    if (this.iconNode) {
      if (iconSrc) {
        this.iconNode.src = iconSrc;
        this.iconNode.alt = iconAlt;
        this.iconNode.classList.remove('hidden');
      } else {
        this.iconNode.removeAttribute('src');
        this.iconNode.alt = '';
        this.iconNode.classList.add('hidden');
      }
    }

    if (this.titleNode) {
      this.titleNode.hidden = !hasTitle;
      this.titleNode.textContent = title;
    }

    if (this.hostIconNode) {
      this.hostIconNode.setAttribute('host', window.location.host);
      this.hostIconNode.setAttribute('icon-host', window.location.host);
      this.hostIconNode.setAttribute('href', `${window.location.protocol}//${window.location.host}/`);
      this.hostIconNode.setAttribute('title', 'Browse this host');
      this.hostIconNode.setAttribute('alt', 'Browse this host');
    }

    this.renderNavigation();
  }

  private async loadDefaultTitle() {
    const token = ++this.titleLoadToken;

    if (this.hasAttribute('title') || !getNodePathName()) {
      this.autoTitle = '';
      this.render();
      return;
    }

    try {
      const response = await fetch('REST/');
      if (!response.ok) {
        return;
      }

      const data = await response.json() as { name?: unknown };
      if (token !== this.titleLoadToken || this.hasAttribute('title')) {
        return;
      }

      const name = typeof data.name === 'string' ? getSimpleName(data.name).trim() : '';
      if (name) {
        this.autoTitle = name;
        this.render();
      }
    } catch {
      // Host-level pages intentionally have no title, and node title lookup is best-effort.
    }
  }

  private handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const groupButton = target.closest<HTMLElement>('[data-nav-group-id]');
    if (groupButton && this.contains(groupButton)) {
      event.preventDefault();
      event.stopPropagation();
      const groupId = groupButton.dataset.navGroupId ?? '';
      this.openGroupId = this.openGroupId === groupId ? '' : groupId;
      this.renderNavigation();
      return;
    }

    const pageButton = target.closest<HTMLElement>('[data-nav-page-id]');
    if (pageButton && this.contains(pageButton)) {
      event.preventDefault();
      event.stopPropagation();
      const pageId = pageButton.dataset.navPageId ?? '';
      this.openGroupId = '';
      this.dispatchEvent(
        new CustomEvent<NodelNavSelectDetail>(NODEL_NAV_SELECT, {
          bubbles: true,
          detail: { pageId }
        })
      );
      return;
    }
  };

  private handleDocumentClick = (event: MouseEvent) => {
    const target = event.target;
    if (target instanceof Node && this.contains(target)) {
      return;
    }

    this.closeOpenGroup();
  };

  private handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.closeOpenGroup();
    }
  };

  private handleNavigationChange = (event: CustomEvent<NodelNavigationChangeDetail>) => {
    this.navItems = event.detail.items;
    this.activePageId = event.detail.activePageId;
    this.renderNavigation();
  };

  private syncNavigationFromApp() {
    const state = this.appNode?.getNavigationState?.();
    if (!state) {
      return;
    }

    this.navItems = state.items;
    this.activePageId = state.activePageId;
    this.renderNavigation();
  }

  private closeOpenGroup() {
    if (!this.openGroupId) {
      return;
    }

    this.openGroupId = '';
    this.renderNavigation();
  }

  private positionOpenGroupMenu = () => {
    if (!this.openGroupId || window.innerWidth >= 640) {
      return;
    }

    const groupButton = Array.from(this.querySelectorAll<HTMLElement>('[data-nav-group-id]')).find(
      (button) => button.dataset.navGroupId === this.openGroupId
    );
    const menu = Array.from(this.querySelectorAll<HTMLElement>('[data-nav-group-menu-id]')).find(
      (element) => element.dataset.navGroupMenuId === this.openGroupId
    );
    if (!groupButton || !menu) {
      return;
    }

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const top = Math.max(0, Math.min(groupButton.getBoundingClientRect().bottom + 8, Math.max(0, viewportHeight - 48)));
    menu.style.setProperty('--nodel-toolbar-menu-top', `${top}px`);
  };

  private renderNavigation() {
    if (!this.navNode || !this.navContainerNode) {
      return;
    }

    this.navNode.innerHTML = '';

    if (this.navItems.length === 0) {
      this.navContainerNode.hidden = true;
      return;
    }

    this.navContainerNode.hidden = false;

    for (const item of this.navItems) {
      if (item.type === 'group') {
        this.navNode.appendChild(this.createGroupItem(item));
      } else {
        this.navNode.appendChild(this.createPageButton(item));
      }
    }

    this.positionOpenGroupMenu();
  }

  private createPageButton(item: NodelNavItem) {
    if (item.type !== 'page') {
      throw new Error('Expected page navigation item');
    }

    const button = document.createElement('button');
    const active = item.id === this.activePageId;
    button.type = 'button';
    button.dataset.navPageId = item.id;
    button.textContent = item.title;
    button.className = this.navButtonClass(active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
    return button;
  }

  private createGroupItem(item: NodelNavItem) {
    if (item.type !== 'group') {
      throw new Error('Expected group navigation item');
    }

    const group = document.createElement('div');
    const menuId = `nodel-menu-${item.id}`;
    const open = this.openGroupId === item.id;
    const active = item.children.some((child) => child.type === 'page' && child.id === this.activePageId);
    group.className = 'nodel-toolbar-nav-group';

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.navGroupId = item.id;
    button.className = this.navButtonClass(active);
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-controls', menuId);

    const label = document.createElement('span');
    label.className = 'truncate';
    label.textContent = item.title;

    const icon = document.createElement('span');
    icon.className = 'nodel-toolbar-group-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = renderFontAwesomeIcon(uiIcons.chevronDown, 'h-3 w-3');

    button.append(label, icon);

    const menu = document.createElement('div');
    menu.id = menuId;
    menu.dataset.navGroupMenuId = item.id;
    menu.hidden = !open;
    menu.role = 'menu';
    menu.className = 'nodel-popover nodel-toolbar-group-menu';

    for (const child of item.children) {
      if (child.type !== 'page') {
        continue;
      }

      const childButton = this.createPageButton(child);
      childButton.role = 'menuitem';
      childButton.className = this.menuButtonClass(child.id === this.activePageId);
      menu.appendChild(childButton);
    }

    group.appendChild(button);
    group.appendChild(menu);
    return group;
  }

  private navButtonClass(active: boolean) {
    const base = 'nodel-button';
    return active
      ? `${base} nodel-button-primary`
      : `${base} nodel-button-ghost text-nodel-muted`;
  }

  private menuButtonClass(active: boolean) {
    return active ? 'nodel-menu-item nodel-menu-item-active' : 'nodel-menu-item text-nodel-muted';
  }
}

if (!customElements.get('nodel-toolbar')) {
  customElements.define('nodel-toolbar', NodelToolbar);
}
