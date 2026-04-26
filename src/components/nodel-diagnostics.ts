import { getBuildInfo, getDiagnostics } from '../api/nodel-host-client';
import type { NodelBuildInfo, NodelDiagnosticsResponse } from '../api/nodel-types';
import { registerNodelOneShotSource, type NodelSourceState, type NodelSourceSubscription } from '../data/nodel-data-runtime';

interface DiagnosticsState {
  loading: boolean;
  error: string;
  diagnostics: NodelDiagnosticsResponse | null;
  build: NodelBuildInfo | null;
}

interface DiagnosticsPayload {
  diagnostics: NodelDiagnosticsResponse;
  build: NodelBuildInfo | null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeText(value: unknown, fallback = 'Unavailable') {
  if (typeof value === 'string' && value.trim()) {
    return escapeHtml(value);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return escapeHtml(String(value));
  }

  return escapeHtml(fallback);
}

function formatDateTime(value?: string) {
  if (!value) {
    return 'Unavailable';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatDuration(value?: number) {
  if (!Number.isFinite(value ?? Number.NaN)) {
    return 'Unavailable';
  }

  let remaining = Math.max(0, Math.trunc(value ?? 0));
  const parts: string[] = [];
  const units: Array<[string, number]> = [
    ['d', 24 * 60 * 60 * 1000],
    ['h', 60 * 60 * 1000],
    ['m', 60 * 1000],
    ['s', 1000]
  ];

  for (const [label, unit] of units) {
    if (remaining < unit && parts.length === 0 && label !== 's') {
      continue;
    }

    const amount = Math.floor(remaining / unit);
    if (amount > 0 || parts.length > 0 || label === 's') {
      parts.push(`${amount}${label}`);
      remaining -= amount * unit;
    }
  }

  return parts.join(' ') || '0s';
}

function joinList(values?: string[]) {
  const items = (values ?? []).filter((value) => typeof value === 'string' && value.trim().length > 0);
  return items.length > 0 ? items.map((value) => escapeHtml(value)).join('<br />') : 'Unavailable';
}

function buildRelease(build: NodelBuildInfo | null) {
  if (!build?.version) {
    return 'Unavailable';
  }

  return `Open-source build <a href="/build.json"><strong>${escapeHtml(build.version)}</strong></a>`;
}

function buildLinks(build: NodelBuildInfo | null) {
  if (!build?.origin) {
    return 'Unavailable';
  }

  const origin = escapeHtml(build.origin);
  const branch = build.branch ? escapeHtml(build.branch) : 'main';
  const id = build.id ? escapeHtml(build.id) : '';
  const buildDate = build.date ? escapeHtml(formatDateTime(build.date)) : 'Unavailable';
  const host = build.host ? escapeHtml(build.host) : 'Unavailable';

  return `Built ${buildDate} on ${host}<br />Origin <a href="${origin}">${origin}</a><br />Branch <a href="${origin}/tree/${branch}">${branch}</a>${id ? `, last commit <a href="${origin}/commit/${id}">${id}</a>` : ''}`;
}

export class NodelDiagnostics extends HTMLElement {
  private state: DiagnosticsState = {
    loading: true,
    error: '',
    diagnostics: null,
    build: null
  };

  private source: NodelSourceSubscription<DiagnosticsPayload> | null = null;
  private static nextSourceId = 0;
  private sourceKey = '';

  connectedCallback() {
    if (!this.sourceKey) {
      NodelDiagnostics.nextSourceId += 1;
      this.sourceKey = `nodel-diagnostics-${NodelDiagnostics.nextSourceId}`;
    }

    void this.bindSource();
  }

  disconnectedCallback() {
    this.source?.dispose();
    this.source = null;
  }

  private async bindSource() {
    if (this.source) {
      this.source.dispose();
    }

    const source = registerNodelOneShotSource<DiagnosticsPayload>({
      key: this.sourceKey,
      fetcher: async (signal) => {
        const [diagnosticsResult, buildResult] = await Promise.allSettled([
          getDiagnostics({ signal }),
          getBuildInfo({ signal })
        ]);

        if (diagnosticsResult.status === 'rejected') {
          throw diagnosticsResult.reason;
        }

        return {
          diagnostics: diagnosticsResult.value,
          build: buildResult.status === 'fulfilled' ? buildResult.value : null
        };
      },
      visibleOnly: true
    });

    this.source = source.subscribe(this, (state: NodelSourceState<DiagnosticsPayload>) => {
      this.state = {
        loading: state.loading,
        error: state.error,
        diagnostics: state.data?.diagnostics ?? null,
        build: state.data?.build ?? null
      };
      this.render();
    });
  }

  private render() {
    if (this.state.loading) {
      this.innerHTML = `
        <div class="rounded-2xl border border-dashed border-[rgb(var(--nodel-border))] bg-[rgb(var(--nodel-surface))] px-4 py-3 text-sm text-[rgb(var(--nodel-muted))]">
          Loading diagnostics...
        </div>
      `;
      return;
    }

    if (this.state.error) {
      this.innerHTML = `
        <div class="rounded-2xl border border-[rgb(239 68 68)]/30 bg-[rgb(239 68 68)]/10 px-4 py-3 text-sm text-[rgb(220 38 38)]">
          ${escapeHtml(this.state.error)}
        </div>
      `;
      return;
    }

    const diagnostics = this.state.diagnostics;
    if (!diagnostics) {
      this.innerHTML = '';
      return;
    }

    this.innerHTML = `
      <div class="nodel-diagnostics overflow-hidden rounded-2xl border border-[rgb(var(--nodel-border))] bg-[rgb(var(--nodel-surface))] shadow-sm">
        <div class="overflow-x-auto">
          <table class="nodel-diagnostics-table min-w-full border-collapse text-left text-sm">
            <tbody class="divide-y divide-[rgb(var(--nodel-border))]">
              <tr>
                <th scope="row" class="whitespace-nowrap px-4 py-3 align-top text-sm font-medium text-[rgb(var(--nodel-muted))]">Release</th>
                <td class="px-4 py-3 text-[rgb(var(--nodel-fg))]">${buildRelease(this.state.build)}</td>
              </tr>
              <tr>
                <th scope="row" class="whitespace-nowrap px-4 py-3 align-top text-sm font-medium text-[rgb(var(--nodel-muted))]">Serving from</th>
                <td class="px-4 py-3 text-[rgb(var(--nodel-fg))]">${safeText(diagnostics.hostname)}</td>
              </tr>
              <tr>
                <th scope="row" class="whitespace-nowrap px-4 py-3 align-top text-sm font-medium text-[rgb(var(--nodel-muted))]">Advertising</th>
                <td class="px-4 py-3 text-[rgb(var(--nodel-fg))]">${joinList(diagnostics.httpAddresses)}</td>
              </tr>
              <tr>
                <th scope="row" class="whitespace-nowrap px-4 py-3 align-top text-sm font-medium text-[rgb(var(--nodel-muted))]">Uptime</th>
                <td class="px-4 py-3 text-[rgb(var(--nodel-fg))]">${escapeHtml(formatDuration(diagnostics.uptime))}, start timestamp ${escapeHtml(formatDateTime(diagnostics.startTime))}</td>
              </tr>
              <tr>
                <th scope="row" class="whitespace-nowrap px-4 py-3 align-top text-sm font-medium text-[rgb(var(--nodel-muted))]">Host path</th>
                <td class="px-4 py-3 text-[rgb(var(--nodel-fg))] break-words">${safeText(diagnostics.hostPath)}</td>
              </tr>
              <tr>
                <th scope="row" class="whitespace-nowrap px-4 py-3 align-top text-sm font-medium text-[rgb(var(--nodel-muted))]">Nodes root</th>
                <td class="px-4 py-3 text-[rgb(var(--nodel-fg))] break-words">${safeText(diagnostics.nodesRoot)}</td>
              </tr>
              <tr>
                <th scope="row" class="whitespace-nowrap px-4 py-3 align-top text-sm font-medium text-[rgb(var(--nodel-muted))]">Hosting rule</th>
                <td class="px-4 py-3 text-[rgb(var(--nodel-fg))] break-words">${safeText(diagnostics.hostingRule)}</td>
              </tr>
              <tr>
                <th scope="row" class="whitespace-nowrap px-4 py-3 align-top text-sm font-medium text-[rgb(var(--nodel-muted))]">Announcing agent</th>
                <td class="px-4 py-3 text-[rgb(var(--nodel-fg))] break-words">${safeText(diagnostics.agent)}</td>
              </tr>
              <tr>
                <th scope="row" class="whitespace-nowrap px-4 py-3 align-top text-sm font-medium text-[rgb(var(--nodel-muted))]">Build details</th>
                <td class="px-4 py-3 text-[rgb(var(--nodel-fg))] break-words">${buildLinks(this.state.build)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
}

if (!customElements.get('nodel-diagnostics')) {
  customElements.define('nodel-diagnostics', NodelDiagnostics);
}
