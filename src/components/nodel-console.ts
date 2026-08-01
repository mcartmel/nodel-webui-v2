import { executeNodeConsoleCommand } from '../api/nodel-host-client';
import type { NodelConsoleLogEntry } from '../api/nodel-types';
import { refreshNodeConsole, subscribeNodeConsole } from '../data/node-console-source';
import { getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { renderComponentError } from '../utils/render-component-error';

interface ConsoleEntryView {
  comment: string;
  console: NodelConsoleLogEntry['console'];
  displayTime: string;
  lineClass: string;
  seq: number;
}

interface ConsoleViewModel {
  commandError: string;
  commandText: string;
  empty: boolean;
  entries: ConsoleEntryView[];
  statusLabel: string;
  statusState: 'loading' | 'active' | 'paused' | 'error';
}

const template = `
  <div class="nodel-console relative space-y-3" data-link="title{:statusLabel} aria-label{:statusLabel}">
    {^{if commandError}}
      <div data-console-status class="nodel-alert nodel-alert-danger nodel-alert-md" role="alert">{^{>commandError}}</div>
    {{else statusState === 'error'}}
      <div data-console-status class="nodel-alert nodel-alert-danger nodel-alert-md" role="alert">{^{>statusLabel}}</div>
    {{/if}}
    <div class="nodel-console-frame nodel-card">
      <div data-console-output class="nodel-console-output h-full overflow-auto p-3 font-mono text-xs leading-5 text-nodel-fg">
        {^{if empty}}
          <div class="nodel-console-empty text-nodel-muted" role="status">No console output yet.</div>
        {{else}}
          {^{for entries}}
            <div data-link="class{:lineClass}">
              <span class="nodel-console-timestamp">{^{>displayTime}}</span>
              <span class="nodel-console-comment">{^{>comment}}</span>
            </div>
          {{/for}}
        {{/if}}
      </div>
    </div>
    <div class="space-y-2">
      <input id="nodel-console-input" data-console-input class="nodel-console-input nodel-field min-h-10 w-full font-mono" type="text" spellcheck="false" aria-label="Console input" data-link="commandText trigger=true" />
    </div>
  </div>
`;

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
}

function toEntryView(entry: NodelConsoleLogEntry): ConsoleEntryView {
  return {
    comment: entry.comment,
    console: entry.console,
    displayTime: formatTimestamp(entry.timestamp),
    lineClass: `nodel-console-line nodel-console-type-${entry.console}`,
    seq: entry.seq
  };
}

function consolePreviewText(entry: ConsoleEntryView) {
  const label = entry.console === 'err' ? 'error: ' : entry.console === 'warn' ? 'warn: ' : entry.console === 'info' ? 'info: ' : '';
  return `${entry.displayTime} ${label}${entry.comment}`.replace(/\s+/g, ' ').trim();
}

export class NodelConsole extends HTMLElement {
  private commandToken = 0;
  private history: string[] = [];
  private historyIndex = -1;
  private lastAppliedNextSeq: number | null = null;
  private lifecycle = new ComponentLifecycle();
  private linkController = new JsViewsLinkController(this);
  private linked = false;
  private source: ReturnType<typeof subscribeNodeConsole> | null = null;
  private state: ConsoleViewModel = {
    commandError: '',
    commandText: '',
    empty: false,
    entries: [],
    statusLabel: 'Loading console history',
    statusState: 'loading'
  };

  connectedCallback() {
    const scope = this.lifecycle.connect();
    if (scope) {
      void scope.run(() => this.initialize(scope), (error) => this.handleInitializationError(error));
    }
  }

  disconnectedCallback() {
    this.commandToken += 1;
    if (this.linked) {
      getJQuery().observable(this.state).setProperty('commandError', '');
    }
    this.lifecycle.disconnect();
    this.removeEventListeners();
    this.linked = false;
  }

  private async initialize(scope: ConnectionScope) {
    const linked = await this.linkController.link(scope, template, this.state, {
      handleKeydown: this.handleKeydown
    });
    if (!linked || !scope.isCurrent()) {
      return;
    }
    this.linked = true;
    this.bindEvents(scope);

    const source = subscribeNodeConsole(this, scope.guard((state) => {
      if (state.data) {
        if (state.data.replace || state.data.nextSeq !== this.lastAppliedNextSeq) {
          this.applyBatch(state.data.entries, state.data.replace);
          this.lastAppliedNextSeq = state.data.nextSeq;
        }
      }
      this.updateStatus(state.loading, state.error, state.active);
    }));
    this.source = source;
    scope.own(() => {
      source.dispose();
      if (this.source === source) {
        this.source = null;
      }
    });
  }

