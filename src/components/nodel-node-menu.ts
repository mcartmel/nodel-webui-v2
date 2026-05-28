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
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';
import { getNodePathName, getVerySimpleName } from '../utils/node-name';
import './nodel-theme-toggle';

interface NodeMenuState {
  customUis: NodelCustomUiEntry[];
  deleteConfirming: boolean;
  deleting: boolean;
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
const scrollLockClass = 'nodel-node-menu-scroll-lock';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export class NodelNodeMenu extends HTMLElement {
  private connected = false;
  private lastFocused: Element | null = null;
  private state: NodeMenuState = {
    customUis: [],
    deleteConfirming: false,
    deleting: false,
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
    this.addEventListener('click', this.handleClick);
    this.addEventListener('submit', this.handleSubmit);
    document.addEventListener('keydown', this.handleDocumentKeydown);
    this.render();
    void this.loadMenuData();
  }

  disconnectedCallback() {
    this.connected = false;
    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('submit', this.handleSubmit);
    document.removeEventListener('keydown', this.handleDocumentKeydown);
    this.setPageScrollLocked(false);
  }

  private async loadMenuData() {
    if (!getNodePathName()) {
      this.setState({ loading: false });
      return;
    }

    this.setState({ loading: true, error: '', uiError: '' });

    const [detailsResult, uiResult] = await Promise.allSettled([
      getNodeDetails(),
      listCustomUiEntries()
    ]);

    if (!this.connected) {
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
    window.setTimeout(() => {
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

  private async renameNode(form: HTMLFormElement) {
    const input = form.querySelector<HTMLInputElement>('[data-node-menu-rename-input]');
    const newName = input?.value.trim() ?? '';
    if (!newName) {
      this.setState({ error: 'Node name is required.' });
      return;
    }

    this.setState({ renaming: true, error: '' });

    try {
      await renameCurrentNode(newName);
      const nextUrl = `${window.location.origin}/nodes/${encodeURIComponent(getVerySimpleName(newName))}/`;
      this.showToast({ message: 'Rename successful. Redirecting...', tone: 'success', persistent: true });
      await waitForNodeReady(nextUrl);
      this.navigate(nextUrl);
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to rename node');
      this.setState({ error: message });
      this.showToast({ message: 'Failed to rename node', detail: message, tone: 'danger', durationMs: 7000 });
    } finally {
      if (this.connected) {
        this.setState({ renaming: false });
      }
    }
  }

  private async restartNode() {
    this.setState({ restarting: true, error: '' });

    try {
      await restartCurrentNode();
      this.showToast({ message: 'Restarting node...', tone: 'info', durationMs: 7000 });
      this.close();
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to restart node');
      this.setState({ error: message });
      this.showToast({ message: 'Failed to restart node', detail: message, tone: 'danger', durationMs: 7000 });
    } finally {
      if (this.connected) {
        this.setState({ restarting: false });
      }
    }
  }

  private async deleteNode() {
    this.setState({ deleting: true, error: '' });

    try {
      await removeCurrentNode();
      this.showToast({ message: 'Delete successful. Redirecting...', tone: 'success', persistent: true });
      window.setTimeout(() => {
        this.navigate('/');
      }, deleteRedirectDelayMs);
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to delete node');
      this.setState({ error: message });
      this.showToast({ message: 'Failed to delete node', detail: message, tone: 'danger', durationMs: 7000 });
    } finally {
      if (this.connected) {
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
    const event = new CustomEvent('nodel-node-menu-navigate', {
      bubbles: true,
      cancelable: true,
      detail: { url }
    });

    if (this.dispatchEvent(event)) {
      window.location.href = url;
    }
  }

  private setState(values: Partial<NodeMenuState>) {
    this.state = { ...this.state, ...values };
    this.render();
  }

  private render() {
    const busy = this.state.renaming || this.state.restarting || this.state.deleting;
    const openAttr = this.state.open ? 'true' : 'false';
    const dialogHidden = this.state.open ? '' : ' hidden';
    const customUiContent = this.renderCustomUiContent();
    const error = this.state.error
      ? `<div class="nodel-alert nodel-alert-danger nodel-alert-sm">${escapeHtml(this.state.error)}</div>`
      : '';

    this.innerHTML = `
      <button type="button" class="nodel-button nodel-button-ghost nodel-node-menu-trigger" data-node-menu-open aria-haspopup="dialog" aria-expanded="${openAttr}" aria-label="Open node menu">
        ${menuIconMarkup}
      </button>
      <div class="nodel-node-menu-layer"${dialogHidden}>
        <button type="button" class="nodel-node-menu-backdrop" data-node-menu-backdrop aria-label="Close node menu"></button>
        <aside class="nodel-node-menu-drawer" role="dialog" aria-modal="true" aria-label="Node menu">
          <header class="nodel-node-menu-header">
            <button type="button" class="nodel-button nodel-button-ghost nodel-node-menu-close" data-node-menu-close aria-label="Close node menu">${closeIconMarkup}</button>
          </header>
          <div class="nodel-node-menu-content">
            ${error}
            <section class="nodel-node-menu-section">
              <h3 class="nodel-section-heading">Node</h3>
              <form class="space-y-2" data-node-menu-rename-form>
                <label class="block text-sm text-nodel-fg">
                  <span class="mb-1 block font-medium">Rename</span>
                  <input class="nodel-field w-full" data-node-menu-rename-input type="text" value="${escapeHtml(this.state.nodeName)}" autocomplete="off" ${busy ? 'disabled' : ''} />
                </label>
                <button type="submit" class="nodel-button nodel-button-primary w-full" ${busy ? 'disabled' : ''}>${this.state.renaming ? 'Renaming...' : 'Rename node'}</button>
              </form>
              <button type="button" class="nodel-button w-full" data-node-menu-restart ${busy ? 'disabled' : ''}>${this.state.restarting ? 'Restarting...' : 'Restart node'}</button>
              ${this.renderDeleteControl(busy)}
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
                ${customUiContent}
                <a class="nodel-list-item px-3 py-2 text-sm" href="/toolkit.xml">Toolkit</a>
                <a class="nodel-list-item px-3 py-2 text-sm" href="/diagnostics.xml">Diagnostics</a>
              </div>
            </section>
          </div>
        </aside>
      </div>
    `;
  }

  private renderCustomUiContent() {
    if (this.state.loading) {
      return '<div class="nodel-alert nodel-alert-sm">Loading custom UIs...</div>';
    }

    if (this.state.uiError) {
      return `<div class="nodel-alert nodel-alert-danger nodel-alert-sm">${escapeHtml(this.state.uiError)}</div>`;
    }

    if (this.state.customUis.length === 0) {
      return '<div class="nodel-alert nodel-alert-sm">No custom UIs.</div>';
    }

    return this.state.customUis.map((entry) => `
      <a class="nodel-list-item px-3 py-2 text-sm" href="${escapeHtml(entry.href)}" title="${escapeHtml(entry.path)}">${escapeHtml(entry.title)}</a>
    `).join('');
  }

  private renderDeleteControl(busy: boolean) {
    if (this.state.deleteConfirming) {
      return `
        <div class="nodel-node-menu-confirm">
          <p class="m-0 text-xs leading-5 text-nodel-muted">Delete this node permanently?</p>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="nodel-button nodel-button-compact" data-node-menu-delete-cancel ${busy ? 'disabled' : ''}>Cancel</button>
            <button type="button" class="nodel-button nodel-button-danger nodel-button-compact" data-node-menu-delete-confirm ${busy ? 'disabled' : ''}>${this.state.deleting ? 'Deleting...' : 'Confirm delete'}</button>
          </div>
        </div>
      `;
    }

    return `<button type="button" class="nodel-button nodel-button-danger w-full" data-node-menu-delete-start ${busy ? 'disabled' : ''}>Delete node</button>`;
  }
}

if (!customElements.get('nodel-node-menu')) {
  customElements.define('nodel-node-menu', NodelNodeMenu);
}
