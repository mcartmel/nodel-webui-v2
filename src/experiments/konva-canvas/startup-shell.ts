export type StartupShellAction = 'show-now' | 'preview-release' | 'show-all-discovered' | 'arrange-by-connections';
export type PreviewReleaseReason = 'show-now' | 'deadline' | 'priority-settled' | 'local-connected';

export interface StartupShellCounts {
  discovered: number;
  shown: number;
  inspected: number;
  pending?: number;
  unsuccessful?: number;
  noRoute?: number;
  coverage?: string;
  state?: 'discovering' | 'waiting' | 'running';
}

export interface StartupShellSettlement {
  emptyConfirmed?: boolean;
  failed?: boolean;
  incomplete?: boolean;
}

export interface TopologyStartupShell {
  readonly isRealMode: boolean;
  readonly previewDeadline: number;
  readonly showNowRequested: boolean;
  readonly released: boolean;
  readonly releaseReason: PreviewReleaseReason | undefined;
  readonly generation: number;
  release(reason?: PreviewReleaseReason): void;
  painted(generation?: number): boolean;
  update(counts: StartupShellCounts): void;
  settled(result?: StartupShellSettlement): void;
  setControls(options: { showAll?: boolean; arrange?: boolean }): void;
  setRendererError(): void;
  retain(): void;
  setGeneration(): number;
  on(action: StartupShellAction, callback: () => void): () => void;
  onRelease(callback: () => void): () => void;
}

declare global {
  interface Window {
    __topologyShowNowRequested?: boolean;
    topologyStartupShell?: TopologyStartupShell;
  }
}

export function previewWaitMs(mode: string, value: unknown): number {
  if (mode === 'konva-preview-test' && (value === '0' || value === '1500' || value === '3000')) return Number(value);
  return 0;
}

