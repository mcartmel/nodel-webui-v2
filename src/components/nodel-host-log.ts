import { getHostLogs } from '../api/nodel-host-client';
import type { NodelHostLogEntry } from '../api/nodel-types';
import { registerNodelPollSource, type NodelSourceSubscription } from '../data/nodel-data-runtime';
import { getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { renderComponentError } from '../utils/render-component-error';

interface HostLogBatch {
  entries: NodelHostLogEntry[];
  replace: boolean;
  nextSeq: number;
}

interface HostLogEntryView {
  displayTime: string;
  error: string;
  levelClass: string;
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
            <div data-link="class{:lineClass} data-log-level{:levelClass}">
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
const hostLogInitialPageSize = 200;
const hostLogIncrementalPageSize = 200;

function formatTimestamp(timestamp: unknown) {
  const value = safeText(timestamp);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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
    levelClass: levelClass(level),
    lineClass: 'nodel-host-log-line',
    message: String(entry.message ?? ''),
    meta,
    seq: entry.seq
  };
}

export class NodelHostLog extends HTMLElement {
  static observedAttributes = ['collapse-preview'];
  private entries: HostLogEntryView[] = [];
  private hasSuccessfulResponse = false;
  private currentError = '';
  private currentLoading = true;
  private currentActive = true;
  private initializationFailed = false;
  private lastAppliedNextSeq: number | null = null;
  private lifecycle = new ComponentLifecycle();
  private linkController = new JsViewsLinkController(this);
  private linked = false;
  private seq: number | null = null;
  private source: NodelSourceSubscription<HostLogBatch> | null = null;
  private static nextSourceId = 0;
  private sourceKey = '';
  private lastPreview: string | null = null;
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

    const scope = this.lifecycle.connect();
    if (scope) {
      this.initializationFailed = false;
      this.lastPreview = null;
      void scope.run(() => this.initialize(scope), (error) => this.handleInitializationError(error));
    }
  }

  disconnectedCallback() {
    this.lifecycle.disconnect();
    this.linked = false;
  }

  private async initialize(scope: ConnectionScope) {
    const linked = await this.linkController.link(scope, template, this.view);
    if (!linked || !scope.isCurrent()) {
      return;
    }
    this.linked = true;
    this.initializationFailed = false;

    const source = registerNodelPollSource<HostLogBatch>({
      key: this.sourceKey,
      intervalMs: 1000,
      visibleOnly: true,
      fetcher: async (signal) => {
        const initial = this.seq === null;
        const entries = await getHostLogs(
          {
            from: initial ? -1 : (this.seq ?? 0),
            max: initial ? hostLogInitialPageSize : hostLogIncrementalPageSize
          },
          { signal }
        );
        if (!scope.isCurrent() || signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const chronological = [...entries].reverse();
        const lastEntry = chronological.at(-1);
        const nextSeq = lastEntry ? Math.max(this.seq ?? 0, lastEntry.seq + 1) : (this.seq ?? 0);

        return {
          entries: chronological,
          replace: initial,
          nextSeq
        };
      }
    });

    const subscription = source.subscribe(this, scope.guard((state) => {
      if (state.data && (state.data.replace || state.data.nextSeq !== this.lastAppliedNextSeq)) {
        this.seq = state.data.nextSeq;
        this.applyBatch(state.data.entries, state.data.replace);
        this.lastAppliedNextSeq = state.data.nextSeq;
      }
      if (state.data) this.hasSuccessfulResponse = true;
      this.updateStatus(state.loading, state.error, state.active);
    }));
    this.source = subscription;
    scope.own(() => {
      subscription.dispose();
      if (this.source === subscription) {
        this.source = null;
      }
    });
  }

  private updateStatus(loading: boolean, error: string, active: boolean) {
    this.currentLoading = loading;
    this.currentError = error;
    this.currentActive = active;
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
    this.publishPreview(error, loading, active);
  }

  attributeChangedCallback() {
    if (!this.lifecycle.current?.isCurrent()) {
      return;
    }
    if (this.linked) {
      this.publishPreview();
    } else if (this.initializationFailed) {
      this.publishInitializationFailurePreview();
    }
  }

  private publishPreview(error = this.currentError, loading = this.currentLoading, active = this.currentActive) {
    if (!this.linked || this.getAttribute('collapse-preview') === 'none') {
      if (this.linked && this.lastPreview !== null && this.lastPreview !== '') {
        this.lastPreview = '';
        this.dispatchPreview('');
      }
      return;
    }
    const latest = this.entries.at(-1);
    const text = error ? 'Host log unavailable'
      : !this.hasSuccessfulResponse ? (!active ? 'Host log polling paused' : loading ? 'Loading host log' : 'Host log polling paused')
        : latest ? `${latest.displayTime} ${latest.level}: ${latest.message.trim() || '(no message)'}`.replace(/\s+/g, ' ').trim()
          : 'No host log entries yet';
    const summary = !error && this.hasSuccessfulResponse && !active ? `${text} — polling paused` : text;
    if (summary !== this.lastPreview) {
      this.lastPreview = summary;
      this.dispatchPreview(summary);
    }
  }

  private dispatchPreview(text: string) {
    this.dispatchEvent(new CustomEvent('nodel-collapse-preview', {
      bubbles: true,
      detail: { source: 'host-log', text }
    }));
  }

  private handleInitializationError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to initialize host log';
    this.dataset.state = 'error';
    if (this.linked) {
      this.updateStatus(false, message, false);
    } else {
      this.initializationFailed = true;
      renderComponentError(this, message);
      this.publishInitializationFailurePreview();
    }
  }

  private publishInitializationFailurePreview() {
    if (this.getAttribute('collapse-preview') === 'none') {
      if (this.lastPreview !== null && this.lastPreview !== '') {
        this.lastPreview = '';
        this.dispatchPreview('');
      }
      return;
    }
    if (this.lastPreview !== 'Host log unavailable') {
      this.lastPreview = 'Host log unavailable';
      this.dispatchPreview(this.lastPreview);
    }
  }

  private applyBatch(entries: NodelHostLogEntry[], replace: boolean) {
    const output = this.querySelector<HTMLElement>('[data-host-log-output]');
    const shouldScroll = output ? output.scrollTop + output.clientHeight >= output.scrollHeight - 4 : true;
    const current = replace ? [] : this.entries;
    this.entries = [...current, ...entries.map(toEntryView)].slice(-200);
    getJQuery().observable(this.view.entries).refresh(this.entries);
    getJQuery().observable(this.view).setProperty('empty', this.entries.length === 0);
    this.hasSuccessfulResponse = true;
    this.publishPreview();

    const nextOutput = this.querySelector<HTMLElement>('[data-host-log-output]');
    if (shouldScroll && nextOutput) {
      nextOutput.scrollTop = nextOutput.scrollHeight;
    }
  }
}

if (!customElements.get('nodel-host-log')) {
  customElements.define('nodel-host-log', NodelHostLog);
}
import { safeText } from '../utils/html';
