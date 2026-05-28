import { getHostLogs } from '../api/nodel-host-client';
import type { NodelHostLogEntry } from '../api/nodel-types';
import { registerNodelPollSource, type NodelSourceSubscription } from '../data/nodel-data-runtime';
import { escapeHtml } from '../utils/html';

interface HostLogBatch {
  entries: NodelHostLogEntry[];
  replace: boolean;
  nextSeq: number;
}

interface HostLogEntryView {
  displayTime: string;
  error: string;
  level: string;
  lineClass: string;
  message: string;
  meta: string;
  seq: number;
}

function formatTimestamp(timestamp: unknown) {
  const value = String(timestamp ?? '');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}

function levelClass(level: string) {
  const normalized = level.toLowerCase();
  return ['trace', 'debug', 'info', 'warn', 'error'].includes(normalized) ? normalized : 'info';
}

function toEntryView(entry: NodelHostLogEntry): HostLogEntryView {
  const level = String(entry.level ?? 'INFO');
  const meta = [entry.tag, entry.thread].filter((value) => typeof value === 'string' && value.trim()).join(' / ');

  return {
    displayTime: formatTimestamp(entry.timestamp),
    error: String(entry.error ?? ''),
    level,
    lineClass: `nodel-host-log-line nodel-host-log-level-${levelClass(level)}`,
    message: String(entry.message ?? ''),
    meta,
    seq: entry.seq
  };
}

export class NodelHostLog extends HTMLElement {
  private entries: HostLogEntryView[] = [];
  private lastAppliedNextSeq: number | null = null;
  private seq: number | null = null;
  private source: NodelSourceSubscription<HostLogBatch> | null = null;
  private static nextSourceId = 0;
  private sourceKey = '';
  private statusLabel = 'Loading host log';
  private statusState: 'loading' | 'active' | 'paused' | 'error' = 'loading';

  connectedCallback() {
    if (!this.sourceKey) {
      NodelHostLog.nextSourceId += 1;
      this.sourceKey = `nodel-host-log-${NodelHostLog.nextSourceId}`;
    }

    this.render();
    const source = registerNodelPollSource<HostLogBatch>({
      key: this.sourceKey,
      intervalMs: 1000,
      visibleOnly: true,
      fetcher: async (signal) => {
        const initial = this.seq === null;
        const entries = await getHostLogs(
          {
            from: initial ? -1 : (this.seq ?? 0),
            max: initial ? 200 : 9999
          },
          { signal }
        );
        const chronological = [...entries].reverse();
        const nextSeq = chronological.length > 0 ? chronological[chronological.length - 1].seq + 1 : (this.seq ?? 0);
        this.seq = nextSeq;

        return {
          entries: chronological,
          replace: initial,
          nextSeq
        };
      }
    });

    this.source = source.subscribe(this, (state) => {
      if (state.data && (state.data.replace || state.data.nextSeq !== this.lastAppliedNextSeq)) {
        this.applyBatch(state.data.entries, state.data.replace);
        this.lastAppliedNextSeq = state.data.nextSeq;
      }
      this.updateStatus(state.loading, state.error, state.active);
    });
  }

  disconnectedCallback() {
    this.source?.dispose();
    this.source = null;
  }

  private updateStatus(loading: boolean, error: string, active: boolean) {
    this.statusLabel = error || (loading ? 'Loading host log' : active ? 'Host log' : 'Host log polling paused');
    this.statusState = error ? 'error' : loading ? 'loading' : active ? 'active' : 'paused';
    this.dataset.state = this.statusState;
    this.setAttribute('aria-label', this.statusLabel);
    this.title = this.statusLabel;
    this.render();
  }

  private applyBatch(entries: NodelHostLogEntry[], replace: boolean) {
    const current = replace ? [] : this.entries;
    this.entries = [...current, ...entries.map(toEntryView)].slice(-200);
    this.render();
  }

  private render() {
    const output = this.querySelector<HTMLElement>('[data-host-log-output]');
    const shouldScroll = output ? output.scrollTop + output.clientHeight >= output.scrollHeight - 4 : true;
    const status = this.statusState === 'active'
      ? ''
      : `<div class="nodel-host-log-status nodel-alert ${this.statusState === 'error' ? 'nodel-alert-danger ' : ''}nodel-alert-sm" role="status">${escapeHtml(this.statusLabel)}</div>`;
    const rows = this.entries.map((entry) => `
      <div class="${entry.lineClass}">
        <span class="nodel-host-log-timestamp">${escapeHtml(entry.displayTime)}</span>
        <span class="nodel-host-log-level">${escapeHtml(entry.level)}</span>
        <span class="nodel-host-log-message">${escapeHtml(entry.message)}</span>
        ${entry.meta ? `<span class="nodel-host-log-meta">${escapeHtml(entry.meta)}</span>` : ''}
        ${entry.error ? `<pre class="nodel-host-log-error">${escapeHtml(entry.error)}</pre>` : ''}
      </div>
    `).join('');

    this.innerHTML = `
      <div class="nodel-host-log relative space-y-3">
        ${status}
        <div class="nodel-host-log-frame nodel-card">
          <div data-host-log-output class="nodel-host-log-output">
            ${rows || '<div class="nodel-host-log-empty">No host log entries.</div>'}
          </div>
        </div>
      </div>
    `;

    const nextOutput = this.querySelector<HTMLElement>('[data-host-log-output]');
    if (shouldScroll && nextOutput) {
      nextOutput.scrollTop = nextOutput.scrollHeight;
    }
  }
}

if (!customElements.get('nodel-host-log')) {
  customElements.define('nodel-host-log', NodelHostLog);
}
