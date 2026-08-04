import { getNodeEventBinding, getNodeUrlsForNode } from '../api/nodel-host-client';
import type { NodelNodeUrlEntry } from '../api/nodel-types';
import { renderFontAwesomeIcon, toastIcons, uiIcons } from '../icons/fontawesome';
import { networkNodeSearchHref } from '../navigation/node-links';
import { isRecord } from '../utils/records';
import { isAbortError } from '../utils/errors';
import { isWellFormedUtf16 } from '../utils/node-name';
import { trimPointReference } from '../utils/edge-whitespace';
import { safeNavigationHref, safeNavigationUrl } from '../utils/urls';
import { LatestOperationCoordinator, type LatestOperationTicket } from '../utils/latest-operation-coordinator';

type LinkState = 'idle' | 'loading' | 'ready' | 'error';

let linkStatusId = 0;

function preferredNodeAddress(entries: unknown) {
  if (!Array.isArray(entries)) {
    return null;
  }
  const valid = entries
    .filter(isRecord)
    .map((entry) => entry as Partial<NodelNodeUrlEntry>)
    .map((entry) => typeof entry.address === 'string' ? safeNavigationUrl(entry.address) : null)
    .filter((url): url is URL => url !== null);
  return valid.find((url) => url.origin === window.location.origin) ?? valid[0] ?? null;
}

export class NodelLink extends HTMLElement {
  static observedAttributes = ['href', 'node', 'event-binding', 'target', 'rel', 'aria-label', 'aria-labelledby', 'aria-describedby', 'title'];

  private anchor: HTMLAnchorElement | null = null;
  private indicator: HTMLElement | null = null;
  private operations = new LatestOperationCoordinator<'resolve'>();
  private status: HTMLElement | null = null;

  connectedCallback() {
    this.ensureShell();
    this.addEventListener('click', this.handleClick);
    void this.resolveDestination();
  }

  disconnectedCallback() {
    this.operations.invalidateAll();
    this.removeEventListener('click', this.handleClick);
  }

  attributeChangedCallback(name: string) {
    if (this.isConnected && this.anchor) {
      this.syncAnchorMetadata();
      if (name === 'href' || name === 'node' || name === 'event-binding') {
        void this.resolveDestination();
      }
    }
  }

