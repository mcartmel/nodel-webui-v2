import {
  applyRemoteDiscovery, applyRemoteEnrichmentResult, buildLocalGraph, graphInputFromLocalSnapshot,
  localNodeKey, prepareRemoteOwnerInspection, type LocalGraph, type LocalGraphNode
} from './local-graph';
import { assertLocalInventoryMembership, readLocalInventory, type LocalSnapshot } from './local-snapshot';
import { startRemoteEnrichment, type RemoteEnrichmentBatch } from './remote-enrichment';
import { ownerFromName } from './enrichment-transport';

export type PreviewRelease = 'show-now' | 'deadline' | 'priority-settled' | 'local-connected';

interface ReleaseLatch {
  readonly releaseReason?: PreviewRelease | undefined;
  release(reason: PreviewRelease): void;
  onRelease(callback: () => void): () => void;
}

type Batch = RemoteEnrichmentBatch<LocalGraph>;
type SchedulerOptions = Parameters<typeof startRemoteEnrichment<LocalGraph>>[0];

export interface PreviewRenderer {
  /** Use the actual initial placement/framing constraints; do not lay out speculative scenes. */
  connected(graph: LocalGraph): boolean;
  mount(graph: LocalGraph, drawn: () => void): boolean;
  patch(batch: Batch): void;
}

export interface PreviewCallbacks {
  progress(graph: LocalGraph, batch: Batch): void;
  painted(): void;
  settled(empty: 'confirmed' | 'unavailable' | 'incomplete' | false): void;
  failed(): void;
}

/** Local membership comes only from GET /REST, including promotions of already drawn advertisements. */
export function mergePreviewLocalInventory(graph: LocalGraph, snapshot: LocalSnapshot): LocalGraphNode[] {
  assertLocalInventoryMembership(snapshot);
  const changed: LocalGraphNode[] = [];
  for (const { name, readState, readFailure, localPathName } of graphInputFromLocalSnapshot(snapshot).locals) {
    const { id, key } = ownerFromName(name, localNodeKey(name));
    const incoming: LocalGraphNode = { id, key, name, origin: 'local', bindingsRead: readState,
      ...(readFailure ? { localReadFailure: readFailure } : {}), ...(localPathName ? { localPathName } : {}) };
    const node = graph.nodes.get(id);
    if (node) {
      Object.assign(node, incoming);
      delete node.lookupState;
      delete node.hostEvidence;
      changed.push(node);
    } else {
      graph.nodes.set(id, incoming);
      changed.push(incoming);
    }
  }
  graph.eligibleRemoteOwners = graph.eligibleRemoteOwners.filter(({ id }) => graph.nodes.get(id)?.origin !== 'local');
  return changed;
}

/** Keep pre-layout failure evidence identical to the live projection's status. */
function applyPreviewOwnerResult(graph: LocalGraph, result: Batch['results'][number]) {
  applyRemoteEnrichmentResult(graph, result);
  const node = graph.nodes.get(result.owner.id);
  if (!node) return;
  if (result.outcome === 'partial') { node.displayFailure = 'Bindings partially loaded'; return; }
  if (result.outcome === 'cutoff') { node.displayFailure = 'Inspection stopped at cutoff'; return; }
  if (result.outcome !== 'unsuccessful') return;
  switch (result.reason) {
    case 'lookup-interrupted':
      node.inspectionState = 'not-inspected'; node.lookupState = 'pending'; node.displayFailure = 'Not inspected'; break;
    case 'lookup-invalid-data': case 'lookup-limited':
      node.lookupState = 'invalid'; node.displayFailure = 'Invalid discovery response'; break;
    case 'lookup-timeout': case 'lookup-transport': node.lookupState = 'failed'; node.displayFailure = 'Lookup failed'; break;
    case 'no-route': node.displayFailure = 'No advertised route'; break;
    case 'prepare-failed': case 'invalid-data': node.displayFailure = 'Invalid response'; break;
    case 'transport': case 'timeout': node.displayFailure = 'Unreachable'; break;
    case 'policy-blocked':
      node.displayFailure = result.issues.includes('identity-conflict') ? 'Identity unresolved' : 'Remote route blocked';
      break;
  }
}

