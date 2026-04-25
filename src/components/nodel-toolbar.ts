import {
  NODEL_NAVIGATION_CHANGE,
  NODEL_NAV_SELECT,
  type NodelNavigationChangeDetail,
  type NodelNavigationHost,
  type NodelNavItem,
  type NodelNavSelectDetail
} from '../navigation/navigation';

type NavigationAppElement = HTMLElement & NodelNavigationHost;

export class NodelToolbar extends HTMLElement {
  static observedAttributes = ['title', 'icon-src', 'icon-alt'];

  private appNode: NavigationAppElement | null = null;
  private activePageId = '';
  private navItems: NodelNavItem[] = [];
  private navNode: HTMLElement | null = null;
  private openGroupId = '';
  private shellReady = false;
  private iconNode: HTMLImageElement | null = null;
  private titleNode: HTMLElement | null = null;
  private actionsNode: HTMLElement | null = null;

  connectedCallback() {
    this.appNode = this.closest('nodel-app') as NavigationAppElement | null;
    this.render();
    this.addEventListener('click', this.handleClick);
    this.appNode?.addEventListener(NODEL_NAVIGATION_CHANGE, this.handleNavigationChange as EventListener);
    document.addEventListener('click', this.handleDocumentClick);
    document.addEventListener('keydown', this.handleDocumentKeydown);
    this.syncNavigationFromApp();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.handleClick);
    this.appNode?.removeEventListener(NODEL_NAVIGATION_CHANGE, this.handleNavigationChange as EventListener);
    document.removeEventListener('click', this.handleDocumentClick);
    document.removeEventListener('keydown', this.handleDocumentKeydown);
    this.appNode = null;
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
    }
  }

  private render() {
    const title = this.getAttribute('title') ?? 'Nodel';
    const iconSrc = this.getAttribute('icon-src');
    const iconAlt = this.getAttribute('icon-alt') ?? 'Nodel';
    const children = this.shellReady ? [] : Array.from(this.childNodes);

    if (!this.shellReady) {
      this.innerHTML = `
        <div class="nodel-shell flex min-h-16 flex-wrap items-center gap-3 py-2">
          <div class="flex min-w-0 items-center gap-2">
            <img data-toolbar-icon class="hidden h-12 w-24 shrink-0 object-contain" alt="" />
            <span data-toolbar-title class="truncate text-base font-semibold tracking-wide"></span>
          </div>
          <nav data-toolbar-nav class="flex min-w-0 flex-1 flex-wrap items-center gap-1" aria-label="Page navigation"></nav>
          <div data-toolbar-actions class="flex flex-wrap items-center justify-end gap-2"></div>
        </div>
      `;
      this.iconNode = this.querySelector('[data-toolbar-icon]');
      this.titleNode = this.querySelector('[data-toolbar-title]');
      this.navNode = this.querySelector('[data-toolbar-nav]');
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
      this.titleNode.textContent = title;
    }

    this.renderNavigation();
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

  private renderNavigation() {
    if (!this.navNode) {
      return;
    }

    this.navNode.innerHTML = '';

    if (this.navItems.length === 0) {
      this.navNode.hidden = true;
      return;
    }

    this.navNode.hidden = false;

    for (const item of this.navItems) {
      if (item.type === 'group') {
        this.navNode.appendChild(this.createGroupItem(item));
      } else {
        this.navNode.appendChild(this.createPageButton(item));
      }
    }
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
    group.className = 'relative';

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.navGroupId = item.id;
    button.className = this.navButtonClass(active);
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-controls', menuId);
    button.textContent = `${item.title} ▾`;

    const menu = document.createElement('div');
    menu.id = menuId;
    menu.hidden = !open;
    menu.role = 'menu';
    menu.className = 'absolute left-0 top-full z-20 mt-2 min-w-48 overflow-hidden rounded-lg border border-[rgb(var(--nodel-border))] bg-[rgb(var(--nodel-surface))] p-1 shadow-lg';

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
    const base = 'rounded-md px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-[rgb(var(--nodel-accent))]/40';
    return active
      ? `${base} bg-[rgb(var(--nodel-accent))] text-white`
      : `${base} text-[rgb(var(--nodel-muted))] hover:bg-[rgb(var(--nodel-border))]/40 hover:text-[rgb(var(--nodel-fg))]`;
  }

  private menuButtonClass(active: boolean) {
    const base = 'block w-full rounded-md px-3 py-2 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-[rgb(var(--nodel-accent))]/40';
    return active
      ? `${base} bg-[rgb(var(--nodel-accent))] text-white`
      : `${base} text-[rgb(var(--nodel-muted))] hover:bg-[rgb(var(--nodel-border))]/40 hover:text-[rgb(var(--nodel-fg))]`;
  }
}

if (!customElements.get('nodel-toolbar')) {
  customElements.define('nodel-toolbar', NodelToolbar);
}
