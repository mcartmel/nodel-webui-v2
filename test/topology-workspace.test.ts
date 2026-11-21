import { describe, expect, it } from 'vitest';
import { legacyTopologyLayoutStorageKey, readTopologyLayout, topologyLayoutStorageKey, writeTopologyLayout } from '../src/features/topology/topology-layout';
import { activateTopologyPaletteEntry, topologyPalettePage } from '../src/features/topology/topology-palette';
import { topologyWorkspaceMembership, addTopologyWorkspaceNode, removeTopologyWorkspaceNode, resetTopologyWorkspace } from '../src/features/topology/topology-workspace';
import type { TopologyGraph, TopologyNode, TopologyNodeId } from '../src/features/topology/topology-model';

const id = (value: string) => value as TopologyNodeId;
const makeNode = (index: number): TopologyNode => ({
  id: id(`node:${index}`), name: `Node ${String(index).padStart(4, '0')}`, host: index % 2 ? 'host-a' : 'host-b',
  addresses: [], discovery: 'advertised', actionInventory: { status: 'absent', source: 'test' },
  eventInventory: { status: 'absent', source: 'test' }, schemaEvidence: { status: 'absent', source: 'test' },
  assignmentEvidence: { status: 'absent', source: 'test' }
});
const graph = (nodes: TopologyNode[]): TopologyGraph => ({ nodes, endpoints: [], bindings: [],
  discoveryEvidence: { status: 'success', source: 'test', value: nodes.map(({ name }) => name) },
  completeness: { discovery: 'complete', schema: 'unknown', assignments: 'unknown' } });

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };
}

describe('topology workspace membership', () => {
  it('keeps discovered, displayed, and connected membership independent', () => {
    const nodes = [makeNode(1), makeNode(2)];
    const value = graph(nodes);
    const membership = topologyWorkspaceMembership(value, { mode: 'custom', pinnedNodeIds: new Set([nodes[1]!.id]), omittedNodeIds: new Set() });
    expect(membership.discoveredNodeIds).toEqual(new Set(nodes.map(({ id }) => id)));
    expect(membership.displayedNodeIds).toEqual(new Set([nodes[1]!.id]));
    expect(membership.connectedNodeIds).toEqual(new Set());
  });

  it('shows configured terminals by default without requiring saved membership or endpoint reads', () => {
    const [owner, target, isolated] = [makeNode(10), makeNode(11), makeNode(12)];
    const value = graph([owner, target, isolated]);
    value.bindings = [{ id: 'binding:configured' as TopologyGraph['bindings'][number]['id'], ownerId: owner.id, alias: 'peer', kind: 'actions', declared: 'yes',
      assignment: 'complete', assignmentRow: 'present', assignmentFreshness: 'unknown', referenceResolution: 'not-discovered', direction: 'source-to-target',
      targetNodeId: target.id, configuredNode: target.name }];
    const membership = topologyWorkspaceMembership(value, { mode: 'custom', pinnedNodeIds: new Set(), omittedNodeIds: new Set() });
    expect(membership.displayedNodeIds).toEqual(new Set([owner.id, target.id]));
    expect(membership.connectedNodeIds).toEqual(new Set([owner.id, target.id]));
  });

  it('retains pinned nodes absent from a partial refresh and excludes explicitly omitted nodes', () => {
    const inventory = Array.from({ length: 3 }, (_, index) => makeNode(index));
    const selected = { mode: 'all' as const, pinnedNodeIds: new Set([id('node:900')]), omittedNodeIds: new Set([inventory[0]!.id]) };
    const initial = topologyWorkspaceMembership(graph(inventory), selected);
    expect(initial.displayedNodeIds).toEqual(new Set([inventory[1]!.id, inventory[2]!.id, id('node:900')]));
    // An incomplete inventory does not clear either user intent or a retained pin.
    const refreshed = topologyWorkspaceMembership({ ...graph(inventory.slice(1)), completeness: { discovery: 'partial', schema: 'unknown', assignments: 'unknown' } }, selected);
    expect(refreshed.displayedNodeIds).toEqual(new Set([inventory[1]!.id, inventory[2]!.id, id('node:900')]));
    expect(refreshed.discoveredNodeIds).not.toContain(id('node:900'));
  });

  it('adds, removes, and resets presentation without changing graph nodes or edges', () => {
    const source = graph([makeNode(1)]);
    const pin = id('node:manual');
    const added = addTopologyWorkspaceNode({ mode: 'custom', pinnedNodeIds: new Set(), omittedNodeIds: new Set() }, pin);
    expect(topologyWorkspaceMembership(source, added).displayedNodeIds).toEqual(new Set([pin]));
    const removed = removeTopologyWorkspaceNode(added, source.nodes[0]!.id);
    expect(topologyWorkspaceMembership(source, removed).displayedNodeIds).toEqual(new Set([pin]));
    expect(removed.omittedNodeIds).toContain(source.nodes[0]!.id);
    expect(source.nodes).toHaveLength(1);
    expect(source.bindings).toEqual([]);
    expect(resetTopologyWorkspace()).toEqual({ mode: 'custom', pinnedNodeIds: new Set(), omittedNodeIds: new Set() });
  });

  it('pages and filters the full advertised palette past the old 451-entry boundary', () => {
    const nodes = Array.from({ length: 620 }, (_, index) => makeNode(index));
    const statusMap = new Map(nodes.map((node, index) => [node.id, { readability: index % 2 ? 'readable' as const : 'unreadable' as const, stale: false }]));
    const present = new Set([nodes[500]!.id]);
    const page = topologyPalettePage(graph(nodes), statusMap, present, { offset: 450, limit: 50 });
    expect(page.total).toBe(620);
    expect(page.entries).toHaveLength(50);
    expect(page.entries[0]?.name).toBe('Node 0450');
    expect(page.hasNext).toBe(true);
    expect(topologyPalettePage(graph(nodes), statusMap, present, { offset: 500, limit: 50 }).entries[0]?.present).toBe(true);
    const filtered = topologyPalettePage(graph(nodes), statusMap, present, { host: 'host-a', readability: 'readable', query: 'Node 05', limit: 200 });
    expect(filtered.entries.length).toBeGreaterThan(0);
    expect(filtered.entries.every(({ host, readability, name }) => host === 'host-a' && readability === 'readable' && name.includes('Node 05'))).toBe(true);
  });

  it('matches advertised-only and pending readability filters exactly', () => {
    const nodes = [makeNode(1), makeNode(2)];
    const statuses = new Map([[nodes[1]!.id, { readability: 'pending' as const, stale: false }]]);
    expect(topologyPalettePage(graph(nodes), statuses, new Set(), { readability: 'advertised-only' }).entries.map(entry => entry.id)).toEqual([nodes[0]!.id]);
    expect(topologyPalettePage(graph(nodes), statuses, new Set(), { readability: 'pending' }).entries.map(entry => entry.id)).toEqual([nodes[1]!.id]);
  });

  it('calls add for absent entries and centre for already-present entries', () => {
    const calls: Array<[TopologyNodeId, string]> = [];
    const callback = (nodeId: TopologyNodeId, action: 'add' | 'centre') => calls.push([nodeId, action]);
    activateTopologyPaletteEntry({ id: id('node:new'), present: false }, callback);
    activateTopologyPaletteEntry({ id: id('node:shown'), present: true }, callback);
    expect(calls).toEqual([[id('node:new'), 'add'], [id('node:shown'), 'centre']]);
  });
});