/** Own one accepted model across parsing, first layout, and incremental scene updates. */
export function startLocalPreview(latch: ReleaseLatch, callbacks: PreviewCallbacks,
  options: Pick<SchedulerOptions, 'limiter' | 'timing' | 'readers' | 'measure' | 'readLocalInventory'> = {}) {
  const controller = new AbortController();
  const graph = buildLocalGraph({ locals: [] });
  let renderer: PreviewRenderer | undefined;
  let mounted = false;
  let painted = false;
  let settled = false;
  let frozen = false;
  let last: Batch | undefined;

  function fail() {
    if (controller.signal.aborted) return;
    cancel();
    callbacks.failed();
  }

  function settle() {
    if (controller.signal.aborted || frozen || settled || !last?.finish || (graph.nodes.size > 0 && !painted)) return;
    settled = true;
    const { local, state } = last.inventory;
    callbacks.settled(graph.nodes.size ? false : local === 'known' && state === 'complete' ? 'confirmed'
      : local === 'unknown' && state === 'failed' ? 'unavailable' : 'incomplete');
  }

  function drawn() {
    if (controller.signal.aborted || !mounted || painted) return;
    painted = true;
    callbacks.painted();
    settle();
  }

  function present() {
    if (controller.signal.aborted || frozen || !latch.releaseReason) return;
    if (!mounted && renderer && graph.nodes.size) {
      mounted = true;
      try { if (!renderer.mount(graph, drawn)) fail(); }
      catch { fail(); }
    }
  }

  function evaluate() {
    if (latch.releaseReason || !last || frozen) return;
    if (last.preview?.prioritySettled || last.finish) latch.release('priority-settled');
    else if (last.inventory.state === 'pending' && last.preview?.localPrioritySettled && renderer?.connected(graph)) {
      latch.release('local-connected');
    }
  }

  const unsubscribe = latch.onRelease(present);

  const run = startRemoteEnrichment({
    owners: [], readLocalInventory, ...options, signal: controller.signal,
    prepare: (owner, bindings, follow) => prepareRemoteOwnerInspection(owner, bindings, follow ? graph.nodes : undefined),
    apply(batch) {
      if (controller.signal.aborted) return;
      try {
        last = {
          discoveries: [], results: [], inventory: batch.inventory, counts: batch.counts, paused: batch.paused,
          ...(batch.preview ? { preview: batch.preview } : {}), ...(batch.finish ? { finish: batch.finish } : {})
        };
        if (mounted) renderer!.patch(batch);
        else {
          if (batch.localSnapshot) mergePreviewLocalInventory(graph, batch.localSnapshot);
          for (const discovery of batch.discoveries) applyRemoteDiscovery(graph, discovery);
          for (const result of batch.results) applyPreviewOwnerResult(graph, result);
        }
        evaluate();
        present();
        if (!controller.signal.aborted) callbacks.progress(graph, batch);
        settle();
      } catch { fail(); }
    }
  });

  function cancel() {
    if (controller.signal.aborted) return;
    controller.abort();
    unsubscribe();
  }

  return {
    signal: controller.signal,
    get mounted() { return mounted; },
    attach(view: PreviewRenderer) {
      if (controller.signal.aborted || renderer) return;
      renderer = view;
      evaluate();
      present();
      if (last && !controller.signal.aborted) callbacks.progress(graph, last);
      settle();
    },
    freeze() { frozen = true; run.freeze(); },
    resume() {
      if (controller.signal.aborted) return;
      frozen = false;
      run.resume();
      evaluate();
      present();
      settle();
    },
    cancel,
    fail,
    idle: run.idle
  };
}
