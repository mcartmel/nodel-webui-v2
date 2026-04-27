import { executeNodeConsoleCommand } from '../api/nodel-host-client';
import type { NodelConsoleLogEntry } from '../api/nodel-types';
import { escapeHtml } from '../utils/html';
import { refreshNodeConsole, subscribeNodeConsole } from '../data/node-console-source';

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
}

function consoleClass(entry: NodelConsoleLogEntry) {
  return `nodel-console-line nodel-console-type-${entry.console}`;
}

export class NodelConsole extends HTMLElement {
  private logs: NodelConsoleLogEntry[] = [];
  private source: ReturnType<typeof subscribeNodeConsole> | null = null;
  private history: string[] = [];
  private historyIndex = -1;
  private shellReady = false;
  private lastAppliedNextSeq: number | null = null;

  connectedCallback() {
    this.renderShell();
    this.bindEvents();
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

  disconnectedCallback() {
    this.source?.dispose();
    this.source = null;
    this.removeEventListeners();
  }

  private renderShell() {
    if (this.shellReady) {
      return;
    }

    this.innerHTML = `
      <div class="nodel-console relative space-y-3">
        <div data-console-output class="nodel-console-output h-[14.4rem] overflow-auto rounded-xl border border-[rgb(var(--nodel-border))] bg-[rgb(var(--nodel-surface))] p-3 font-mono text-xs leading-5 text-[rgb(var(--nodel-fg))]"></div>
        <div class="space-y-2">
          <div id="nodel-console-input" data-console-input class="nodel-console-input min-h-10 rounded-xl border border-[rgb(var(--nodel-border))] bg-[rgb(var(--nodel-surface))] px-3 py-2 font-mono text-sm text-[rgb(var(--nodel-fg))] outline-none" contenteditable="true" spellcheck="false" role="textbox" aria-label="Console input" aria-multiline="false"></div>
        </div>
      </div>
    `;
    this.shellReady = true;
  }

  private bindEvents() {
    const input = this.querySelector<HTMLElement>('[data-console-input]');
    input?.removeEventListener('keydown', this.handleKeydown);
    input?.addEventListener('keydown', this.handleKeydown);
  }

  private removeEventListeners() {
    const input = this.querySelector<HTMLElement>('[data-console-input]');
    input?.removeEventListener('keydown', this.handleKeydown);
  }

  private updateStatus(loading: boolean, error: string, connected: boolean) {
    const label = error || (loading ? 'Loading console history' : connected ? 'Console polling active' : 'Console polling paused');
    this.dataset.state = error ? 'error' : loading ? 'loading' : connected ? 'active' : 'paused';
    this.setAttribute('aria-label', label);
    this.title = label;
  }

  private applyBatch(entries: NodelConsoleLogEntry[], replace: boolean) {
    const output = this.querySelector<HTMLElement>('[data-console-output]');
    if (!output) {
      return;
    }

    const shouldScroll = output.scrollTop + output.clientHeight >= output.scrollHeight - 4;
    if (replace) {
      this.logs = [...entries];
    } else {
      this.logs.push(...entries);
    }

    if (this.logs.length > 200) {
      this.logs = this.logs.slice(this.logs.length - 200);
    }

    output.innerHTML = this.logs
      .map((entry) => `
        <div class="${consoleClass(entry)}">
          <span class="nodel-console-timestamp">${escapeHtml(formatTimestamp(entry.timestamp))}</span>
          <span class="nodel-console-comment">${escapeHtml(entry.comment)}</span>
        </div>
      `)
      .join('');

    if (shouldScroll) {
      output.scrollTop = output.scrollHeight;
    }
  }

  private handleKeydown = async (event: KeyboardEvent) => {
    const input = event.currentTarget as HTMLElement | null;
    if (!input) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const code = (input.textContent ?? '').replace(/\u00A0/g, ' ').trim();
      if (!code) {
        return;
      }

      this.history.unshift(code);
      this.historyIndex = -1;
      input.textContent = '';

      try {
        await executeNodeConsoleCommand(code);
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
      input.textContent = this.history[this.historyIndex] ?? '';
      this.moveCaretToEnd(input);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (this.historyIndex <= 0) {
        this.historyIndex = -1;
        input.textContent = '';
        return;
      }

      this.historyIndex -= 1;
      input.textContent = this.history[this.historyIndex] ?? '';
      this.moveCaretToEnd(input);
    }
  };

  private moveCaretToEnd(element: HTMLElement) {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

if (!customElements.get('nodel-console')) {
  customElements.define('nodel-console', NodelConsole);
}
