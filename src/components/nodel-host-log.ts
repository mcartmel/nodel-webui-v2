import { getHostLogs } from '../api/nodel-host-client';
import type { NodelHostLogEntry } from '../api/nodel-types';
import { registerNodelPollSource, type NodelSourceSubscription } from '../data/nodel-data-runtime';
import { getJQuery, linkTemplate, unlinkTemplate } from '../jsviews/jsviews-runtime';

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

interface HostLogViewModel {
  entries: HostLogEntryView[];
  empty: boolean;
  showStatus: boolean;
  statusLabel: string;
  statusState: 'loading' | 'active' | 'paused' | 'error';
}

const template = `
  <div class="nodel-host-log relative space-y-3">
    {^{if showStatus}}
      <div class="nodel-host-log-status nodel-alert nodel-alert-sm" role="status" data-link="class{:statusState === 'error' ? 'nodel-host-log-status nodel-alert nodel-alert-danger nodel-alert-sm' : 'nodel-host-log-status nodel-alert nodel-alert-sm'}">{^{>statusLabel}}</div>
    {{/if}}
    <div class="nodel-host-log-frame nodel-card">
      <div data-host-log-output class="nodel-host-log-output">
        {^{if empty}}
          <div class="nodel-host-log-empty">No host log entries.</div>
        {{else}}
          {^{for entries}}
            <div data-link="class{:lineClass}">
              <span class="nodel-host-log-timestamp">{^{>displayTime}}</span>
              <span class="nodel-host-log-level">{^{>level}}</span>
              <span class="nodel-host-log-message">{^{>message}}</span>
              {^{if meta}}<span class="nodel-host-log-meta">{^{>meta}}</span>{{/if}}
              {^{if error}}<pre class="nodel-host-log-error">{^{>error}}</pre>{{/if}}
            </div>
          {{/for}}
        {{/if}}
      </div>
    </div>
  </div>
`;

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
  private linked = false;
  private seq: number | null = null;
  private source: NodelSourceSubscription<HostLogBatch> | null = null;
  private static nextSourceId = 0;
  private sourceKey = '';
  private view: HostLogViewModel = {
    entries: [],
    empty: false,
    showStatus: true,
    statusLabel: 'Loading host log',
    statusState: 'loading'
  };

  connectedCallback() {
    if (!this.sourceKey) {
      NodelHostLog.nextSourceId += 1;
      this.sourceKey = `nodel-host-log-${NodelHostLog.nextSourceId}`;
    }

    void this.initialize();
  }

  disconnectedCallback() {
    this.source?.dispose();
    this.source = null;
    void unlinkTemplate(this);
    this.linked = false;
  }

  private async initialize() {
    if (!this.linked) {
      await linkTemplate(this, template, this.view);
      this.linked = true;
    }

    if (this.source) {
      return;
    }

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

  private updateStatus(loading: boolean, error: string, active: boolean) {
    const statusLabel = error || (loading ? 'Loading host log' : active ? 'Host log' : 'Host log polling paused');
    const statusState = error ? 'error' : loading ? 'loading' : active ? 'active' : 'paused';
    this.dataset.state = statusState;
    this.setAttribute('aria-label', statusLabel);
    this.title = statusLabel;
    getJQuery().observable(this.view).setProperty({
      showStatus: statusState !== 'active',
      statusLabel,
      statusState
    });
  }

  private applyBatch(entries: NodelHostLogEntry[], replace: boolean) {
    const output = this.querySelector<HTMLElement>('[data-host-log-output]');
    const shouldScroll = output ? output.scrollTop + output.clientHeight >= output.scrollHeight - 4 : true;
    const current = replace ? [] : this.entries;
    this.entries = [...current, ...entries.map(toEntryView)].slice(-200);
    getJQuery().observable(this.view.entries).refresh(this.entries);
    getJQuery().observable(this.view).setProperty('empty', this.entries.length === 0);

    const nextOutput = this.querySelector<HTMLElement>('[data-host-log-output]');
    if (shouldScroll && nextOutput) {
      nextOutput.scrollTop = nextOutput.scrollHeight;
    }
  }
}

if (!customElements.get('nodel-host-log')) {
  customElements.define('nodel-host-log', NodelHostLog);
}
