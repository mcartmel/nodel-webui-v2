import { getBuildInfo, getDiagnostics } from '../api/nodel-host-client';
import type { NodelBuildInfo, NodelDiagnosticsResponse } from '../api/nodel-types';
import { registerNodelOneShotSource, type NodelSourceState, type NodelSourceSubscription } from '../data/nodel-data-runtime';
import { escapeHtml } from '../utils/html';
import { appendUrlPath, safeJavaAbsoluteHttpUrl } from '../utils/urls';

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

function safeText(value: unknown, fallback = 'Unavailable') {
  if (typeof value === 'string' && value.trim()) {
    return escapeHtml(value);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return escapeHtml(String(value));
  }

  return escapeHtml(fallback);
}

function buildText(value: unknown) {
  return typeof value === 'string' ? escapeHtml(value) : 'Unavailable';
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

  return `Open-source build <a class="nodel-link" href="/build.json"><strong>${escapeHtml(build.version)}</strong></a>`;
}

function buildLinks(build: NodelBuildInfo | null) {
  const originValue = typeof build?.origin === 'string' ? build.origin : '';
  const branchValue = typeof build?.branch === 'string' ? build.branch : '';
  const commitValue = typeof build?.id === 'string' ? build.id : typeof build?.rev === 'string' ? build.rev : '';
  const parsedOrigin = originValue ? safeJavaAbsoluteHttpUrl(originValue) : null;
  // Scoped/legacy URL shims are safe for transport, but diagnostics links use native URLs only.
  const originUrl = parsedOrigin instanceof URL ? parsedOrigin : null;
  const originText = buildText(originValue);
  const branchText = buildText(branchValue);
  const commitText = buildText(commitValue);
  const origin = originUrl
    ? `<a class="nodel-link" href="${escapeHtml(originUrl.href)}">${originText}</a>`
    : originText;
  const branchUrl = originUrl && branchValue ? appendUrlPath(originUrl, 'tree', branchValue) : null;
  const commitUrl = originUrl && commitValue ? appendUrlPath(originUrl, 'commit', commitValue) : null;
  const branch = branchUrl
    ? `<a class="nodel-link" href="${escapeHtml(branchUrl.href)}">${branchText}</a>`
    : branchText;
  const commit = commitUrl
    ? `<a class="nodel-link" href="${escapeHtml(commitUrl.href)}">${commitText}</a>`
    : commitText;

  return `Built ${buildText(build?.date)} on ${buildText(build?.host)}<br />Origin ${origin}<br />Branch ${branch}<br />Commit ${commit}`;
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
  private lastRenderKey = '';

  connectedCallback() {
    if (!this.sourceKey) {
      NodelDiagnostics.nextSourceId += 1;
      this.sourceKey = `nodel-diagnostics-${NodelDiagnostics.nextSourceId}`;
    }

    this.bindSource();
  }

  disconnectedCallback() {
    this.source?.dispose();
    this.source = null;
  }

  private bindSource() {
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
      const renderKey = `${state.loading}|${state.error}|${state.updatedAt ?? ''}`;
      if (renderKey === this.lastRenderKey) {
        return;
      }
      this.lastRenderKey = renderKey;
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
        <div class="nodel-alert nodel-alert-md">
          Loading diagnostics...
        </div>
      `;
      return;
    }

    if (this.state.error) {
      this.innerHTML = `
        <div class="nodel-alert nodel-alert-danger nodel-alert-md" role="alert">
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
      <div class="nodel-diagnostics nodel-panel overflow-hidden">
        <div class="overflow-x-auto">
          <table class="nodel-diagnostics-table min-w-full border-collapse text-left text-sm">
            <tbody class="divide-y divide-nodel-border">
              <tr>
                <th scope="row" class="nodel-diagnostics-label">Release</th>
                <td class="nodel-diagnostics-value">${buildRelease(this.state.build)}</td>
              </tr>
              <tr>
                <th scope="row" class="nodel-diagnostics-label">Serving from</th>
                <td class="nodel-diagnostics-value">${safeText(diagnostics.hostname)}</td>
              </tr>
              <tr>
                <th scope="row" class="nodel-diagnostics-label">Advertising</th>
                <td class="nodel-diagnostics-value">${joinList(diagnostics.httpAddresses)}</td>
              </tr>
              <tr>
                <th scope="row" class="nodel-diagnostics-label">Uptime</th>
                <td class="nodel-diagnostics-value">${escapeHtml(formatDuration(diagnostics.uptime))}, start timestamp ${escapeHtml(formatDateTime(diagnostics.startTime))}</td>
              </tr>
              <tr>
                <th scope="row" class="nodel-diagnostics-label">Host path</th>
                <td class="nodel-diagnostics-value nodel-diagnostics-value-break">${safeText(diagnostics.hostPath)}</td>
              </tr>
              <tr>
                <th scope="row" class="nodel-diagnostics-label">Nodes root</th>
                <td class="nodel-diagnostics-value nodel-diagnostics-value-break">${safeText(diagnostics.nodesRoot)}</td>
              </tr>
              <tr>
                <th scope="row" class="nodel-diagnostics-label">Hosting rule</th>
                <td class="nodel-diagnostics-value nodel-diagnostics-value-break">${safeText(diagnostics.hostingRule)}</td>
              </tr>
              <tr>
                <th scope="row" class="nodel-diagnostics-label">Announcing agent</th>
                <td class="nodel-diagnostics-value nodel-diagnostics-value-break">${safeText(diagnostics.agent)}</td>
              </tr>
              <tr>
                <th scope="row" class="nodel-diagnostics-label">Build details</th>
                <td class="nodel-diagnostics-value nodel-diagnostics-value-break">${buildLinks(this.state.build)}</td>
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