  private bindEvents(scope: ConnectionScope) {
    const input = this.querySelector('[data-console-input]');
    if (input) {
      scope.listen(input, 'keydown', this.handleKeydownEvent);
    }
  }

  private removeEventListeners() {
    this.querySelector('[data-console-input]')?.removeEventListener('keydown', this.handleKeydownEvent);
  }

  private get collapsePreviewMode() {
    return this.getAttribute('collapse-preview');
  }

  private updateStatus(loading: boolean, error: string, connected: boolean) {
    const label = this.state.commandError || error || (loading ? 'Loading console history' : connected ? 'Console polling active' : 'Console polling paused');
    const statusState = this.state.commandError || error ? 'error' : loading ? 'loading' : connected ? 'active' : 'paused';
    const $ = getJQuery();

    $.observable(this.state).setProperty({
      statusLabel: label,
      statusState
    });
    this.syncEmptyState(statusState);
    this.dataset.state = statusState;
    this.setAttribute('aria-label', label);
    this.title = label;
  }

  private applyBatch(entries: NodelConsoleLogEntry[], replace: boolean) {
    const output = this.querySelector<HTMLElement>('[data-console-output]');
    const shouldScroll = output ? output.scrollTop + output.clientHeight >= output.scrollHeight - 4 : false;
    const current = replace ? [] : this.state.entries;
    const nextEntries = [...current, ...entries.map(toEntryView)].slice(-200);
    const $ = getJQuery();

    $.observable(this.state.entries).refresh(nextEntries);
    this.syncEmptyState(this.state.statusState, nextEntries);
    this.emitCollapsePreview(nextEntries[nextEntries.length - 1]);

    if (shouldScroll && output) {
      output.scrollTop = output.scrollHeight;
    }
  }

  private emitCollapsePreview(entry: ConsoleEntryView | undefined) {
    if (this.collapsePreviewMode !== 'last-line' || !entry) {
      return;
    }

    this.dispatchEvent(new CustomEvent('nodel-collapse-preview', {
      bubbles: true,
      detail: {
        source: 'console',
        text: consolePreviewText(entry)
      }
    }));
  }

  private syncEmptyState(statusState: ConsoleViewModel['statusState'], entries = this.state.entries) {
    getJQuery().observable(this.state).setProperty(
      'empty',
      statusState !== 'loading' && statusState !== 'error' && entries.length === 0
    );
  }

  private handleInitializationError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to initialize console';
    this.dataset.state = 'error';
    if (this.linked) {
      this.updateStatus(false, message, false);
    } else {
      renderComponentError(this, message);
    }
  }

  private handleKeydownEvent = (event: Event) => {
    void this.handleKeydown(event as KeyboardEvent);
  };

  private handleKeydown = async (event: KeyboardEvent) => {
    const command = this.state.commandText.replace(/\u00A0/g, ' ').trim();

    if (event.key === 'Enter') {
      event.preventDefault();
      if (!command) {
        return;
      }

      this.history.unshift(command);
      this.historyIndex = -1;
      this.setCommandText('');

      const scope = this.lifecycle.current;
      if (!scope) {
        return;
      }
      const commandToken = ++this.commandToken;
      getJQuery().observable(this.state).setProperty('commandError', '');
      this.updateStatus(false, '', true);
      try {
        await executeNodeConsoleCommand(command, { signal: scope.signal });
        if (scope.isCurrent() && commandToken === this.commandToken) {
          getJQuery().observable(this.state).setProperty('commandError', '');
          this.updateStatus(false, '', true);
          void refreshNodeConsole();
        }
      } catch (error) {
        if (scope.isCurrent() && commandToken === this.commandToken) {
          getJQuery().observable(this.state).setProperty('commandError', error instanceof Error ? error.message : 'Failed to execute console command');
          this.updateStatus(false, '', true);
        }
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.history.length === 0) {
        return;
      }

      this.historyIndex = Math.min(this.history.length - 1, this.historyIndex + 1);
      this.setCommandText(this.history[this.historyIndex] ?? '');
      this.moveCaretToEnd(event.target);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (this.historyIndex <= 0) {
        this.historyIndex = -1;
        this.setCommandText('');
        return;
      }

      this.historyIndex -= 1;
      this.setCommandText(this.history[this.historyIndex] ?? '');
      this.moveCaretToEnd(event.target);
    }
  };

  private setCommandText(value: string) {
    getJQuery().observable(this.state).setProperty('commandText', value);
  }

  private moveCaretToEnd(target: EventTarget | null) {
    if (target instanceof HTMLInputElement) {
      const length = this.state.commandText.length;
      target.setSelectionRange(length, length);
    }
  }
}

if (!customElements.get('nodel-console')) {
  customElements.define('nodel-console', NodelConsole);
}
