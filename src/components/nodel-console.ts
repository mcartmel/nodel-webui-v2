import { executeNodeConsoleCommand } from '../api/nodel-host-client';
import type { NodelConsoleLogEntry } from '../api/nodel-types';
import { refreshNodeConsole, subscribeNodeConsole } from '../data/node-console-source';
import { getJQuery, linkTemplate, unlinkTemplate } from '../jsviews/jsviews-runtime';

interface ConsoleEntryView {
  comment: string;
  console: NodelConsoleLogEntry['console'];
  displayTime: string;
  lineClass: string;
  seq: number;
}

interface ConsoleViewModel {
  commandText: string;
  entries: ConsoleEntryView[];
  statusLabel: string;
  statusState: 'loading' | 'active' | 'paused' | 'error';
}

const template = `
  <div class="nodel-console relative space-y-3" data-link="title{:statusLabel} aria-label{:statusLabel}">
    <div data-console-output class="nodel-console-output h-[14.4rem] overflow-auto rounded-xl border border-[rgb(var(--nodel-border))] bg-[rgb(var(--nodel-surface))] p-3 font-mono text-xs leading-5 text-[rgb(var(--nodel-fg))]">
      {^{for entries}}
        <div data-link="class{:lineClass}">
          <span class="nodel-console-timestamp">{^{>displayTime}}</span>
          <span class="nodel-console-comment">{^{>comment}}</span>
        </div>
      {{/for}}
    </div>
    <div class="space-y-2">
      <input id="nodel-console-input" data-console-input class="nodel-console-input min-h-10 w-full rounded-xl border border-[rgb(var(--nodel-border))] bg-[rgb(var(--nodel-surface))] px-3 py-2 font-mono text-sm text-[rgb(var(--nodel-fg))] outline-none" type="text" spellcheck="false" aria-label="Console input" data-link="commandText trigger=true" />
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

export class NodelConsole extends HTMLElement {
  private history: string[] = [];
  private historyIndex = -1;
  private lastAppliedNextSeq: number | null = null;
  private linked = false;
  private source: ReturnType<typeof subscribeNodeConsole> | null = null;
  private state: ConsoleViewModel = {
    commandText: '',
    entries: [],
    statusLabel: 'Loading console history',
    statusState: 'loading'
  };

  connectedCallback() {
    void this.initialize();
  }

  disconnectedCallback() {
    this.source?.dispose();
    this.source = null;
    this.removeEventListeners();
    void unlinkTemplate(this);
    this.linked = false;
  }

  private async initialize() {
    if (!this.linked) {
      await linkTemplate(this, template, this.state, {
        handleKeydown: this.handleKeydown
      });
      this.linked = true;
      this.bindEvents();
    }

    if (this.source) {
      return;
    }

    this.source = subscribeNodeConsole(this, (state) => {
      if (state.data) {
        if (state.data.replace || state.data.nextSeq !== this.lastAppliedNextSeq) {
          this.applyBatch(state.data.entries, state.data.replace);
          this.lastAppliedNextSeq = state.data.nextSeq;
        }
      }
      this.updateStatus(state.loading, state.error, state.active);
    });
  }

  private bindEvents() {
    this.querySelector('[data-console-input]')?.addEventListener('keydown', this.handleKeydownEvent);
  }

  private removeEventListeners() {
    this.querySelector('[data-console-input]')?.removeEventListener('keydown', this.handleKeydownEvent);
  }

  private updateStatus(loading: boolean, error: string, connected: boolean) {
    const label = error || (loading ? 'Loading console history' : connected ? 'Console polling active' : 'Console polling paused');
    const statusState = error ? 'error' : loading ? 'loading' : connected ? 'active' : 'paused';
    const $ = getJQuery();

    $.observable(this.state).setProperty({
      statusLabel: label,
      statusState
    });
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

    if (shouldScroll && output) {
      output.scrollTop = output.scrollHeight;
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

      try {
        await executeNodeConsoleCommand(command);
      } finally {
        void refreshNodeConsole();
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
