import {
  getNodeDetails,
  listCustomUiEntries,
  removeCurrentNode,
  renameCurrentNode,
  restartCurrentNode,
  waitForNodeReady,
  type NodelCustomUiEntry
} from '../api/nodel-host-client';
import { renderFontAwesomeIcon, uiIcons } from '../icons/fontawesome';
import { getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { renderComponentError } from '../utils/render-component-error';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';
import { getNodePathName, getVerySimpleName } from '../utils/node-name';
import { safeNavigationHref } from '../utils/urls';
import './nodel-theme-toggle';

interface NodeMenuState {
  customUis: NodelCustomUiEntry[];
  deleteConfirming: boolean;
  deleting: boolean;
  busy: boolean;
  error: string;
  loading: boolean;
  nodeName: string;
  open: boolean;
  renaming: boolean;
  restarting: boolean;
  uiError: string;
}

const deleteRedirectDelayMs = 2500;
const menuIconMarkup = renderFontAwesomeIcon(uiIcons.bars, 'h-4 w-4');
const closeIconMarkup = renderFontAwesomeIcon(uiIcons.xmark, 'h-3.5 w-3.5');
const linkAffordanceMarkup = renderFontAwesomeIcon(uiIcons.chevronRight, 'nodel-list-item-affordance');
const scrollLockClass = 'nodel-node-menu-scroll-lock';

const template = `
  <button type="button" class="nodel-button nodel-button-ghost nodel-node-menu-trigger" data-node-menu-open aria-haspopup="dialog" aria-label="Open node menu" data-link="aria-expanded{:open ? 'true' : 'false'}">
    ${menuIconMarkup}
  </button>
  <div class="nodel-node-menu-layer" data-link="hidden{:!open}">
    <button type="button" class="nodel-node-menu-backdrop" data-node-menu-backdrop aria-label="Close node menu"></button>
    <aside class="nodel-node-menu-drawer" role="dialog" aria-modal="true" aria-label="Node menu">
      <header class="nodel-node-menu-header">
        <button type="button" class="nodel-button nodel-button-ghost nodel-node-menu-close" data-node-menu-close aria-label="Close node menu">${closeIconMarkup}</button>
      </header>
      <div class="nodel-node-menu-content">
        {^{if error}}
          <div class="nodel-alert nodel-alert-danger nodel-alert-sm">{^{>error}}</div>
        {{/if}}
        <section class="nodel-node-menu-section">
          <h3 class="nodel-section-heading">Node</h3>
          <form class="space-y-2" data-node-menu-rename-form>
            <label class="block text-sm text-nodel-fg">
              <span class="mb-1 block font-medium">Rename</span>
              <input class="nodel-field w-full" data-node-menu-rename-input type="text" autocomplete="off" data-link="nodeName trigger=true" />
            </label>
            <button type="submit" class="nodel-button nodel-button-primary w-full" data-link="disabled{:busy}">{^{if renaming}}Renaming...{{else}}Rename node{{/if}}</button>
          </form>
          <button type="button" class="nodel-button w-full" data-node-menu-restart data-link="disabled{:busy}">{^{if restarting}}Restarting...{{else}}Restart node{{/if}}</button>
          {^{if deleteConfirming}}
            <div class="nodel-node-menu-confirm">
              <p class="m-0 text-xs leading-5 text-nodel-muted">Delete this node permanently?</p>
              <div class="grid grid-cols-2 gap-2">
                <button type="button" class="nodel-button nodel-button-compact" data-node-menu-delete-cancel data-link="disabled{:busy}">Cancel</button>
                <button type="button" class="nodel-button nodel-button-danger nodel-button-compact" data-node-menu-delete-confirm data-link="disabled{:busy}">{^{if deleting}}Deleting...{{else}}Confirm delete{{/if}}</button>
              </div>
            </div>
          {{else}}
            <button type="button" class="nodel-button nodel-button-danger w-full" data-node-menu-delete-start data-link="disabled{:busy}">Delete node</button>
          {{/if}}
        </section>
        <section class="nodel-node-menu-section nodel-node-menu-section-appearance">
          <h3 class="nodel-section-heading">Appearance</h3>
          <div class="nodel-node-menu-theme-row">
            <span class="text-sm font-medium text-nodel-fg">Theme</span>
            <nodel-theme-toggle></nodel-theme-toggle>
          </div>
        </section>
        <section class="nodel-node-menu-section nodel-node-menu-section-open">
          <h3 class="nodel-section-heading">Open</h3>
          <div class="nodel-node-menu-link-list">
            {^{if loading}}
              <div class="nodel-alert nodel-alert-sm">Loading custom UIs...</div>
            {{else uiError}}
              <div class="nodel-alert nodel-alert-danger nodel-alert-sm">{^{>uiError}}</div>
            {{else customUis.length === 0}}
              <div class="nodel-alert nodel-alert-sm">No custom UIs.</div>
            {{/if}}
            <ul class="nodel-list">
              {^{if !loading && !uiError && customUis.length}}
                {^{for customUis}}
                  <li>
                    <a class="nodel-list-item gap-3 px-3 py-2 text-sm" data-link="href{:href} title{:path}">
                      <span class="min-w-0 flex-1 truncate">{^{>title}}</span>
                      ${linkAffordanceMarkup}
                    </a>
                  </li>
                {{/for}}
              {{/if}}
              <li>
                <a class="nodel-list-item gap-3 px-3 py-2 text-sm" href="/toolkit.html">
                  <span class="min-w-0 flex-1 truncate">Toolkit</span>
                  ${linkAffordanceMarkup}
                </a>
              </li>
              <li>
                <a class="nodel-list-item gap-3 px-3 py-2 text-sm" href="/nodes.html#Diagnostics">
                  <span class="min-w-0 flex-1 truncate">Diagnostics</span>
                  ${linkAffordanceMarkup}
                </a>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </aside>
  </div>
`;

function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export class NodelNodeMenu extends HTMLElement {
  private connected = false;
  private linked = false;
  private lastFocused: Element | null = null;
  private lifecycle = new ComponentLifecycle();
  private linkController = new JsViewsLinkController(this);
  private state: NodeMenuState = {
    customUis: [],
    deleteConfirming: false,
    deleting: false,
    busy: false,
    error: '',
    loading: true,
    nodeName: '',
    open: false,
    renaming: false,
    restarting: false,
    uiError: ''
  };

  connectedCallback() {
    this.connected = true;
    this.classList.add('nodel-node-menu');
    const scope = this.lifecycle.connect();
    if (scope) {
      void scope.run(() => this.initialize(scope), (error) => {
        const message = apiErrorMessage(error, 'Failed to initialize node menu');
        if (this.linked) {
          this.setState({ loading: false, error: message });
        } else {
          this.dataset.state = 'error';
          renderComponentError(this, message);
        }
      });
    }
  }

  disconnectedCallback() {
    this.connected = false;
    if (this.linked) {
      this.setState({ open: false, deleteConfirming: false, deleting: false, renaming: false, restarting: false });
    }
    this.lifecycle.disconnect();
    this.setPageScrollLocked(false);
    this.lastFocused = null;
    this.linked = false;
  }

  private async initialize(scope: ConnectionScope) {
    const linked = await this.linkController.link(scope, template, this.state);
    if (!linked || !scope.isCurrent()) {
      return;
    }
    this.linked = true;
    scope.listen(this, 'click', this.handleClick);
    scope.listen(this, 'submit', this.handleSubmit);
    scope.listen(document, 'keydown', this.handleDocumentKeydown);

    await this.loadMenuData(scope);
  }

  private async loadMenuData(scope: ConnectionScope) {
    if (!getNodePathName()) {
      this.setState({ loading: false });
      return;
    }

    this.setState({ loading: true, error: '', uiError: '' });

    const [detailsResult, uiResult] = await Promise.allSettled([
      getNodeDetails({ signal: scope.signal }),
      listCustomUiEntries({ signal: scope.signal })
    ]);

    if (!scope.isCurrent()) {
      return;
    }

    this.setState({
      customUis: uiResult.status === 'fulfilled' ? uiResult.value : [],
      error: detailsResult.status === 'rejected' ? apiErrorMessage(detailsResult.reason, 'Failed to load node details') : '',
      loading: false,
      nodeName: detailsResult.status === 'fulfilled' && typeof detailsResult.value.name === 'string' ? detailsResult.value.name : '',
      uiError: uiResult.status === 'rejected' ? apiErrorMessage(uiResult.reason, 'Failed to load custom UIs') : ''
    });
  }

  private handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest('[data-node-menu-open]')) {
      event.preventDefault();
      this.open();
      return;
    }

    if (target.closest('[data-node-menu-close]') || target.closest('[data-node-menu-backdrop]')) {
      event.preventDefault();
      this.close();
      return;
    }

    if (target.closest('[data-node-menu-restart]')) {
      event.preventDefault();
      void this.restartNode();
      return;
    }

    if (target.closest('[data-node-menu-delete-start]')) {
      event.preventDefault();
      this.setState({ deleteConfirming: true, error: '' });
      return;
    }

    if (target.closest('[data-node-menu-delete-cancel]')) {
      event.preventDefault();
      this.setState({ deleteConfirming: false });
      return;
    }

    if (target.closest('[data-node-menu-delete-confirm]')) {
      event.preventDefault();
      void this.deleteNode();
    }
  };

  private handleSubmit = (event: SubmitEvent) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('[data-node-menu-rename-form]')) {
      return;
    }

    event.preventDefault();
    void this.renameNode(form);
  };

  private handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.state.open) {
      event.preventDefault();
      this.close();
    }
  };

  private open() {
    this.lastFocused = document.activeElement;
    this.setPageScrollLocked(true);
    this.setState({ open: true, deleteConfirming: false });
    this.lifecycle.current?.setTimeout(() => {
      this.querySelector<HTMLElement>('[data-node-menu-close]')?.focus();
    }, 0);
  }

  private close() {
    this.setPageScrollLocked(false);
    this.setState({ open: false, deleteConfirming: false });
    if (this.lastFocused instanceof HTMLElement && this.contains(this.lastFocused)) {
      this.lastFocused.focus();
    } else {
      this.querySelector<HTMLElement>('[data-node-menu-open]')?.focus();
    }
  }

  private setPageScrollLocked(locked: boolean) {
    document.documentElement.classList.toggle(scrollLockClass, locked);
  }

  private async renameNode(_form: HTMLFormElement) {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    const newName = this.state.nodeName.trim();
    if (!newName) {
      this.setState({ error: 'Node name is required.' });
      return;
    }

    this.setState({ renaming: true, error: '' });

    try {
      await renameCurrentNode(newName, { signal: scope.signal });
      if (!scope.isCurrent()) {
        return;
      }
      const nextUrl = `${window.location.origin}/nodes/${encodeURIComponent(getVerySimpleName(newName))}/`;
      this.showToast({ message: 'Rename successful. Redirecting...', tone: 'success', persistent: true });
      await waitForNodeReady(nextUrl, 30, 1000, { signal: scope.signal });
      if (scope.isCurrent()) {
        this.navigate(nextUrl);
      }
    } catch (error) {
      if (!scope.isCurrent()) {
        return;
      }
      const message = apiErrorMessage(error, 'Failed to rename node');
      this.setState({ error: message });
      this.showToast({ message: 'Failed to rename node', detail: message, tone: 'danger', durationMs: 7000 });
    } finally {
      if (scope.isCurrent()) {
        this.setState({ renaming: false });
      }
    }
  }

  private async restartNode() {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    this.setState({ restarting: true, error: '' });

    try {
      await restartCurrentNode({ signal: scope.signal });
      if (!scope.isCurrent()) {
        return;
      }
      this.showToast({ message: 'Restarting node...', tone: 'info', durationMs: 7000 });
      this.close();
    } catch (error) {
      if (!scope.isCurrent()) {
        return;
      }
      const message = apiErrorMessage(error, 'Failed to restart node');
      this.setState({ error: message });
      this.showToast({ message: 'Failed to restart node', detail: message, tone: 'danger', durationMs: 7000 });
    } finally {
      if (scope.isCurrent()) {
        this.setState({ restarting: false });
      }
    }
  }

  private async deleteNode() {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    this.setState({ deleting: true, error: '' });

    try {
      await removeCurrentNode({ signal: scope.signal });
      if (!scope.isCurrent()) {
        return;
      }
      this.showToast({ message: 'Delete successful. Redirecting...', tone: 'success', persistent: true });
      scope.setTimeout(() => {
        this.navigate('/');
      }, deleteRedirectDelayMs);
    } catch (error) {
      if (!scope.isCurrent()) {
        return;
      }
      const message = apiErrorMessage(error, 'Failed to delete node');
      this.setState({ error: message });
      this.showToast({ message: 'Failed to delete node', detail: message, tone: 'danger', durationMs: 7000 });
    } finally {
      if (scope.isCurrent()) {
        this.setState({ deleting: false });
      }
    }
  }

  private showToast(detail: NodelToastDetail) {
    this.dispatchEvent(new CustomEvent<NodelToastDetail>(NODEL_TOAST, {
      bubbles: true,
      detail
    }));
  }

  private navigate(url: string) {
    const href = safeNavigationHref(url);
    if (!href) {
      this.setState({ error: 'Navigation URL is invalid' });
      return;
    }
    const event = new CustomEvent('nodel-node-menu-navigate', {
      bubbles: true,
      cancelable: true,
      detail: { url: href }
    });

    if (this.dispatchEvent(event)) {
      window.location.href = href;
    }
  }

  private setState(values: Partial<NodeMenuState>) {
    const nextState = { ...this.state, ...values };
    const nextValues = {
      ...values,
      busy: nextState.renaming || nextState.restarting || nextState.deleting
    };
    if (this.linked) {
      getJQuery().observable(this.state).setProperty(nextValues);
    } else {
      Object.assign(this.state, nextValues);
    }
  }
}

if (!customElements.get('nodel-node-menu')) {
  customElements.define('nodel-node-menu', NodelNodeMenu);
}