  private ensureShell() {
    const existingAnchor = Array.from(this.children).find((child): child is HTMLAnchorElement => child instanceof HTMLAnchorElement && child.hasAttribute('data-nodel-link-anchor'));
    const existingStatus = Array.from(this.children).find((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-nodel-link-status'));
    if (existingAnchor && existingStatus) {
      this.anchor = existingAnchor;
      this.status = existingStatus;
      this.indicator = existingAnchor.querySelector('[data-nodel-link-indicator]');
      this.syncAnchorMetadata();
      return;
    }

    const content = Array.from(this.childNodes);
    const anchor = document.createElement('a');
    anchor.className = 'nodel-link nodel-link-component';
    anchor.setAttribute('data-nodel-link-anchor', '');
    for (const node of content) {
      anchor.append(node);
    }
    const indicator = document.createElement('span');
    indicator.className = 'nodel-link-indicator';
    indicator.setAttribute('data-nodel-link-indicator', '');
    indicator.setAttribute('aria-hidden', 'true');
    anchor.append(indicator);

    const status = document.createElement('span');
    linkStatusId += 1;
    status.id = `nodel-link-status-${linkStatusId}`;
    status.className = 'sr-only';
    status.setAttribute('data-nodel-link-status', '');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    this.append(anchor, status);
    this.anchor = anchor;
    this.indicator = indicator;
    this.status = status;
    this.syncAnchorMetadata();
  }

  private handleClick = (event: MouseEvent) => {
    if (this.anchor?.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
    }
  };

  private syncAnchorMetadata() {
    const anchor = this.anchor;
    if (!anchor) {
      return;
    }
    for (const name of ['aria-label', 'aria-labelledby', 'title'] as const) {
      const value = this.getAttribute(name);
      if (value === null) {
        anchor.removeAttribute(name);
      } else {
        anchor.setAttribute(name, value);
      }
    }

    const target = this.getAttribute('target')?.trim() ?? '';
    if (target) {
      anchor.setAttribute('target', target);
    } else {
      anchor.removeAttribute('target');
    }
    const rel = new Set((this.getAttribute('rel') ?? '').split(/\s+/).filter(Boolean));
    if (target.toLowerCase() === '_blank') {
      rel.delete('opener');
      rel.add('noopener');
      rel.add('noreferrer');
    }
    if (rel.size > 0) {
      anchor.setAttribute('rel', Array.from(rel).join(' '));
    } else {
      anchor.removeAttribute('rel');
    }
    this.syncDescription();
  }

  private destinationAttributes() {
    return (['href', 'node', 'event-binding'] as const).filter((name) => this.hasAttribute(name));
  }

  private async resolveDestination() {
    this.ensureShell();
    const ticket = this.operations.begin('resolve');
    let destination: 'href' | 'node' | 'event-binding' = 'href';
    let value = '';
    try {
      const destinations = this.destinationAttributes();
      if (destinations.length !== 1) {
        this.setState('error', destinations.length === 0 ? 'Link destination is not configured.' : 'Link has multiple destination attributes.', '');
        return;
      }

      destination = destinations[0];
      const attributeValue = this.getAttribute(destination) ?? '';
      value = destination === 'node'
        ? attributeValue
        : destination === 'event-binding'
          ? trimPointReference(attributeValue)
          : attributeValue.trim();
      if (!value) {
        this.setState('error', 'Link destination is empty.', '');
        return;
      }

      if (destination === 'href') {
        const href = safeNavigationHref(value);
        if (!href) {
          this.setState('error', 'Link destination uses an unsupported URL scheme.', '');
          return;
        }
        this.setState('ready', '', href);
        return;
      }

      if (destination === 'event-binding') {
        this.setState('loading', `Resolving event binding ${value}...`, '');
        const binding = await getNodeEventBinding(value, { signal: ticket.signal });
        if (!this.isCurrent(ticket)) {
          return;
        }
        if (!binding) {
          this.setState('error', `Event binding ${value} was not found.`, '');
          return;
        }
        const node = binding.node;
        if (!node) {
          this.setState('error', `Event binding ${value} has no target node.`, '');
          return;
        }
        await this.resolveNode(node, ticket);
        return;
      }

      await this.resolveNode(value, ticket);
    } catch (error) {
      if (!this.isCurrent(ticket) || isAbortError(error)) {
        return;
      }
      const fallback = destination === 'node' ? networkNodeSearchHref(value) : '';
      this.setState('error', fallback ? 'Direct address unavailable. Opens Network node search.' : 'Link destination could not be resolved.', fallback);
    } finally {
      ticket.finish();
    }
  }

  private async resolveNode(node: string, ticket: LatestOperationTicket<'resolve'>) {
    if (!isWellFormedUtf16(node)) {
      this.setState('error', 'Node name must be well-formed UTF-16.', '');
      return;
    }
    const fallback = networkNodeSearchHref(node);
    this.setState('loading', `Resolving node ${node}...`, fallback);
    let entries: NodelNodeUrlEntry[];
    try {
      entries = await getNodeUrlsForNode(node, { signal: ticket.signal });
    } catch (error) {
      if (!this.isCurrent(ticket) || isAbortError(error)) {
        return;
      }
      this.setState('error', 'Direct address unavailable. Opens Network node search.', fallback);
      return;
    }
    if (!this.isCurrent(ticket)) {
      return;
    }
    const address = preferredNodeAddress(entries);
    if (!address) {
      this.setState('error', 'Direct address not found. Opens Network node search.', fallback);
      return;
    }
    this.setState('ready', '', address.href);
  }

  private isCurrent(ticket: LatestOperationTicket<'resolve'>) {
    return this.isConnected && ticket.isCurrent();
  }

  private setState(state: LinkState, message: string, href: string) {
    const anchor = this.anchor;
    if (!anchor || !this.status || !this.indicator) {
      return;
    }
    const safeHref = href ? safeNavigationHref(href) : null;
    const nextState = href && !safeHref ? 'error' : state;
    this.dataset.state = nextState;
    if (safeHref) {
      anchor.setAttribute('href', safeHref);
      anchor.removeAttribute('aria-disabled');
      anchor.removeAttribute('tabindex');
    } else {
      anchor.removeAttribute('href');
      anchor.setAttribute('aria-disabled', 'true');
      anchor.tabIndex = 0;
    }
    if (nextState === 'loading') {
      anchor.setAttribute('aria-busy', 'true');
      this.indicator.innerHTML = renderFontAwesomeIcon(uiIcons.spinner, 'h-3.5 w-3.5 animate-spin');
    } else {
      anchor.removeAttribute('aria-busy');
      this.indicator.innerHTML = nextState === 'error' ? renderFontAwesomeIcon(toastIcons.warning) : '';
    }
    this.status.textContent = message;
    this.syncDescription();
  }

  private syncDescription() {
    const anchor = this.anchor;
    if (!anchor || !this.status) {
      return;
    }
    const authoredDescription = this.getAttribute('aria-describedby')?.trim() ?? '';
    const descriptions = [authoredDescription, this.status.textContent ? this.status.id : ''].filter(Boolean);
    if (descriptions.length > 0) {
      anchor.setAttribute('aria-describedby', descriptions.join(' '));
    } else {
      anchor.removeAttribute('aria-describedby');
    }
  }
}

if (!customElements.get('nodel-link')) {
  customElements.define('nodel-link', NodelLink);
}