describe('topology workspace persistence', () => {
  it('migrates v1 positions and camera into host-scoped v2 membership state', () => {
    const storage = memoryStorage();
    storage.setItem(legacyTopologyLayoutStorageKey('https://alpha.example'), JSON.stringify({
      positions: { 'node:old': { x: 12, y: 24 } }, viewport: { x: 4, y: 5, scale: 1.25 }
    }));
    const migrated = readTopologyLayout('https://alpha.example', storage);
    expect(migrated.positions.get(id('node:old'))).toEqual({ x: 12, y: 24 });
    expect(migrated.viewport).toEqual({ x: 4, y: 5, scale: 1.25 });
    const focusRestoreState = { selectedNodeId: id('node:focus'), previousMode: 'overview' as const, previousSelectionType: 'binding' as const,
      previousSelectionId: 'binding:prior', previousViewport: { x: 3, y: 4, scale: 1.2 } };
    expect(writeTopologyLayout('https://alpha.example', { ...migrated, workspaceMode: 'all', pinnedNodeIds: new Set([id('node:manual')]),
      omittedNodeIds: new Set([id('node:hidden')]), autoPositionedNodeIds: new Set([id('node:auto')]), focusRestoreState,
      selectedNodeId: id('node:manual'), selectedSelection: { type: 'binding', id: 'binding:selected' }, preferences: { query: 'pump', labels: false } }, storage)).toBe(true);
    const restored = readTopologyLayout('https://alpha.example', storage);
    expect(restored).toMatchObject({ workspaceMode: 'all', selectedNodeId: id('node:manual'), preferences: { query: 'pump', labels: false } });
    expect(restored.pinnedNodeIds).toEqual(new Set([id('node:manual')]));
    expect(restored.omittedNodeIds).toEqual(new Set([id('node:hidden')]));
    expect(restored.autoPositionedNodeIds).toEqual(new Set([id('node:auto')]));
    expect(restored.focusRestoreState).toEqual(focusRestoreState);
    expect(restored.selectedSelection).toEqual({ type: 'binding', id: 'binding:selected' });
    expect(storage.getItem(topologyLayoutStorageKey('https://beta.example'))).toBeNull();
  });

  it('bounds persisted inventory-scale positions and membership', () => {
    const storage = memoryStorage();
    const positions = new Map(Array.from({ length: 2200 }, (_, index) => [id(`node:${index}`), { x: index, y: index }]));
    const pins = new Set(Array.from({ length: 2200 }, (_, index) => id(`node:${index}`)));
    expect(writeTopologyLayout('host', { positions, pinnedNodeIds: pins }, storage)).toBe(true);
    const restored = readTopologyLayout('host', storage);
    expect(restored.positions.size).toBe(2048);
    expect(restored.pinnedNodeIds?.size).toBe(2048);
  });
});
