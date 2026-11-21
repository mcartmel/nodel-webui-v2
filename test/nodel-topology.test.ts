import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ controllers: [] as Array<{ onUpdate: (update: unknown) => void }>, canvases: [] as Array<{
  callbacks: Record<string, (...args: unknown[]) => void>;
  positions: ReadonlyMap<string, { x: number; y: number }> | null;
  resetViewportCalls: number;
  fitCalls: number;
  connectedFrames: string[];
  nodeFrames: string[][];
  selectedNode: string | null;
  selectedWires: string[];
  disposeCalls: number;
  updateCalls: number;
  viewport: { x: number; y: number; scale: number };
  setViewport: (viewport: { x: number; y: number; scale: number }, options?: { notify?: boolean }) => void;
  setViewportCalls: number;
  selectedPort: { nodeId: string; portId: string } | null;
  centeredPort: { nodeId: string; portId: string } | null;
  projection: { nodes: readonly { id: string; ports: readonly { id: string; label: string }[] }[]; wires: readonly { id: string; label?: string }[] } | null;
}> }));

vi.mock('../src/features/topology/topology-controller', () => ({
  TopologyController: class {
    start = vi.fn();
    stop = vi.fn();
    refresh = vi.fn();
    dispose = vi.fn();
    constructor(readonly onUpdate: (update: unknown) => void) { harness.controllers.push(this); }
  }
}));

vi.mock('../src/features/topology/topology-canvas', () => ({
  TopologyCanvas: class {
    callbacks: Record<string, (...args: unknown[]) => void>;
    positions: ReadonlyMap<string, { x: number; y: number }> | null = null;
    resetViewportCalls = 0;
    fitCalls = 0;
    connectedFrames: string[] = [];
    nodeFrames: string[][] = [];
    selectedNode: string | null = null;
    selectedWires: string[] = [];
    disposeCalls = 0;
    updateCalls = 0;
    viewport = { x: 0, y: 0, scale: 1 };
    setViewportCalls = 0;
    selectedPort: { nodeId: string; portId: string } | null = null;
    centeredPort: { nodeId: string; portId: string } | null = null;
    projection: { nodes: readonly { id: string; ports: readonly { id: string; label: string }[] }[]; wires: readonly { id: string; label?: string }[] } | null = null;
    constructor(_container: HTMLElement, callbacks: Record<string, (...args: unknown[]) => void>) {
      this.callbacks = callbacks;
      harness.canvases.push(this);
    }
    update(projection: typeof this.projection) { this.updateCalls += 1; this.projection = projection; }
    setNodePositions(positions: ReadonlyMap<string, { x: number; y: number }>) { this.positions = new Map(positions); }
    getViewport() { return { ...this.viewport }; }
    setViewport(viewport: { x: number; y: number; scale: number }, options: { notify?: boolean } = {}) {
      this.viewport = { ...viewport }; this.setViewportCalls += 1;
      if (options.notify !== false) this.callbacks.onViewportChanged?.(this.viewport);
    }
    resetViewport() { this.resetViewportCalls += 1; }
    fitToView() { this.fitCalls += 1; }
    frameNodes(ids: Iterable<string>) { this.nodeFrames.push([...ids]); }
    frameConnectedGroup(id: string) { this.connectedFrames.push(id); }
    selectNode(id: string | null) { this.selectedNode = id; }
    selectWire(id: string | null) { if (id) this.selectedWires.push(id); }
    selectPort(nodeId: string | null, portId?: string | null) { this.selectedPort = nodeId && portId ? { nodeId, portId } : null; }
    centerOnPort(nodeId: string, portId: string) { this.centeredPort = { nodeId, portId }; }
    dispose() { this.disposeCalls += 1; }
  }
}));

vi.mock('../src/data/visibility-scope', () => ({
  observeNodelVisibility: (_element: HTMLElement, callback: (visible: boolean) => void) => {
    callback(true);
    return vi.fn();
  }
}));

import '../src/components/nodel-topology';
import type { TopologyCanvasNode } from '../src/features/topology/topology-canvas';
import type { TopologyGraph, TopologyNode } from '../src/features/topology/topology-model';
import { topologyLayoutStorageKey } from '../src/features/topology/topology-layout';

function createGraph(): TopologyGraph {
  const makeNode = (id: string, name: string): TopologyNode => ({
    id: id as TopologyNode['id'], name,
    addresses: [
      { canonicalAddress: 'https://safe.example', displayAddress: 'safe.example', adminHref: 'https://safe.example/admin', source: 'test' },
      { canonicalAddress: 'javascript:alert(1)', displayAddress: 'unsafe address', adminHref: 'javascript:alert(1)', source: 'test' }
    ],
    discovery: 'advertised',
    actionInventory: { status: 'success', source: 'test', value: ['start'] },
    eventInventory: { status: 'success', source: 'test', value: [] },
    schemaEvidence: { status: 'absent', source: 'test' },
    assignmentEvidence: { status: 'absent', source: 'test' }
  });
  return {
    nodes: [makeNode('node:a', '<img src=x onerror=alert(1)>'), makeNode('node:b', 'Beta')],
    endpoints: [], bindings: [],
    discoveryEvidence: { status: 'success', source: 'test', value: ['Alpha', 'Beta'] },
    completeness: { discovery: 'complete', schema: 'complete', assignments: 'complete' }
  };
}

function update(graph: TopologyGraph) {
  return {
    graph, hostContext: 'https://host.example', phase: 'idle', coverage: 'complete', progress: { completed: 2, total: 2 },
    diagnostics: [], diagnosticsOmitted: 0, stale: false, nodeStatuses: new Map()
  };
}

function openNavigator(component: HTMLElement) {
  void component;
}

function openInspector(component: HTMLElement) {
  if (component.querySelector<HTMLElement>('[data-topology-inspector]')?.hidden) component.querySelector<HTMLButtonElement>('[data-topology-inspector-toggle]')?.click();
}

function searchAndSelect(component: HTMLElement, query: string, index = 0) {
  const input = component.querySelector<HTMLInputElement>('[data-topology-filter]');
  if (!input) throw new Error('Topology search field must exist');
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  component.querySelectorAll<HTMLButtonElement>('[data-topology-search-index]')[index]?.click();
}

const projectedCard = (id: string, height: number): TopologyCanvasNode => ({ id, height, title: id, status: '', summary: '', ports: [], position: { x: 0, y: 0 } });