export function createTopologyStartupShell(doc: Document, win: Window, navigationStartedAt = Date.now(), waitMs = 0): TopologyStartupShell {
  const root = doc.documentElement;
  const realMode = root.dataset.topologyRealMode === 'true' || new URLSearchParams(win.location.search).get('source') === 'local';
  const scrim = doc.querySelector<HTMLElement>('[data-topology-scrim]');
  const status = doc.querySelector<HTMLElement>('[data-topology-status]');
  const activity = doc.querySelector<HTMLElement>('[data-topology-activity]');
  const showNow = doc.querySelector<HTMLButtonElement>('[data-topology-show-now]');
  const showAll = doc.querySelector<HTMLButtonElement>('[data-topology-show-all]');
  const arrange = doc.querySelector<HTMLButtonElement>('[data-topology-arrange]');
  const fixtureSummary = doc.querySelector<HTMLElement>('[data-fixture-summary]');
  const shortSummary = doc.querySelector<HTMLElement>('[data-topology-short-summary]');
  const accessibleSummary = doc.querySelector<HTMLElement>('[data-topology-accessible-summary]');
  const countsText = doc.querySelector<HTMLElement>('[data-topology-counts]');
  const activityTooltip = doc.querySelector<HTMLElement>('[data-topology-activity-tooltip]');
  const progressBar = doc.querySelector<HTMLElement>('.topology-startup-bar');
  const previewDeadline = navigationStartedAt + waitMs;
  const listeners = new Map<StartupShellAction, Set<() => void>>();
  const releaseListeners = new Set<() => void>();
  let generation = 1;
  let released = false;
  let releaseReason: PreviewReleaseReason | undefined;
  let painted = false;
  let terminal = false;
  let deadlineTimer: number | undefined;
  let lastCounts: StartupShellCounts = { discovered: 0, shown: 0, inspected: 0, state: 'discovering' };
  let terminalQualifier = '';
  let showRequested = Boolean(win.__topologyShowNowRequested);

  const emit = (action: StartupShellAction) => {
    for (const callback of listeners.get(action) ?? []) callback();
  };
  const dispatch = (action: StartupShellAction) => win.dispatchEvent(new CustomEvent(`topology-${action}`));
  const updateShortSummary = () => {
    if (!shortSummary) return;
    const source = fixtureSummary?.textContent?.trim() ?? '';
    const countMatch = source.match(/^([\d,]+) discovered · ([\d,]+) shown/);
    const discovered = countMatch?.[1] ? Number(countMatch[1].replaceAll(',', '')) : lastCounts.discovered;
    const shown = countMatch?.[2] ? Number(countMatch[2].replaceAll(',', '')) : lastCounts.shown;
    const sourceQualifier = source.includes('HTTP inventory failed') ? 'Inventory unavailable'
      : source.includes('scheduler settled') ? (source.includes('coverage limited') ? 'Coverage limited' : 'Settled')
        : '';
    const qualifier = terminalQualifier || sourceQualifier;
    shortSummary.textContent = `${discovered} discovered · ${shown} shown${qualifier ? ` · ${qualifier}` : ''}`;
  };
  const updateActivity = () => {
    if (!realMode || !activity) return;
    const counts = [
      `${lastCounts.discovered} discovered`,
      `${lastCounts.shown} shown`,
      `${lastCounts.inspected} inspected`,
      lastCounts.pending === undefined ? '' : `${lastCounts.pending} pending`,
      lastCounts.unsuccessful === undefined ? '' : `${lastCounts.unsuccessful} unsuccessful`,
      lastCounts.noRoute === undefined ? '' : `${lastCounts.noRoute} without an advertised route`,
      lastCounts.coverage || ''
    ].filter(Boolean).join(' · ');
    const detailedSummary = fixtureSummary?.textContent?.trim() ?? '';
    const detail = detailedSummary ? `${counts} · ${detailedSummary}` : counts;
    activity.setAttribute('aria-label', `Discovery details. ${detail}`);
    if (activityTooltip) activityTooltip.textContent = detail;
    if (countsText) countsText.textContent = detail;
    if (accessibleSummary) accessibleSummary.textContent = detail;
  };
  const showActivityTooltip = (visible: boolean) => {
    if (!activityTooltip) return;
    activityTooltip.hidden = !visible;
    if (activity) activity.dataset.hover = String(visible);
  };
  activity?.addEventListener('focus', () => showActivityTooltip(true));
  activity?.addEventListener('blur', () => showActivityTooltip(false));
  doc.addEventListener('pointermove', (event) => {
    if (!activity || activity.hidden) return;
    const inside = (element: HTMLElement, x: number, y: number) => {
      const rect = element.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };
    showActivityTooltip(inside(activity, event.clientX, event.clientY) ||
      Boolean(activityTooltip && !activityTooltip.hidden && inside(activityTooltip, event.clientX, event.clientY)));
  });
  const summaryObserver = realMode && fixtureSummary
    ? new MutationObserver(() => { updateShortSummary(); updateActivity(); })
    : undefined;
  if (fixtureSummary && summaryObserver) summaryObserver.observe(fixtureSummary, { childList: true, characterData: true, subtree: true });

  const onShowNow = () => {
    showRequested = true;
    win.__topologyShowNowRequested = true;
    shell.release('show-now');
  };
  win.addEventListener('topology-show-now', onShowNow);
  showNow?.addEventListener('click', onShowNow);
  showAll?.addEventListener('click', () => { emit('show-all-discovered'); dispatch('show-all-discovered'); });
  arrange?.addEventListener('click', () => { emit('arrange-by-connections'); dispatch('arrange-by-connections'); });

  const hideStartup = () => {
    if (scrim) scrim.hidden = true;
    if (activity) activity.hidden = true;
    showActivityTooltip(false);
  };

  const shell: TopologyStartupShell = {
    isRealMode: realMode,
    previewDeadline,
    get showNowRequested() { return showRequested; },
    get released() { return released; },
    get releaseReason() { return releaseReason; },
    get generation() { return generation; },
    release(reason = 'local-connected') {
      if (!realMode || released) return;
      released = true;
      releaseReason = reason;
      const at = win.performance.now(); // Listeners may synchronously perform the first layout.
      if (deadlineTimer !== undefined) win.clearTimeout(deadlineTimer);
      if (showNow) showNow.hidden = true;
      if (reason === 'show-now') showRequested = true;
      if (!painted && lastCounts.discovered === 0 && !terminal) {
        if (status) status.textContent = 'Waiting for node data…';
      }
      if (painted || terminal) hideStartup();
      else if (activity) activity.hidden = false;
      if (reason === 'show-now') emit('show-now');
      emit('preview-release');
      for (const callback of releaseListeners) callback();
      win.dispatchEvent(new CustomEvent('topology-preview-release', { detail: { reason, generation, at } }));
    },
    painted(expectedGeneration = generation) {
      if (!realMode || expectedGeneration !== generation || painted) return false;
      if (!released) shell.release('local-connected');
      painted = true;
      hideStartup();
      if (!terminal && activity) activity.hidden = false;
      return true;
    },
    update(next) {
      if (!realMode) return;
      lastCounts = { ...next };
      updateActivity();
      updateShortSummary();
      if (released && !painted && next.discovered === 0 && next.state === 'waiting' && status) {
        status.textContent = 'Waiting for node data…';
      }
      if (next.discovered > 0) shell.setControls({ showAll: next.shown < next.discovered, arrange: next.shown > 0 });
    },
    settled(result = {}) {
      if (!realMode) return;
      terminal = true;
      released = true;
      if (showNow) showNow.hidden = true;
      if (lastCounts.discovered === 0) {
        if (result.failed) {
          terminalQualifier = 'Unavailable';
          if (status) status.textContent = 'Discovery unavailable';
        } else if (result.incomplete) {
          terminalQualifier = 'Coverage limited';
          if (status) status.textContent = 'No nodes found · coverage incomplete';
        } else if (result.emptyConfirmed) {
          terminalQualifier = 'No nodes found';
          if (status) status.textContent = 'No nodes found';
        } else {
          terminalQualifier = result.failed ? 'Unavailable' : 'Settled';
          if (status) status.textContent = 'No usable node data';
        }
        if (scrim) scrim.hidden = false;
      } else {
        terminalQualifier = result.failed ? 'Inventory unavailable' : result.incomplete ? 'Coverage limited' : 'Settled';
        hideStartup();
      }
      if (activity) activity.hidden = true;
      showActivityTooltip(false);
      if (progressBar) progressBar.hidden = true;
      updateShortSummary();
    },
    setControls(options) {
      if (!realMode) return;
      if (showAll) showAll.hidden = !options.showAll;
      if (arrange) arrange.hidden = !options.arrange;
    },
    setRendererError() {
      if (!realMode) return;
      terminal = true;
      released = true;
      hideStartup();
      if (status) status.textContent = 'Canvas rendering is unavailable.';
      terminalQualifier = 'Renderer unavailable';
      updateShortSummary();
    },
    retain() {
      if (!realMode) return;
      generation += 1;
      released = true;
      painted = true;
      terminal = false;
      hideStartup();
      if (showNow) showNow.hidden = true;
    },
    setGeneration() {
      generation += 1;
      return generation;
    },
    on(action, callback) {
      const callbacks = listeners.get(action) ?? new Set();
      callbacks.add(callback);
      listeners.set(action, callbacks);
      return () => callbacks.delete(callback);
    },
    onRelease(callback) {
      releaseListeners.add(callback);
      return () => releaseListeners.delete(callback);
    }
  };
  if (realMode) {
    updateActivity();
    updateShortSummary();
  }
  if (!realMode || root.dataset.topologyShellHidden === 'true') hideStartup();
  else {
    root.dataset.topologyShellVisible = 'true';
    if (showRequested) shell.release('show-now');
    else {
      const remaining = Math.max(0, previewDeadline - Date.now());
      if (remaining === 0) shell.release('deadline');
      else deadlineTimer = win.setTimeout(() => shell.release('deadline'), remaining);
    }
  }
  return shell;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const env = (import.meta as ImportMeta & { env: { MODE: string; VITE_KONVA_PREVIEW_MS?: string } }).env;
  window.topologyStartupShell ??= createTopologyStartupShell(document, window,
    Number(document.documentElement.dataset.topologyNavigationStarted) || window.performance.timeOrigin, previewWaitMs(env.MODE, env.VITE_KONVA_PREVIEW_MS));
}
