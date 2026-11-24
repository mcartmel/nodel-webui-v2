import './startup-shell';
import type { startLocalPreview } from './preview-coordinator';
import type { createLocalRenderer } from './main';
import { getPageEnrichmentLimiter } from './enrichment-limiter';

const shell = window.topologyStartupShell;
const url = new URL(window.location.href);
const localMode = shell?.isRealMode === true;
const generation = shell?.generation;
const sizeSelect = document.querySelector<HTMLSelectElement>('[data-node-count]');
const summary = document.querySelector<HTMLElement>('[data-fixture-summary]');
let preview: ReturnType<typeof startLocalPreview> | undefined;
let view: Awaited<ReturnType<typeof createLocalRenderer>> | undefined;
let frozen = false;
let disposed = false;
let failed = false;
const active = () => !disposed && !failed && generation === shell?.generation;

function syncSizeSelect() {
  if (!sizeSelect) return;
  const nodes = String(Number(url.searchParams.get('nodes')));
  sizeSelect.value = localMode ? 'local' : [...sizeSelect.options].some((option) => option.value === nodes) ? nodes : '9';
}

function selectSource() {
  if (!sizeSelect) return;
  const next = new URL(url);
  if (sizeSelect.value === 'local') {
    next.searchParams.set('source', 'local');
    next.searchParams.delete('nodes');
  } else if (sizeSelect.selectedOptions.length) {
    next.searchParams.delete('source');
    next.searchParams.set('nodes', sizeSelect.value);
  } else return;
  if (next.href !== url.href) window.location.assign(next);
}

function onPageHide(event: PageTransitionEvent) {
  if (event.persisted) {
    frozen = true;
    view?.setFrozen(true);
    preview?.freeze();
    return;
  }
  disposed = true;
  preview?.cancel();
  view?.dispose();
  shell?.setGeneration();
  sizeSelect?.removeEventListener('change', selectSource);
  window.removeEventListener('pagehide', onPageHide);
  window.removeEventListener('pageshow', onPageShow);
}

function onPageShow(event: PageTransitionEvent) {
  if (!event.persisted || !active()) return;
  syncSizeSelect();
  frozen = false;
  view?.setFrozen(false);
  preview?.resume();
}

function renderFailed() {
  if (!active()) return;
  failed = true;
  preview?.cancel();
  view?.dispose();
  shell?.setRendererError();
  const failure = document.querySelector<HTMLElement>('.canvas-failure');
  if (failure) {
    failure.classList.remove('is-visually-hidden');
    failure.textContent = localMode ? 'Local topology canvas could not be rendered.' : 'Canvas rendering is unavailable in this browser.';
    failure.hidden = false;
  }
}

syncSizeSelect();
sizeSelect?.addEventListener('change', selectSource);
window.addEventListener('pagehide', onPageHide);
window.addEventListener('pageshow', onPageShow);

if (localMode && shell) {
  const label = document.querySelector<HTMLElement>('[data-experiment-label]');
  const title = document.querySelector<HTMLElement>('.experiment-header h1');
  const coverage = document.querySelector<HTMLElement>('[data-inventory-scope]');
  if (label) label.textContent = 'Read-only local configuration';
  if (coverage) coverage.hidden = false;
  if (title) title.textContent = 'Local network topology';
  if (summary) summary.textContent = 'Loading local configuration…';
  document.title = 'Local network topology · Konva canvas experiment';

  // These independent async imports let the read-only pass run before the
  // renderer loads, and put renderer chunk/dependency failures inside a catch.
  const discovery = import('./preview-coordinator').then(({ startLocalPreview }) => {
    if (!active()) return;
    preview = startLocalPreview(shell, {
      progress(graph, batch) {
        if (!active()) return;
        if (view) view.progress(graph, batch);
        else shell.update({ discovered: graph.nodes.size, shown: 0, inspected: batch.counts.read + batch.counts.partial,
          state: shell.releaseReason ? 'waiting' : 'discovering' });
      },
      painted() { if (active() && shell.painted(generation)) view?.painted(); },
      settled(empty) {
        if (active()) shell.settled({ emptyConfirmed: empty === 'confirmed', failed: empty === 'unavailable', incomplete: empty === 'incomplete' });
      },
      failed: renderFailed
    }, { limiter: getPageEnrichmentLimiter(window) });
    if (frozen) preview.freeze();
  });
  const renderer = import('./main').then((module) => active() ? module.createLocalRenderer(shell) : undefined);
  void Promise.all([discovery, renderer]).then(([, next]) => {
    if (!active() || !next) { next?.dispose(); return; }
    view = next;
    view.setFrozen(frozen);
    preview?.attach(view.renderer);
  }).catch(renderFailed);
} else {
  void import('./main').then((module) => { if (active() && !module.mountSynthetic()) renderFailed(); }).catch(renderFailed);
}