describe('nodel-topology integrated controls', () => {
  let component: HTMLElement;

  beforeEach(() => {
    harness.controllers.length = 0;
    harness.canvases.length = 0;
    localStorage.clear();
    vi.useFakeTimers();
    component = document.createElement('nodel-topology');
    document.body.append(component);
    harness.controllers[0]?.onUpdate(update(createGraph()));
    const view = component.querySelector<HTMLSelectElement>('[data-topology-mode]');
    if (view) { view.value = 'all-nodes'; view.dispatchEvent(new Event('change', { bubbles: true })); }
  });

  afterEach(() => {
    component.remove();
    localStorage.clear();
    vi.useRealTimers();
  });

  it('uses the relationship canvas by default and lets the complete inventory place and remove isolated nodes', () => {
    const state = component as HTMLElement & { displayMode: string; workspace: { mode: string; pinnedNodeIds: Set<string>; omittedNodeIds: Set<string> } };
    state.displayMode = 'detailed';
    state.workspace = { mode: 'custom', pinnedNodeIds: new Set(), omittedNodeIds: new Set() };
    harness.controllers[0]?.onUpdate(update(createGraph()));
    const canvas = harness.canvases[0];
    expect(canvas?.projection?.nodes).toHaveLength(0);
    const palette = component.querySelector('[data-topology-palette-entries]');
    expect(palette?.textContent).toContain('host unknown');
    expect(palette?.textContent).toContain('Beta');
    const place = [...(palette?.querySelectorAll<HTMLButtonElement>('[data-topology-palette-action]') ?? [])]
      .find(button => button.dataset.topologyPaletteId === 'node:b');
    place?.click();
    expect(canvas?.projection?.nodes.map(node => node.id)).toContain('node:b');
    searchAndSelect(component, 'Beta'); // A scoped reveal must not defeat explicit removal.
    const remove = [...(component.querySelectorAll<HTMLButtonElement>('[data-topology-palette-remove]'))]
      .find(button => button.dataset.topologyPaletteId === 'node:b');
    remove?.click();
    expect(canvas?.projection?.nodes.map(node => node.id)).not.toContain('node:b');
    const mode = component.querySelector<HTMLSelectElement>('[data-topology-mode]');
    if (mode) { mode.value = 'all-nodes'; mode.dispatchEvent(new Event('change', { bubbles: true })); }
    expect(canvas?.projection?.nodes.map(node => node.id)).not.toContain('node:b');
    if (mode) { mode.value = 'detailed'; mode.dispatchEvent(new Event('change', { bubbles: true })); }
    expect(canvas?.projection?.nodes.map(node => node.id)).not.toContain('node:b');
    const placeAgain = [...(component.querySelectorAll<HTMLButtonElement>('[data-topology-palette-action]'))]
      .find(button => button.dataset.topologyPaletteId === 'node:b');
    placeAgain?.click();
    expect(canvas?.projection?.nodes.map(node => node.id)).toContain('node:b');
  });

  it('preserves hidden manually positioned nodes through Auto Layout', () => {
    const state = component as HTMLElement & {
      positions: Map<string, { x: number; y: number }>;
      autoPositionIds: Set<string>;
      workspace: { mode: 'custom'; pinnedNodeIds: Set<TopologyNode['id']>; omittedNodeIds: Set<TopologyNode['id']> };
      displayMode: string;
      autoLayout(): void;
    };
    state.displayMode = 'detailed';
    state.workspace = { mode: 'custom', pinnedNodeIds: new Set(['node:a'] as TopologyNode['id'][]), omittedNodeIds: new Set() };
    state.positions = new Map([['node:a', { x: 100, y: 120 }], ['node:b', { x: 900, y: 700 }]]);
    state.autoPositionIds = new Set();
    harness.controllers[0]?.onUpdate(update(createGraph()));
    const hiddenManual = state.positions.get('node:b');
    state.autoLayout();
    expect(state.positions.get('node:b')).toEqual(hiddenManual);
    expect(state.positions.has('node:a')).toBe(true);
  });

  it('starts with no saved layout and shows both terminals of a configured relationship', () => {
    const fresh = document.createElement('nodel-topology');
    document.body.append(fresh);
    const graph = createGraph();
    const [owner, target] = graph.nodes;
    if (!owner || !target) throw new Error('Fixture requires two nodes');
    const sourceId = 'endpoint:default-source' as TopologyGraph['endpoints'][number]['id'];
    const targetId = 'endpoint:default-target' as TopologyGraph['endpoints'][number]['id'];
    graph.endpoints = [
      { id: sourceId, nodeId: owner.id, kind: 'local-action', name: 'start', evidence: 'declared' },
      { id: targetId, nodeId: target.id, kind: 'remote-action', name: 'start', evidence: 'declared' }
    ];
    graph.bindings = [{ id: 'binding:default-configured' as TopologyGraph['bindings'][number]['id'], ownerId: owner.id, kind: 'actions', alias: 'peer',
      declared: 'yes', assignment: 'complete', assignmentRow: 'present', configuredNode: target.name, configuredEndpoint: 'start',
      targetNodeId: target.id, sourceEndpointId: sourceId, targetEndpointId: targetId, direction: 'source-to-target', referenceResolution: 'resolved' }];
    harness.controllers.at(-1)?.onUpdate(update(graph));
    const canvas = harness.canvases.at(-1);
    expect(fresh.querySelector<HTMLSelectElement>('[data-topology-mode]')?.value).toBe('detailed');
    expect(canvas?.projection?.nodes.map(({ id }) => id)).toEqual(expect.arrayContaining([owner.id, target.id]));
    expect(canvas?.projection?.wires).toHaveLength(1);
    fresh.remove();
  });

  it('keeps focus layout temporary and restores the prior selection, coordinates, and viewport', () => {
    const fresh = document.createElement('nodel-topology');
    document.body.append(fresh);
    const graph = createGraph();
    const [owner, target] = graph.nodes;
    if (!owner || !target) throw new Error('Fixture requires two nodes');
    const sourceId = 'endpoint:focus-source' as TopologyGraph['endpoints'][number]['id'];
    const targetId = 'endpoint:focus-target' as TopologyGraph['endpoints'][number]['id'];
    graph.endpoints = [
      { id: sourceId, nodeId: owner.id, kind: 'local-action', name: 'start', evidence: 'declared' },
      { id: targetId, nodeId: target.id, kind: 'remote-action', name: 'start', evidence: 'declared' }
    ];
    const bindingId = 'binding:focus' as TopologyGraph['bindings'][number]['id'];
    graph.bindings = [{ id: bindingId, ownerId: owner.id, kind: 'actions', alias: 'peer', declared: 'yes', assignment: 'complete', assignmentRow: 'present',
      configuredNode: target.name, configuredEndpoint: 'start', targetNodeId: target.id, sourceEndpointId: sourceId, targetEndpointId: targetId,
      direction: 'source-to-target', referenceResolution: 'resolved' }];
    harness.controllers.at(-1)?.onUpdate(update(graph));
    const state = fresh as HTMLElement & {
      positions: Map<TopologyGraph['nodes'][number]['id'], { x: number; y: number }>;
      autoPositionIds: Set<string>;
      workspace: { pinnedNodeIds: Set<string> };
      selection: { type: 'node' | 'binding'; id: string } | null;
      focusPositions?: Map<TopologyGraph['nodes'][number]['id'], { x: number; y: number }>;
      focusRestoreState?: { selectedNodeId: string; previousSelectionType?: string; previousSelectionId?: string };
      flushLayout(): void;
    };
    const canvas = harness.canvases.at(-1);
    canvas?.callbacks.onNodeMoved?.(owner.id, { x: 990, y: 770 });
    const before = new Map(state.positions);
    canvas?.setViewport({ x: 14, y: 28, scale: 1.1 }, { notify: false });
    state.selection = { type: 'binding', id: bindingId };
    const mode = fresh.querySelector<HTMLSelectElement>('[data-topology-mode]');
    if (!mode) throw new Error('View mode control should exist');
    mode.value = 'focus'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state.focusRestoreState).toMatchObject({ selectedNodeId: owner.id, previousSelectionType: 'binding', previousSelectionId: bindingId });
    expect(state.positions).toEqual(before);
    expect(state.focusPositions).toBeDefined();
    expect(canvas?.positions?.get(owner.id)).toEqual(state.focusPositions?.get(owner.id));
    expect(canvas?.positions?.get(owner.id)).not.toEqual(before.get(owner.id));
    const temporaryPosition = { x: 222, y: 333 };
    canvas?.callbacks.onNodeMoved?.(target.id, temporaryPosition);
    harness.controllers.at(-1)?.onUpdate(update(graph));
    expect(canvas?.positions?.get(target.id)).toEqual(temporaryPosition);
    expect(state.positions).toEqual(before);
    expect(state.autoPositionIds.has(target.id)).toBe(true);
    expect(state.workspace.pinnedNodeIds.has(target.id)).toBe(false);
    state.flushLayout();
    const saved = JSON.parse(localStorage.getItem(topologyLayoutStorageKey('https://host.example')) ?? '{}');
    expect(saved).toMatchObject({ selectedNodeId: owner.id, selectedSelection: { type: 'node', id: owner.id }, focusRestoreState: { selectedNodeId: owner.id, previousSelectionId: bindingId } });
    const restored = document.createElement('nodel-topology');
    document.body.append(restored);
    const restoredState = restored as HTMLElement & { displayMode: string; selection: { type: string; id: string } | null; positions: Map<string, { x: number; y: number }> };
    const empty: TopologyGraph = { ...graph, nodes: [], bindings: [], endpoints: [],
      discoveryEvidence: { status: 'absent', source: 'inventory' }, completeness: { discovery: 'unknown', schema: 'unknown', assignments: 'unknown' } };
    harness.controllers.at(-1)?.onUpdate({ ...update(empty), phase: 'loading', coverage: 'unknown' });
    expect(restoredState.selection).toEqual({ type: 'node', id: owner.id });
    harness.controllers.at(-1)?.onUpdate({ ...update(empty), phase: 'idle', coverage: 'failed' });
    expect(restoredState.selection).toEqual({ type: 'node', id: owner.id });
    harness.controllers.at(-1)?.onUpdate(update(graph));
    const restoredCanvas = harness.canvases.at(-1);
    expect(restored.querySelector<HTMLSelectElement>('[data-topology-mode]')?.value).toBe('focus');
    expect(restoredState.selection).toEqual({ type: 'node', id: owner.id });
    expect(restoredCanvas?.projection?.nodes.map(({ id }) => id)).toEqual([owner.id, target.id]);
    const restoredBefore = new Map(restoredState.positions);
    const restoredMode = restored.querySelector<HTMLSelectElement>('[data-topology-mode]');
    if (!restoredMode) throw new Error('Restored view mode control should exist');
    restoredMode.value = 'overview'; restoredMode.dispatchEvent(new Event('change', { bubbles: true }));
    expect(restoredState.selection).toEqual({ type: 'binding', id: bindingId });
    expect(restoredState.positions).toEqual(restoredBefore);
    expect(restoredCanvas?.viewport).toEqual({ x: 14, y: 28, scale: 1.1 });
    expect(restoredCanvas?.positions).toEqual(restoredBefore);
    restored.remove();
    canvas?.setViewport({ x: 900, y: 700, scale: 1.6 });
    mode.value = 'overview'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state.selection).toEqual({ type: 'binding', id: bindingId });
    expect(state.positions).toEqual(before);
    expect(canvas?.positions).toEqual(before);
    expect(canvas?.viewport).toEqual({ x: 14, y: 28, scale: 1.1 });
    fresh.remove();
  });

  it('keeps overview bundles highlighted and requires an individual binding for inspection', () => {
    const fresh = document.createElement('nodel-topology');
    document.body.append(fresh);
    const graph = createGraph();
    const [owner, target] = graph.nodes;
    if (!owner || !target) throw new Error('Fixture requires two nodes');
    const sourceId = 'endpoint:bundle-source' as TopologyGraph['endpoints'][number]['id'];
    const targetId = 'endpoint:bundle-target' as TopologyGraph['endpoints'][number]['id'];
    graph.endpoints = [
      { id: sourceId, nodeId: owner.id, kind: 'local-action', name: 'start', evidence: 'declared' },
      { id: targetId, nodeId: target.id, kind: 'remote-action', name: 'start', evidence: 'declared' }
    ];
    const binding = (id: string, alias: string) => ({ id: id as TopologyGraph['bindings'][number]['id'], ownerId: owner.id,
      kind: 'actions' as const, alias, declared: 'yes' as const, assignment: 'complete' as const, assignmentRow: 'present' as const,
      configuredNode: target.name, configuredEndpoint: 'start', targetNodeId: target.id, sourceEndpointId: sourceId, targetEndpointId: targetId,
      direction: 'source-to-target' as const, referenceResolution: 'resolved' as const });
    const isolated = { ...target, id: 'node:isolate' as TopologyNode['id'], name: 'Isolated' };
    graph.nodes.push(isolated);
    const isolatedEndpointId = 'endpoint:inspect' as TopologyGraph['endpoints'][number]['id'];
    graph.endpoints.push({ id: isolatedEndpointId, nodeId: isolated.id, kind: 'local-action', name: 'unique-endpoint', evidence: 'declared' });
    graph.bindings = [binding('binding:one', 'first'), binding('binding:two', 'second')];
    harness.controllers.at(-1)?.onUpdate(update(graph));
    const mode = fresh.querySelector<HTMLSelectElement>('[data-topology-mode]');
    if (!mode) throw new Error('View mode control should exist');
    mode.value = 'overview'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    const canvas = harness.canvases.at(-1);
    const bundle = canvas?.projection?.wires[0];
    if (!bundle || !bundle.id.startsWith('overview:')) throw new Error('Parallel bindings should form a visual bundle');
    canvas?.callbacks.onWireSelected?.(bundle.id);
    expect(canvas?.selectedWires).toContain(bundle.id);
    expect(fresh.querySelector('[data-topology-inspector-content]')?.textContent).toContain('2 configured bindings share this relationship');
    expect((fresh as HTMLElement & { selection: null }).selection).toBeNull();
    const member = fresh.querySelector<HTMLButtonElement>('[data-topology-select-type="binding"][data-topology-select-id="binding:one"]');
    member?.click();
    expect((fresh as HTMLElement & { selection: { type: string; id: string } | null }).selection).toEqual({ type: 'binding', id: 'binding:one' });
    expect(canvas?.selectedWires.at(-1)).toBe(bundle.id);
    for (const [query, expected] of [
      ['Isolated', { type: 'node', id: isolated.id }],
      ['unique-endpoint', { type: 'node', id: isolated.id }],
      ['second', { type: 'binding', id: 'binding:two' }]
    ] as const) {
      canvas?.callbacks.onWireSelected?.(bundle.id);
      expect(fresh.querySelector('[data-topology-inspector-content]')?.textContent).toContain('Overview relationship bundle');
      searchAndSelect(fresh, query);
      expect((fresh as HTMLElement & { selection: unknown; aggregateWireId: string | null }).selection).toEqual(expected);
      expect((fresh as HTMLElement & { aggregateWireId: string | null }).aggregateWireId).toBeNull();
      expect(fresh.querySelector('[data-topology-inspector-content]')?.textContent).not.toContain('Overview relationship bundle');
    }
    fresh.remove();
  });

  it('integrates the no-layout default with configured terminals and keeps them when Connections is hidden', () => {
    const fresh = document.createElement('nodel-topology');
    document.body.append(fresh);
    const graph = createGraph();
    const nodeA = graph.nodes[0]!; const nodeB = graph.nodes[1]!;
    const sourceId = 'endpoint:source' as TopologyGraph['endpoints'][number]['id'];
    const targetId = 'endpoint:target' as TopologyGraph['endpoints'][number]['id'];
    graph.endpoints = [
      { id: sourceId, nodeId: nodeA.id, kind: 'local-action', name: 'start', evidence: 'declared' },
      { id: targetId, nodeId: nodeB.id, kind: 'remote-action', name: 'start', evidence: 'declared' }
    ];
    graph.bindings = [{ id: 'binding:configured' as TopologyGraph['bindings'][number]['id'], ownerId: nodeA.id, kind: 'actions', alias: 'peer',
      declared: 'yes', assignment: 'complete', assignmentRow: 'present', configuredNode: nodeB.name, configuredEndpoint: 'start',
      targetNodeId: nodeB.id, sourceEndpointId: sourceId, targetEndpointId: targetId, direction: 'source-to-target', referenceResolution: 'resolved' }];
    harness.controllers.at(-1)?.onUpdate(update(graph));
    const canvas = harness.canvases.at(-1);
    expect(fresh.querySelector<HTMLSelectElement>('[data-topology-mode]')?.value).toBe('detailed');
    expect(canvas?.projection?.nodes.map(node => node.id)).toEqual(expect.arrayContaining([nodeA.id, nodeB.id]));
    expect(canvas?.projection?.wires).toHaveLength(1);
    const connections = fresh.querySelector<HTMLInputElement>('[data-topology-display="connections"]');
    if (!connections) throw new Error('Connections toggle should exist');
    connections.checked = false; connections.dispatchEvent(new Event('change', { bubbles: true }));
    expect(canvas?.projection?.nodes.map(node => node.id)).toEqual(expect.arrayContaining([nodeA.id, nodeB.id]));
    expect(canvas?.projection?.wires).toHaveLength(0);
    expect(fresh.querySelector('[data-topology-palette-entries]')?.textContent).toContain('Beta');
    fresh.remove();
  });

  it('starts canvas-first with collapsed inventories and no unselected inspector', () => {
    const canvas = component.querySelector<HTMLElement>('[data-topology-canvas]');
    expect(canvas?.classList.contains('nodel-topology-graph')).toBe(true);
    expect(component.querySelector('[data-topology-search-results]')?.hasAttribute('hidden')).toBe(true);
    expect(component.querySelector('[data-topology-nodes]')).toBeNull();
    expect(component.querySelector('[data-topology-bindings]')).toBeNull();
    expect(component.querySelector<HTMLElement>('[data-topology-inspector]')?.hidden).toBe(true);
    expect(component.querySelector('[data-topology-sidebar]')).not.toBeNull();
    expect(component.querySelector('.nodel-topology-workspace')).not.toBeNull();
    expect(component.querySelector('[data-topology-status]')?.textContent).toContain('2 nodes discovered · 0 bindings');
    expect(component.querySelector<HTMLDetailsElement>('nodel-collapse details')?.open).toBe(false);
    expect(component.querySelector('nodel-collapse')?.getAttribute('preview')).toBe('No diagnostics');
  });

  it('keeps unknown counts distinct from zero and puts diagnostic text behind its disclosure', () => {
    const graph = createGraph();
    graph.completeness = { discovery: 'unknown', schema: 'unknown', assignments: 'unknown' };
    const partial = { ...update(graph), coverage: 'partial' as const, diagnostics: [{ source: 'events', message: 'A long diagnostic detail.' }], diagnosticsOmitted: 3 };
    harness.controllers[0]?.onUpdate(partial);
    const announcement = component.querySelector('[data-topology-status] [role="status"]');
    expect(announcement?.textContent).toContain('Partial');
    expect(announcement?.textContent).toContain('2 nodes discovered · bindings unknown');
    const diagnostics = component.querySelector<HTMLDetailsElement>('nodel-collapse details');
    expect(diagnostics?.open).toBe(false);
    expect(diagnostics?.textContent).toContain('A long diagnostic detail.');
    expect(diagnostics?.textContent).toContain('3 additional diagnostics omitted.');
    if (!diagnostics) throw new Error('Diagnostics disclosure must be present');
    diagnostics.open = true;
    const summary = diagnostics.querySelector('summary');
    summary?.focus();
    harness.controllers[0]?.onUpdate({ ...partial, diagnostics: [{ source: 'events', message: 'Updated diagnostic.' }] });
    expect(diagnostics.open).toBe(true);
    expect(diagnostics.querySelector('summary')).toBe(summary);
    expect(document.activeElement).toBe(summary);
    expect(diagnostics.textContent).toContain('Updated diagnostic.');
  });

  it('counts advertised nodes separately from unresolved references with correct plurals', () => {
    const graph = createGraph();
    const placeholder: TopologyNode = { ...graph.nodes[0]!, id: 'node:missing' as TopologyNode['id'], name: 'Missing', discovery: 'placeholder', addresses: [] };
    graph.nodes = [graph.nodes[0]!, placeholder];
    graph.completeness = { discovery: 'partial', schema: 'complete', assignments: 'complete' };
    harness.controllers[0]?.onUpdate({ ...update(graph), coverage: 'partial' });
    expect(component.querySelector('[data-topology-status-message]')?.textContent).toContain('1 node discovered · 1 unresolved reference · bindings unknown');
  });

  it('shows referenced placeholders by default and retains explicit placeholder and candidate controls', () => {
    const graph = createGraph();
    graph.nodes = [
      ...graph.nodes,
      ...['missing-a', 'missing-b'].map((id) => ({ ...graph.nodes[0]!, id: `node:${id}` as TopologyNode['id'], name: id, discovery: 'placeholder' as const })),
      { ...graph.nodes[0]!, id: 'node:candidate' as TopologyNode['id'], name: 'Twin' }
    ];
    harness.controllers[0]?.onUpdate(update(graph));
    const canvas = harness.canvases[0];
    expect(canvas?.projection?.nodes.map(({ id }) => id)).toContain('node:missing-a');
    expect(canvas?.projection?.nodes.map(({ id }) => id)).toContain('node:missing-b');
    expect(canvas?.projection?.nodes.map(({ id }) => id)).toContain('node:candidate');
    const candidates = component.querySelector<HTMLInputElement>('[data-topology-display="candidates"]');
    if (!candidates) throw new Error('Ambiguous reference toggle should exist');
    candidates.checked = false; candidates.dispatchEvent(new Event('change', { bubbles: true }));
    expect(canvas?.projection?.nodes.map(({ id }) => id)).toContain('node:candidate');
    const placeholders = component.querySelector<HTMLInputElement>('[data-topology-display="placeholders"]');
    if (!placeholders) throw new Error('Placeholder toggle should exist');
    placeholders.checked = false; placeholders.dispatchEvent(new Event('change', { bubbles: true }));
    expect(canvas?.projection?.nodes.map(({ id }) => id)).not.toContain('node:missing-a');
    placeholders.checked = true; placeholders.dispatchEvent(new Event('change', { bubbles: true }));
    expect(canvas?.projection?.nodes.map(({ id }) => id)).toContain('node:missing-a');
    expect(canvas?.projection?.nodes.map(({ id }) => id)).toContain('node:missing-b');
    candidates.checked = true; candidates.dispatchEvent(new Event('change', { bubbles: true }));
    expect(canvas?.projection?.nodes.map(({ id }) => id)).toContain('node:candidate');
  });

  it('search selects a node endpoint without changing the legacy ambiguous-reference control', () => {
    const ambiguous = component.querySelector<HTMLInputElement>('[data-topology-display="candidates"]');
    if (!ambiguous) throw new Error('Ambiguous reference toggle should exist');
    ambiguous.checked = false; ambiguous.dispatchEvent(new Event('change', { bubbles: true }));
    const graph = createGraph();
    const candidateId = 'node:candidate-result' as TopologyNode['id'];
    const endpointId = 'endpoint:candidate-result' as TopologyGraph['endpoints'][number]['id'];
    graph.nodes.push({ ...graph.nodes[0]!, id: candidateId, name: 'Hidden Twin' });
    graph.endpoints.push({ id: endpointId, nodeId: candidateId, kind: 'local-action', name: 'special-endpoint', evidence: 'declared' });
    harness.controllers[0]?.onUpdate(update(graph));
    searchAndSelect(component, 'special-endpoint');
    const canvas = harness.canvases[0];
    expect(canvas?.projection?.nodes.map(({ id }) => id)).toContain(candidateId);
    expect(canvas?.projection?.nodes.find(({ id }) => id === candidateId)?.ports.map(({ id }) => id)).toContain(endpointId);
    expect(component.hasAttribute('show-candidates')).toBe(false);
    expect(component.hasAttribute('show-placeholders')).toBe(false);

    searchAndSelect(component, '<img');
    expect(canvas?.projection?.nodes.map(({ id }) => id)).toContain(candidateId);
    expect(component.hasAttribute('show-candidates')).toBe(false);
    expect(component.hasAttribute('show-placeholders')).toBe(false);
  });

  it('keeps large-scan progress immediate while coalescing expensive graph paints', async () => {
    const canvas = harness.canvases[0];
    if (!canvas) throw new Error('Canvas should be ready');
    const graph = createGraph();
    graph.nodes = Array.from({ length: 60 }, (_, index) => ({
      ...graph.nodes[index % 2]!, id: `node:scale-${index}` as TopologyNode['id'], name: `Scale ${index}`,
      addresses: graph.nodes[index % 2]!.addresses.map((address) => ({ ...address }))
    }));
    graph.discoveryEvidence = { status: 'success', source: 'test', value: graph.nodes.map(({ name }) => name) };
    graph.completeness.discovery = 'partial';
    const before = canvas.updateCalls;
    harness.controllers[0]?.onUpdate({ ...update(graph), phase: 'loading', coverage: 'partial', progress: { completed: 10, total: 100 } });
    expect(canvas.updateCalls).toBe(before);
    expect(component.querySelector('[data-topology-status-message]')?.textContent).toContain('10/100 checks');
    await vi.advanceTimersByTimeAsync(120);
    expect(canvas.updateCalls).toBeGreaterThan(before);
    expect(canvas.projection?.nodes).toHaveLength(60);
    const painted = canvas.updateCalls;
    harness.controllers[0]?.onUpdate({ ...update(graph), phase: 'loading', coverage: 'partial', progress: { completed: 11, total: 100 } });
    expect(canvas.updateCalls).toBe(painted);
    expect(component.querySelector('[data-topology-status-message]')?.textContent).toContain('11/100 checks');
    await vi.advanceTimersByTimeAsync(120);
    expect(canvas.updateCalls).toBeGreaterThan(painted);
  });

  it('selects nodes from accessible rows and renders safe text and validated admin links', () => {
    openNavigator(component);
    searchAndSelect(component, '<img');
    const nodeButton = component.querySelector<HTMLButtonElement>('[data-topology-search-index]');
    expect(nodeButton).toBeDefined();
    const inspector = component.querySelector<HTMLElement>('[data-topology-inspector]');
    expect(inspector?.hidden).toBe(false);
    expect(component.querySelector('[data-topology-inspector-toggle]')?.getAttribute('aria-expanded')).toBe('true');
    openInspector(component);
    expect(inspector?.hidden).toBe(false);
    expect(inspector?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(component.querySelector('img,script')).toBeNull();
    const links = [...component.querySelectorAll<HTMLAnchorElement>('a')];
    expect(links.some((link) => link.href === 'https://safe.example/admin')).toBe(true);
    expect(links.some((link) => link.href.startsWith('javascript:'))).toBe(false);
    expect(inspector?.querySelector('h3')?.classList.contains('break-all')).toBe(true);
    inspector?.querySelector<HTMLButtonElement>('[data-topology-action="close-inspector"]')?.click();
    expect(inspector?.hidden).toBe(true);
    expect(component.querySelector('[data-topology-inspector-toggle]')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('resets existing cells and retains their new positions on routine refresh', async () => {
    const canvas = harness.canvases[0];
    expect(canvas).toBeDefined();
    searchAndSelect(component, '<img');
    expect(canvas?.selectedNode).toBe('node:a');
    canvas?.callbacks.onNodeMoved?.('node:a', { x: 990, y: 770 });
    expect((component as HTMLElement & { positions: Map<string, { x: number; y: number }> }).positions.get('node:a')).toEqual({ x: 990, y: 770 });
    harness.controllers[0]?.onUpdate(update(createGraph()));
    expect((component as HTMLElement & { positions: Map<string, { x: number; y: number }> }).positions.get('node:a')).toEqual({ x: 990, y: 770 });
    (component as HTMLElement & { positions: Map<string, { x: number; y: number }> }).positions.set('node:churn', { x: 1200, y: 1800 });
    harness.controllers[0]?.onUpdate(update(createGraph()));
    expect((component as HTMLElement & { positions: Map<string, { x: number; y: number }> }).positions.has('node:churn')).toBe(false);
    component.querySelector<HTMLButtonElement>('[data-topology-action="reset"]')?.click();
    expect(canvas?.selectedNode).toBeNull();
    expect((component as HTMLElement & { positions: Map<string, { x: number; y: number }> }).positions).toEqual(new Map([['node:a', { x: 36, y: 36 }], ['node:b', { x: 324, y: 36 }]]));
    expect(canvas?.projection?.nodes).toHaveLength(0);
    const mode = component.querySelector<HTMLSelectElement>('[data-topology-mode]')!;
    mode.value = 'all-nodes'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    expect(canvas?.positions?.get('node:a')).toEqual({ x: 36, y: 36 });
    mode.value = 'detailed'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    expect(canvas?.projection?.nodes).toHaveLength(0);
    harness.controllers[0]?.onUpdate(update(createGraph()));
    expect((component as HTMLElement & { positions: Map<string, { x: number; y: number }> }).positions.get('node:a')).toEqual({ x: 36, y: 36 });
    await vi.advanceTimersByTimeAsync(200);
    const persisted = JSON.parse(localStorage.getItem(topologyLayoutStorageKey('https://host.example')) ?? '{}');
    expect(persisted.positions['node:a']).toEqual({ x: 36, y: 36 });
    expect(persisted.positions['node:b']).toEqual({ x: 324, y: 36 });
    expect(persisted.positions['node:churn']).toBeUndefined();
    expect(persisted.workspaceMode).toBe('custom');
  });

  it('places automatic cells without overlap using each projected block height', () => {
    const state = component as unknown as {
      positions: Map<string, { x: number; y: number }>;
      autoPositionIds: Set<string>;
      ensurePositions(nodes: readonly TopologyCanvasNode[], wires: [], visible: readonly TopologyCanvasNode[]): void;
    };
    state.positions.clear();
    state.autoPositionIds.clear();
    const nodes = Array.from({ length: 10 }, (_, index) => projectedCard(`node:height-${index}`, index === 0 ? 520 : index % 2 ? 280 : 164));
    state.ensurePositions(nodes, [], nodes);
    const heights = new Map(nodes.map(({ id, height }) => [id, Math.min(420, height!)]));
    const placed = nodes.map(({ id }) => ({ id, point: state.positions.get(id)! }));
    for (let left = 0; left < placed.length; left += 1) {
      for (let right = left + 1; right < placed.length; right += 1) {
        const a = placed[left]!; const b = placed[right]!;
        const horizontalOverlap = a.point.x < b.point.x + 272 && b.point.x < a.point.x + 272;
        const verticalOverlap = a.point.y < b.point.y + heights.get(b.id)! + 24
          && b.point.y < a.point.y + heights.get(a.id)! + 24;
        expect(horizontalOverlap && verticalOverlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it('moves only overlapping auto-positioned cards when actual geometry grows', () => {
    const state = component as unknown as {
      positions: Map<string, { x: number; y: number }>;
      autoPositionIds: Set<string>;
      ensurePositions(nodes: readonly TopologyCanvasNode[], wires: [], visible: readonly TopologyCanvasNode[]): void;
    };
    state.positions.clear();
    state.positions.set('node:manual', { x: 36, y: 36 });
    state.positions.set('node:auto', { x: 36, y: 200 });
    state.autoPositionIds.clear(); state.autoPositionIds.add('node:auto');
    const nodes = [projectedCard('node:auto', 120), projectedCard('node:manual', 520)];
    state.ensurePositions(nodes, [], nodes);
    expect(state.positions.get('node:manual')).toEqual({ x: 36, y: 36 });
    const auto = state.positions.get('node:auto')!;
    expect(auto).toEqual({ x: 36, y: 480 });
  });

  it('nudges a promoted auto-positioned card when its new port row collides', () => {
    const state = component as unknown as {
      positions: Map<string, { x: number; y: number }>;
      autoPositionIds: Set<string>;
      ensurePositions(nodes: readonly TopologyCanvasNode[], wires: [], visible: readonly TopologyCanvasNode[]): void;
    };
    const promotedId = 'node:promoted'; const upperId = 'node:upper';
    const before = { x: 36, y: 200 };
    state.positions = new Map([[promotedId, before], [upperId, { x: 36, y: 36 }]]);
    state.autoPositionIds = new Set([promotedId, upperId]);
    const inventory = [projectedCard(promotedId, 130), projectedCard(upperId, 520)];
    const visible = [projectedCard(promotedId, 130), projectedCard(upperId, 160)];
    state.ensurePositions(inventory, [], visible);
    expect(state.positions.get(upperId)).toEqual({ x: 36, y: 36 });
    expect(state.positions.get(promotedId)).toEqual({ x: before.x, y: 220 });
  });

  it('does not move nearby cards when only the unrendered endpoint inventory grows', () => {
    const graph = createGraph();
    const [upper, lower] = graph.nodes;
    const state = component as HTMLElement & { positions: Map<string, { x: number; y: number }>; autoPositionIds: Set<string> };
    state.positions = new Map([[upper!.id, { x: 36, y: 36 }], [lower!.id, { x: 36, y: 180 }]]);
    state.autoPositionIds = new Set([lower!.id]);
    graph.endpoints = Array.from({ length: 200 }, (_, index) => ({
      id: `endpoint:hidden:${index}` as TopologyGraph['endpoints'][number]['id'], nodeId: upper!.id,
      name: `endpoint-${index}`, kind: 'local-action', evidence: 'declared'
    }));
    harness.controllers[0]?.onUpdate(update(graph));
    expect(harness.canvases[0]?.positions?.get(lower!.id)).toEqual({ x: 36, y: 180 });
  });

  it('promotes same logical-name placeholders in place, preserving selection and layout', () => {
    openNavigator(component);
    const initial = createGraph();
    const placeholderId = 'node:gamma' as TopologyNode['id'];
    const placeholder: TopologyNode = { ...initial.nodes[0]!, id: placeholderId, name: 'Gamma', discovery: 'placeholder', addresses: [] };
    harness.controllers[0]?.onUpdate(update({ ...initial, nodes: [...initial.nodes, placeholder] }));
    const state = component as HTMLElement & { positions: Map<string, { x: number; y: number }>; selection: { type: string; id: string } | null };
    const formerPosition = { x: 1800, y: 1000 };
    state.positions.set(placeholderId, formerPosition);
    if (harness.canvases[0]) harness.canvases[0].positions = new Map(state.positions);
    searchAndSelect(component, 'Gamma');
    openInspector(component);
    const resolvedNode: TopologyNode = { ...placeholder, discovery: 'advertised', evidenceRouteId: 'route-gamma' };
    const resolvedGraph = { ...initial, nodes: [...initial.nodes, resolvedNode] };
    harness.controllers[0]?.onUpdate(update(resolvedGraph));
    expect(state.positions.get(placeholderId)).toEqual(formerPosition);
    expect(harness.canvases[0]?.positions?.get(placeholderId)).toEqual(formerPosition);
    expect(state.selection).toEqual({ type: 'node', id: placeholderId });
    expect(component.querySelector('[data-topology-inspector-content]')?.textContent).toContain('Discovered node');
  });

  it('retains a selected alias and scoped reveal across a pending omission, then clears them after fresh complete removal', () => {
    openNavigator(component);
    const initial = createGraph();
    const owner = initial.nodes[0]!;
    const target = { ...initial.nodes[1]!, assignmentEvidence: { status: 'success' as const, source: 'test', value: { actions: {}, events: {} } } };
    const sourceEndpoint = { id: 'endpoint:owner' as TopologyGraph['endpoints'][number]['id'], nodeId: owner.id, kind: 'local-action' as const, name: 'Call', evidence: 'declared' as const };
    const targetEndpoint = { id: 'endpoint:target' as TopologyGraph['endpoints'][number]['id'], nodeId: target.id, kind: 'remote-action' as const, name: 'Run', evidence: 'unknown' as const };
    const binding: TopologyGraph['bindings'][number] = {
      id: 'binding:owner:call' as TopologyGraph['bindings'][number]['id'], ownerId: owner.id,
      kind: 'actions', alias: 'Call', declared: 'yes', assignment: 'complete', assignmentRow: 'present',
      configuredNode: target.name, configuredEndpoint: 'Run', sourceEndpointId: sourceEndpoint.id,
      targetEndpointId: targetEndpoint.id, targetNodeId: target.id, direction: 'source-to-target', referenceResolution: 'resolved'
    };
    const fullGraph = { ...initial, nodes: [owner, target], endpoints: [sourceEndpoint, targetEndpoint], bindings: [binding] };
    harness.controllers[0]?.onUpdate(update(fullGraph));
    const connections = component.querySelector<HTMLInputElement>('[data-topology-display="connections"]');
    if (!connections) throw new Error('Connections toggle should exist');
    connections.checked = false; connections.dispatchEvent(new Event('change', { bubbles: true }));
    harness.canvases[0]?.callbacks.onWireSelected?.(binding.id);
    component.querySelector<HTMLButtonElement>('[data-topology-action="show-binding-connection"]')?.click();

    const state = component as HTMLElement & { selection: { type: string; id: string } | null; scopedReveal: { bindingId?: string } | null };
    expect(state.selection).toEqual({ type: 'binding', id: binding.id });
    expect(state.scopedReveal).toEqual({ bindingId: binding.id });
    const pendingGraph: TopologyGraph = { ...fullGraph, bindings: [], completeness: { ...fullGraph.completeness, assignments: 'partial' } };
    harness.controllers[0]?.onUpdate({ ...update(pendingGraph), phase: 'loading' });
    expect(state.selection).toEqual({ type: 'binding', id: binding.id });
    expect(state.scopedReveal).toEqual({ bindingId: binding.id });
    expect(component.querySelector('[data-topology-inspector-content]')?.textContent).toContain('temporarily absent while owner assignments are being refreshed');

    const freshNodes = fullGraph.nodes.map((node) => ({ ...node, assignmentEvidence: { status: 'success' as const, source: 'test', value: { actions: {}, events: {} } } }));
    const removedGraph: TopologyGraph = {
      ...fullGraph, nodes: freshNodes, endpoints: [], bindings: [],
      completeness: { ...fullGraph.completeness, discovery: 'complete', assignments: 'complete' }
    };
    harness.controllers[0]?.onUpdate(update(removedGraph));
    expect(state.selection).toBeNull();
    expect(state.scopedReveal).toBeNull();
  });

  it('waits for a connected group before the first frame and respects a user viewport change', () => {
    const state = component as HTMLElement & { initialFitDone: boolean; cameraTouched: boolean; viewport: { x: number; y: number; scale: number } | undefined };
    const canvas = harness.canvases[0];
    if (!canvas) throw new Error('Canvas should be ready');
    state.initialFitDone = false; state.cameraTouched = false; state.viewport = undefined;
    canvas.connectedFrames.length = 0; canvas.nodeFrames.length = 0;
    const graph = createGraph();
    graph.completeness.discovery = 'partial';
    harness.controllers[0]?.onUpdate({ ...update(graph), coverage: 'partial' });
    expect(canvas.connectedFrames).toHaveLength(0);
    expect(canvas.nodeFrames).toHaveLength(0);
    const source = { id: 'endpoint:camera-out' as TopologyGraph['endpoints'][number]['id'], nodeId: graph.nodes[0]!.id, kind: 'remote-action' as const, name: 'send', evidence: 'declared' as const };
    const target = { id: 'endpoint:camera-in' as TopologyGraph['endpoints'][number]['id'], nodeId: graph.nodes[1]!.id, kind: 'local-action' as const, name: 'run', evidence: 'inferred' as const };
    const binding: TopologyGraph['bindings'][number] = {
      id: 'binding:camera' as TopologyGraph['bindings'][number]['id'], ownerId: graph.nodes[0]!.id, kind: 'actions', alias: 'send', declared: 'yes', assignment: 'complete', assignmentRow: 'present',
      sourceEndpointId: source.id, targetEndpointId: target.id, targetNodeId: target.nodeId, configuredNode: 'Beta', configuredEndpoint: 'run',
      direction: 'source-to-target', referenceResolution: 'resolved'
    };
    const connected = { ...graph, endpoints: [source, target], bindings: [binding] };
    harness.controllers[0]?.onUpdate({ ...update(connected), coverage: 'partial' });
    expect(canvas.connectedFrames).toContain(graph.nodes[0]!.id);
    expect(state.initialFitDone).toBe(true);
    state.initialFitDone = false; state.cameraTouched = false; state.viewport = undefined;
    canvas.callbacks.onViewportChanged?.({ x: 20, y: 30, scale: 1.1 });
    canvas.connectedFrames.length = 0;
    harness.controllers[0]?.onUpdate({ ...update(connected), coverage: 'partial' });
    expect(canvas.connectedFrames).toHaveLength(0);
    expect(state.initialFitDone).toBe(true);
    state.initialFitDone = false; state.cameraTouched = false; state.viewport = { x: 42, y: 24, scale: 1.1 };
    canvas.connectedFrames.length = 0;
    harness.controllers[0]?.onUpdate({ ...update(connected), coverage: 'partial' });
    expect(canvas.connectedFrames).toHaveLength(0);
    expect(state.initialFitDone).toBe(false);
  });

  it('keeps an empty complete result helpful without framing an unrelated advertised node early', () => {
    const state = component as HTMLElement & { initialFitDone: boolean; cameraTouched: boolean; viewport: { x: number; y: number; scale: number } | undefined };
    const canvas = harness.canvases[0];
    if (!canvas) throw new Error('Canvas should be ready');
    state.initialFitDone = false; state.cameraTouched = false; state.viewport = undefined;
    canvas.connectedFrames.length = 0; canvas.nodeFrames.length = 0;
    const empty: TopologyGraph = {
      nodes: [], endpoints: [], bindings: [], discoveryEvidence: { status: 'success', source: 'test', value: [] },
      completeness: { discovery: 'complete', schema: 'complete', assignments: 'complete' }
    };
    harness.controllers[0]?.onUpdate({ ...update(empty), coverage: 'complete' });
    expect(component.querySelector('[data-topology-empty]')?.textContent).toContain('No network nodes were discovered');
    expect(canvas.connectedFrames).toHaveLength(0);
    expect(canvas.nodeFrames).toHaveLength(0);
    expect(state.initialFitDone).toBe(false);
  });

  it('opens Expanded as a paged contextual browser without adding every endpoint port', () => {
    const graph = createGraph();
    graph.endpoints = Array.from({ length: 240 }, (_, index) => ({
      id: `endpoint:${index}` as TopologyGraph['endpoints'][number]['id'], nodeId: graph.nodes[0]!.id,
      kind: 'local-action' as const, name: `action-${index}`, evidence: 'inferred' as const
    }));
    harness.controllers[0]?.onUpdate(update(graph));
    const mode = component.querySelector<HTMLSelectElement>('[data-topology-reveal]');
    if (!mode) throw new Error('Endpoint visibility mode should exist');
    mode.value = 'expanded'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    expect(mode.value).toBe('expanded');
    expect(component.querySelector('[data-topology-inspector-tab="endpoints"]')?.getAttribute('aria-selected')).toBe('true');
    expect(component.querySelectorAll('[data-topology-reveal-endpoint]')).toHaveLength(50);
    expect(harness.canvases[0]?.projection?.nodes.flatMap(({ ports }) => ports)).toHaveLength(0);
  });

  it('reveals a searched connection without enabling global filters or changing configured preferences', () => {
    const view = component.querySelector<HTMLSelectElement>('[data-topology-mode]');
    if (view) { view.value = 'detailed'; view.dispatchEvent(new Event('change', { bubbles: true })); }
    const state = component as HTMLElement & { workspace: { mode: 'custom'; pinnedNodeIds: Set<TopologyNode['id']>; omittedNodeIds: Set<TopologyNode['id']> } };
    state.workspace = { mode: 'custom', pinnedNodeIds: new Set(['node:a', 'node:b'] as TopologyNode['id'][]), omittedNodeIds: new Set() };
    const graph = createGraph();
    graph.nodes[1]!.schemaEvidence = { status: 'success', source: 'test', value: { actions: [], events: [] } };
    graph.nodes[1]!.assignmentEvidence = { status: 'success', source: 'test', value: { actions: {}, events: {} } };
    const source = { id: 'endpoint:source' as TopologyGraph['endpoints'][number]['id'], nodeId: graph.nodes[0]!.id, kind: 'remote-action' as const, name: 'send', evidence: 'declared' as const };
    const target = { id: 'endpoint:target' as TopologyGraph['endpoints'][number]['id'], nodeId: graph.nodes[1]!.id, kind: 'local-action' as const, name: 'run', evidence: 'inferred' as const };
    const binding: TopologyGraph['bindings'][number] = {
      id: 'binding:search' as TopologyGraph['bindings'][number]['id'], ownerId: graph.nodes[0]!.id, kind: 'actions', alias: 'launch', declared: 'yes', assignment: 'complete', assignmentRow: 'present',
      sourceEndpointId: source.id, targetEndpointId: target.id, targetNodeId: target.nodeId, configuredNode: 'Beta', configuredEndpoint: 'run', direction: 'source-to-target', referenceResolution: 'resolved'
    };
    graph.endpoints = [source, target]; graph.bindings = [binding];
    harness.controllers[0]?.onUpdate(update(graph));
    const discovered = component.querySelector<HTMLInputElement>('[data-topology-facet="discovered"]');
    if (!discovered) throw new Error('Discovered filter should exist');
    discovered.checked = false; discovered.dispatchEvent(new Event('change', { bubbles: true }));
    expect(harness.canvases[0]?.projection?.nodes.map(({ id }) => id)).not.toContain(graph.nodes[1]!.id);
    const connections = component.querySelector<HTMLInputElement>('[data-topology-display="connections"]');
    if (!connections) throw new Error('Connections display toggle should exist');
    connections.checked = false; connections.dispatchEvent(new Event('change', { bubbles: true }));
    const unresolvedToggle = component.querySelector<HTMLInputElement>('[data-topology-display="placeholders"]');
    const candidateToggle = component.querySelector<HTMLInputElement>('[data-topology-display="candidates"]');
    expect(component.querySelector('[data-topology-display="placeholders"]')?.parentElement?.textContent).toContain('All unresolved references');
    expect(component.querySelector('.nodel-topology-filter-note')?.textContent).toContain('Inspector → Bindings');
    const search = component.querySelector<HTMLInputElement>('[data-topology-filter]');
    if (!search) throw new Error('Global search should exist');
    search.value = 'launch'; search.dispatchEvent(new Event('input', { bubbles: true }));
    const result = component.querySelector<HTMLButtonElement>('[data-topology-search-index]');
    expect(result?.textContent).toContain('hidden by status filter');
    result?.click();
    expect(harness.canvases[0]?.projection?.nodes.map(({ id }) => id)).toContain(graph.nodes[0]!.id);
    expect(harness.canvases[0]?.projection?.nodes.map(({ id }) => id)).toContain(graph.nodes[1]!.id);
    expect(harness.canvases[0]?.projection?.wires).toHaveLength(1);
    expect(harness.canvases[0]?.selectedWires).toContain(binding.id);
    expect(connections.checked).toBe(false);
    expect(unresolvedToggle?.checked).toBe(true);
    expect(candidateToggle?.checked).toBe(true);
    expect(component.hasAttribute('show-placeholders')).toBe(false);
    expect(component.hasAttribute('show-candidates')).toBe(false);
    expect(harness.canvases[0]?.nodeFrames.at(-1)).toEqual([source.nodeId, target.nodeId]);
    harness.canvases[0]?.callbacks.onNodeSelected?.('node:a');
    expect(harness.canvases[0]?.projection?.wires).toHaveLength(0);
  });

  it('shows configured missing-reference wires by default and lets Connections narrow the diagram', () => {
    const graph = createGraph();
    const source = { id: 'endpoint:send' as TopologyGraph['endpoints'][number]['id'], nodeId: graph.nodes[0]!.id, kind: 'remote-action' as const, name: 'send', evidence: 'declared' as const };
    const target = { id: 'endpoint:missing' as TopologyGraph['endpoints'][number]['id'], nodeId: graph.nodes[1]!.id, kind: 'local-action' as const, name: 'run', evidence: 'missing' as const };
    const wireId = 'binding:wire' as TopologyGraph['bindings'][number]['id'];
    const emptyId = 'binding:empty' as TopologyGraph['bindings'][number]['id'];
    graph.endpoints = [source, target];
    graph.bindings = [
      { id: wireId, ownerId: source.nodeId, kind: 'actions', alias: 'send', declared: 'yes', assignment: 'complete', assignmentRow: 'present', direction: 'source-to-target', referenceResolution: 'endpoint-missing',
        sourceEndpointId: source.id, targetEndpointId: target.id, targetNodeId: target.nodeId, configuredNode: 'Beta', configuredEndpoint: 'run' },
      { id: emptyId, ownerId: source.nodeId, kind: 'actions', alias: 'empty', declared: 'yes', assignment: 'unbound', assignmentRow: 'absent', direction: 'source-to-target', referenceResolution: 'unknown' }
    ];
    harness.controllers[0]?.onUpdate(update(graph));
    searchAndSelect(component, '<img');
    component.querySelector<HTMLButtonElement>('[data-topology-inspector-tab="bindings"]')?.click();
    component.querySelector<HTMLButtonElement>(`[data-topology-select-id="${wireId}"]`)?.click();
    const inspector = component.querySelector('[data-topology-inspector-content]');
    expect(harness.canvases[0]?.projection?.wires.map(({ id }) => id)).toEqual([wireId]);
    expect(inspector?.textContent).not.toContain('hidden by current display controls');
    expect(inspector?.querySelector('[data-topology-action="show-binding-connection"]')).toBeNull();
    const connections = component.querySelector<HTMLInputElement>('[data-topology-display="connections"]');
    if (!connections) throw new Error('Connections toggle should exist');
    connections.checked = false; connections.dispatchEvent(new Event('change', { bubbles: true }));
    expect(harness.canvases[0]?.projection?.wires).toEqual([]);
    expect(inspector?.textContent).toContain('Connections are hidden');
    connections.checked = true; connections.dispatchEvent(new Event('change', { bubbles: true }));
    expect(component.hasAttribute('show-placeholders')).toBe(false);
    expect(harness.canvases[0]?.projection?.wires.map(({ id }) => id)).toEqual([wireId]);
    harness.canvases[0]?.callbacks.onWireSelected?.(emptyId);
    expect(harness.canvases[0]?.projection?.wires.map(({ id }) => id)).toEqual([wireId]);

    searchAndSelect(component, 'empty');
    expect(inspector?.textContent).toContain('no drawable wire in the current evidence');
    expect(inspector?.querySelector('[data-topology-action="show-binding-connection"]')).toBeNull();
  });

  it('rerenders only when blank-canvas deselection clears a scoped reveal', () => {
    const graph = createGraph();
    const source = { id: 'endpoint:scoped-source' as TopologyGraph['endpoints'][number]['id'], nodeId: graph.nodes[0]!.id, kind: 'remote-action' as const, name: 'send', evidence: 'declared' as const };
    const target = { id: 'endpoint:scoped-missing' as TopologyGraph['endpoints'][number]['id'], nodeId: graph.nodes[1]!.id, kind: 'local-action' as const, name: 'gone', evidence: 'missing' as const };
    const bindingId = 'binding:scoped-deselect' as TopologyGraph['bindings'][number]['id'];
    const binding: TopologyGraph['bindings'][number] = {
      id: bindingId, ownerId: graph.nodes[0]!.id, kind: 'actions', alias: 'send', declared: 'yes',
      assignment: 'complete', assignmentRow: 'present', sourceEndpointId: source.id, targetEndpointId: target.id,
      targetNodeId: target.nodeId, configuredNode: 'Beta', configuredEndpoint: 'gone', direction: 'source-to-target',
      referenceResolution: 'endpoint-missing'
    };
    graph.endpoints = [source, target]; graph.bindings = [binding];
    harness.controllers[0]?.onUpdate(update(graph));
    const connections = component.querySelector<HTMLInputElement>('[data-topology-display="connections"]');
    if (!connections) throw new Error('Connections toggle should exist');
    connections.checked = false; connections.dispatchEvent(new Event('change', { bubbles: true }));
    const canvas = harness.canvases[0];
    if (!canvas) throw new Error('Canvas should be ready');
    canvas.callbacks.onWireSelected?.(bindingId);
    component.querySelector<HTMLButtonElement>('[data-topology-action="show-binding-connection"]')?.click();
    expect(canvas.projection?.wires.map(({ id }) => id)).toEqual([bindingId]);
    const rendersWithScope = canvas.updateCalls;
    canvas.callbacks.onWireSelected?.(null);
    expect(canvas.projection?.wires).toEqual([]);
    expect(canvas.updateCalls).toBeGreaterThan(rendersWithScope);

    canvas.callbacks.onNodeSelected?.('node:a');
    const rendersWithoutScope = canvas.updateCalls;
    canvas.callbacks.onNodeSelected?.(null);
    expect(canvas.updateCalls).toBe(rendersWithoutScope);
  });

  it('keeps the global search focus across publication and supports keyboard result selection', () => {
    const selected = component.querySelector<HTMLInputElement>('[data-topology-filter]');
    if (!selected) throw new Error('Search should exist');
    selected.value = 'a'; selected.dispatchEvent(new Event('input', { bubbles: true })); selected.focus();
    expect(component.querySelectorAll('[data-topology-search-index]')).toHaveLength(2);
    selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(component.querySelector('[data-topology-search-index="1"]')?.getAttribute('aria-selected')).toBe('true');
    selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    harness.controllers[0]?.onUpdate(update(createGraph()));
    expect(document.activeElement).toBe(selected);
    expect((component as HTMLElement & { selection: { type: string; id: string } | null }).selection?.id).toBe('node:b');
  });

  it('provides navigable incoming and outgoing aliases with explicit canvas controls', () => {
    openNavigator(component);
    const initial = createGraph();
    const owner = initial.nodes[0]!;
    const target = initial.nodes[1]!;
    const sourceId = 'endpoint:out' as TopologyGraph['endpoints'][number]['id'];
    const targetId = 'endpoint:in' as TopologyGraph['endpoints'][number]['id'];
    const bindings: TopologyGraph['bindings'] = [
      { id: 'binding:out' as TopologyGraph['bindings'][number]['id'], ownerId: owner.id, kind: 'actions', alias: 'send', declared: 'yes', assignment: 'complete', assignmentRow: 'present', sourceEndpointId: sourceId, targetEndpointId: targetId, targetNodeId: target.id, configuredNode: target.name, configuredEndpoint: 'run', direction: 'source-to-target', referenceResolution: 'resolved' },
      { id: 'binding:in' as TopologyGraph['bindings'][number]['id'], ownerId: target.id, kind: 'events', alias: 'receive', declared: 'yes', assignment: 'complete', assignmentRow: 'present', sourceEndpointId: targetId, targetEndpointId: sourceId, targetNodeId: owner.id, direction: 'source-to-target', referenceResolution: 'resolved' }
    ];
    const graph = { ...initial, endpoints: [
      { id: sourceId, nodeId: owner.id, kind: 'remote-action' as const, name: 'send', evidence: 'declared' as const },
      { id: targetId, nodeId: target.id, kind: 'local-action' as const, name: 'run', evidence: 'declared' as const }
    ], bindings };
    harness.controllers[0]?.onUpdate(update(graph));
    searchAndSelect(component, owner.name);
    openInspector(component);
    const inspector = component.querySelector('[data-topology-inspector]');
    expect(inspector?.textContent).toContain('Outgoing aliases (1)');
    expect(inspector?.textContent).toContain('Incoming aliases (1)');
    inspector?.querySelector<HTMLButtonElement>('[data-topology-select-id="binding:out"]')?.click();
    expect(inspector?.textContent).toContain('send');
    expect(inspector?.querySelector('[data-topology-action="center"]')).not.toBeNull();
    inspector?.querySelector<HTMLButtonElement>('[data-topology-action="center"]')?.click();
    expect(harness.canvases[0]?.nodeFrames.at(-1)).toEqual([owner.id, target.id]);
    const canvasHost = component.querySelector<HTMLElement>('[data-topology-canvas]');
    if (canvasHost) {
      Object.defineProperty(canvasHost, 'clientWidth', { configurable: true, value: 640 });
      Object.defineProperty(canvasHost, 'clientHeight', { configurable: true, value: 480 });
    }
    component.querySelector<HTMLButtonElement>('[data-topology-action="zoom-in"]')?.click();
    expect(harness.canvases[0]?.viewport.scale).toBeGreaterThan(1);
    expect(component.querySelector('.nodel-topology-zoom-level')?.textContent).toBe('120%');
    vi.runOnlyPendingTimers();
    const saved = JSON.parse(localStorage.getItem(topologyLayoutStorageKey('https://host.example')) ?? '{}') as { viewport?: { scale: number } };
    expect(saved.viewport?.scale).toBeCloseTo(1.2);
    component.querySelector<HTMLButtonElement>('[data-topology-action="zoom-out"]')?.click();
    expect(component.querySelector('.nodel-topology-zoom-level')?.textContent).toBe('100%');
    vi.runOnlyPendingTimers();
    const zoomedOut = JSON.parse(localStorage.getItem(topologyLayoutStorageKey('https://host.example')) ?? '{}') as { viewport?: { scale: number } };
    expect(zoomedOut.viewport?.scale).toBeCloseTo(1);
  });

  it('constrains the mobile workspace and canvas to shrinkable full width', () => {
    const workspace = component.querySelector('[data-topology-canvas]')?.parentElement;
    expect(workspace?.classList.contains('min-w-0')).toBe(true);
    expect(workspace?.classList.contains('w-full')).toBe(true);
    expect(component.querySelector('[data-topology-canvas]')?.classList.contains('min-w-0')).toBe(true);
    expect(component.classList.contains('w-full')).toBe(true);
    expect(component.classList.contains('min-w-0')).toBe(true);
  });

  it('searches known endpoints and bindings without filtering the diagram', () => {
    const initial = createGraph();
    const owner = initial.nodes[0]!;
    const target = initial.nodes[1]!;
    const output = { id: 'ep:output' as TopologyGraph['endpoints'][number]['id'], nodeId: owner.id, kind: 'remote-action' as const, name: 'send', evidence: 'declared' as const };
    const input = { id: 'ep:input' as TopologyGraph['endpoints'][number]['id'], nodeId: target.id, kind: 'local-action' as const, name: 'run', evidence: 'inferred' as const };
    const binding: TopologyGraph['bindings'][number] = {
      id: 'binding:run' as TopologyGraph['bindings'][number]['id'], ownerId: owner.id, kind: 'actions', alias: 'launch', declared: 'yes', assignment: 'complete', assignmentRow: 'present',
      sourceEndpointId: output.id, targetEndpointId: input.id, targetNodeId: target.id, configuredNode: 'Beta', configuredEndpoint: 'run', direction: 'source-to-target', referenceResolution: 'resolved'
    };
    const graph = { ...initial, endpoints: [output, input], bindings: [binding] };
    harness.controllers[0]?.onUpdate(update(graph));
    const canvas = harness.canvases[0];
    expect(canvas?.projection?.nodes).toHaveLength(2);
    expect(canvas?.projection?.wires).toHaveLength(1);
    searchAndSelect(component, 'run');
    expect((component as HTMLElement & { selection: { type: string; id: string } | null }).selection).toEqual({ type: 'node', id: target.id });
    expect(component.querySelector('[data-topology-inspector-tab="endpoints"]')?.getAttribute('aria-selected')).toBe('true');
    expect(component.querySelector('[data-topology-reveal-endpoint="ep:input"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(canvas?.projection?.nodes).toHaveLength(2);
    expect(canvas?.projection?.wires).toHaveLength(1);
    const connections = component.querySelector<HTMLInputElement>('[data-topology-display="connections"]');
    if (!connections) throw new Error('Connections toggle should exist');
    connections.checked = false; connections.dispatchEvent(new Event('change', { bubbles: true }));
    expect(canvas?.projection?.wires).toHaveLength(0);
    expect((component as HTMLElement & { graph(): TopologyGraph }).graph().bindings).toHaveLength(1);
    connections.checked = true; connections.dispatchEvent(new Event('change', { bubbles: true }));
    const labels = component.querySelector<HTMLInputElement>('[data-topology-display="labels"]');
    if (!labels) throw new Error('Endpoint label toggle should exist');
    labels.checked = false; labels.dispatchEvent(new Event('change', { bubbles: true }));
    expect(canvas?.projection?.wires[0]?.label).toBeUndefined();
    expect(canvas?.projection?.nodes.flatMap(({ ports }) => ports).every(({ label }) => label === '')).toBe(true);
  });

  it('combines overlapping status facets with OR and applies display toggles without mutating evidence', () => {
    const view = component.querySelector<HTMLSelectElement>('[data-topology-mode]');
    if (view) { view.value = 'detailed'; view.dispatchEvent(new Event('change', { bubbles: true })); }
    const state = component as HTMLElement & { workspace: { mode: 'custom'; pinnedNodeIds: Set<TopologyNode['id']>; omittedNodeIds: Set<TopologyNode['id']> } };
    state.workspace = { mode: 'custom', pinnedNodeIds: new Set(['node:a', 'node:b'] as TopologyNode['id'][]), omittedNodeIds: new Set() };
    const graph = createGraph();
    graph.nodes[1]!.schemaEvidence = { status: 'success', source: 'test', value: { actions: [], events: [] } };
    graph.nodes[1]!.assignmentEvidence = { status: 'success', source: 'test', value: { actions: {}, events: {} } };
    const statuses = new Map<TopologyNode['id'], { readability: 'partial'; stale: boolean }>([[graph.nodes[0]!.id, { readability: 'partial', stale: true }]]);
    harness.controllers[0]?.onUpdate({ ...update(graph), nodeStatuses: statuses });
    expect(component.querySelector('[data-topology-facet="discovered"]')?.closest('label')?.textContent).toContain('2');
    expect(component.querySelector('[data-topology-facet="partial"]')?.closest('label')?.textContent).toContain('1');
    expect(component.querySelector('[data-topology-facet="stale"]')?.closest('label')?.textContent).toContain('1');
    const discovered = component.querySelector<HTMLInputElement>('[data-topology-facet="discovered"]');
    if (!discovered) throw new Error('Discovered filter should exist');
    discovered.checked = false; discovered.dispatchEvent(new Event('change', { bubbles: true }));
    expect(harness.canvases[0]?.projection?.nodes.map(({ id }) => id)).toContain(graph.nodes[0]!.id);
    expect(harness.canvases[0]?.projection?.nodes.map(({ id }) => id)).not.toContain(graph.nodes[1]!.id);
    const connections = component.querySelector<HTMLInputElement>('[data-topology-display="connections"]');
    if (!connections) throw new Error('Connections toggle should exist');
    connections.checked = false; connections.dispatchEvent(new Event('change', { bubbles: true }));
    expect(harness.canvases[0]?.projection?.wires).toHaveLength(0);
    expect((component as HTMLElement & { graph(): TopologyGraph }).graph().bindings).toHaveLength(0);
  });

  it('pages endpoints in the inspector and keeps drawer disclosure state during updates', () => {
    const graph = createGraph();
    graph.endpoints = Array.from({ length: 60 }, (_, index) => ({
      id: `endpoint:${index}` as TopologyGraph['endpoints'][number]['id'], nodeId: graph.nodes[0]!.id,
      kind: 'local-action' as const, name: `action-${index}`, evidence: 'inferred' as const
    }));
    graph.bindings = Array.from({ length: 60 }, (_, index) => ({
      id: `binding:${index}` as TopologyGraph['bindings'][number]['id'], ownerId: graph.nodes[0]!.id,
      kind: 'actions' as const, alias: `alias-${index}`, declared: 'yes' as const, assignment: 'unbound' as const,
      assignmentRow: 'absent' as const, direction: 'source-to-target' as const, referenceResolution: 'unknown' as const
    }));
    harness.controllers[0]?.onUpdate(update(graph));
    searchAndSelect(component, '<img');
    component.querySelector<HTMLButtonElement>('[data-topology-inspector-tab="bindings"]')?.click();
    expect(component.querySelectorAll('[data-topology-select-type="binding"]')).toHaveLength(50);
    let bindingSearch = component.querySelector<HTMLInputElement>('[data-topology-binding-filter]');
    if (!bindingSearch) throw new Error('Bindings should be searchable');
    bindingSearch.value = 'alias-59'; bindingSearch.dispatchEvent(new Event('input', { bubbles: true }));
    expect(component.querySelectorAll('[data-topology-select-type="binding"]')).toHaveLength(1);
    bindingSearch = component.querySelector<HTMLInputElement>('[data-topology-binding-filter]');
    if (!bindingSearch) throw new Error('Bindings search field should persist');
    bindingSearch.value = ''; bindingSearch.dispatchEvent(new Event('input', { bubbles: true }));
    component.querySelector<HTMLButtonElement>('[data-topology-endpoint-more="bindings"]')?.click();
    expect(component.querySelectorAll('[data-topology-select-type="binding"]')).toHaveLength(60);
    component.querySelector<HTMLButtonElement>('[data-topology-inspector-tab="endpoints"]')?.click();
    expect(component.querySelector('[data-topology-inspector-content] [data-topology-endpoint-filter]')).not.toBeNull();
    expect(component.querySelectorAll('[data-topology-reveal-endpoint]')).toHaveLength(50);
    component.querySelector<HTMLButtonElement>('[data-topology-endpoint-more]')?.click();
    expect(component.querySelectorAll('[data-topology-reveal-endpoint]')).toHaveLength(60);
    const details = component.querySelector<HTMLDetailsElement>('nodel-collapse details');
    if (!details) throw new Error('Diagnostics should use nodel-collapse');
    details.open = true; details.setAttribute('open', '');
    harness.controllers[0]?.onUpdate({ ...update(graph), diagnostics: [{ source: 'routes', message: 'New partial evidence.' }] });
    expect(details.open).toBe(true);
    expect(component.querySelector('[data-collapse-preview]')?.textContent).toContain('1 item');
    expect(component.querySelector('[data-collapse-preview]')?.textContent).toContain('Topology read complete');
  });

  it('opens an empty inspector with a hint and returns focus to its opener on close', () => {
    const opener = component.querySelector<HTMLButtonElement>('[data-topology-inspector-toggle]');
    if (!opener) throw new Error('Inspector toolbar control should exist');
    opener.focus(); opener.click();
    expect(component.querySelector('[data-topology-inspector-content]')?.textContent).toContain('Select a node or binding');
    component.querySelector<HTMLButtonElement>('[data-topology-action="close-inspector"]')?.click();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps mobile panels mutually exclusive and returns focus on Escape', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
    try {
      const filters = component.querySelector<HTMLButtonElement>('[data-topology-filters-toggle]');
      const inspector = component.querySelector<HTMLButtonElement>('[data-topology-inspector-toggle]');
      if (!filters || !inspector) throw new Error('Mobile panel controls should exist');
      filters.focus(); filters.click();
      expect(component.querySelector<HTMLElement>('[data-topology-sidebar]')?.hidden).toBe(false);
      const sidebarClose = component.querySelector<HTMLButtonElement>('[data-topology-action="close-filters"]');
      sidebarClose?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(document.activeElement).toBe(filters);
      inspector.focus(); inspector.click();
      expect(component.querySelector<HTMLElement>('[data-topology-inspector]')?.hidden).toBe(false);
      expect(component.querySelector<HTMLElement>('[data-topology-sidebar]')?.hidden).toBe(true);
      component.querySelector<HTMLElement>('[data-topology-inspector]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(component.querySelector<HTMLElement>('[data-topology-inspector]')?.hidden).toBe(true);
      expect(document.activeElement).toBe(inspector);
    } finally {
      if (original) Object.defineProperty(window, 'matchMedia', original);
      else delete (window as Partial<Window>).matchMedia;
    }
  });

  it('keeps the selection but closes the docked inspector at the mobile breakpoint', () => {
    let narrow = false;
    vi.stubGlobal('matchMedia', () => ({ matches: narrow }));
    try {
      const canvas = harness.canvases[0]!;
      const toggle = component.querySelector<HTMLButtonElement>('[data-topology-inspector-toggle]')!;
      const panel = component.querySelector<HTMLElement>('[data-topology-inspector]')!;
      canvas.callbacks.onNodeSelected?.('node:b');
      expect(panel.hidden).toBe(false);
      expect(toggle.textContent).toBe('Hide inspector');
      expect(canvas.nodeFrames.at(-1)).toEqual(['node:b']);
      narrow = true;
      window.dispatchEvent(new Event('resize'));
      canvas.callbacks.onCanvasResized?.();
      expect(panel.hidden).toBe(true);
      expect(toggle.textContent).toBe('Inspector');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(canvas.nodeFrames.slice(-2)).toEqual([['node:b'], ['node:b']]);
      toggle.click();
      expect(panel.hidden).toBe(false);
      expect(panel.getAttribute('aria-modal')).toBe('true');
      expect(panel.querySelector('h3')?.textContent).toBe('Beta');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      canvas.callbacks.onViewportChanged?.({ x: 10, y: 20, scale: 1 });
      const framesAfterPan = canvas.nodeFrames.length;
      narrow = false;
      window.dispatchEvent(new Event('resize'));
      canvas.callbacks.onCanvasResized?.();
      expect(canvas.nodeFrames).toHaveLength(framesAfterPan);
      expect(panel.hidden).toBe(false);
      expect(panel.getAttribute('role')).toBeNull();
      expect(panel.getAttribute('aria-modal')).toBeNull();
      expect(component.classList.contains('has-overlay')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('moves focus into a mobile search selection overlay and returns to the search field on Escape', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
    try {
      const input = component.querySelector<HTMLInputElement>('[data-topology-filter]');
      if (!input) throw new Error('Global search should exist');
      input.value = 'Beta'; input.dispatchEvent(new Event('input', { bubbles: true }));
      component.querySelector<HTMLButtonElement>('[data-topology-search-index]')?.click();
      expect(component.querySelector<HTMLElement>('[data-topology-inspector]')?.hidden).toBe(false);
      expect(document.activeElement).not.toBe(input);
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(component.querySelector<HTMLElement>('[data-topology-inspector]')?.hidden).toBe(true);
      expect(document.activeElement).toBe(input);
    } finally {
      if (original) Object.defineProperty(window, 'matchMedia', original);
      else delete (window as Partial<Window>).matchMedia;
    }
  });
});
