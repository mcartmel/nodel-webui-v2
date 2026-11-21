import { bench, describe } from 'vitest';
import { placeTopologyNodes, type TopologyPlacementNode, type TopologyPlacementWire } from '../src/features/topology/topology-placement';
import type { TopologyNodeId } from '../src/features/topology/topology-model';

function nodeSet(count: number): TopologyPlacementNode[] {
  return Array.from({ length: count }, (_, index) => ({ id: `bench-${index}` as TopologyNodeId, width: 248, height: 160 }));
}

function wire(source: number, target: number): TopologyPlacementWire {
  return { source: `bench-${source}` as TopologyNodeId, target: `bench-${target}` as TopologyNodeId };
}

const smallNodes = nodeSet(24);
const smallPairs = [
  ...Array.from({ length: 23 }, (_, index) => wire(index, index + 1)),
  wire(0, 12),
];
const smallRows = smallPairs.flatMap((edge) => Array.from({ length: 4 }, () => edge));

const largeNodes = nodeSet(250);
const largePairs = [
  ...Array.from({ length: 249 }, (_, index) => wire(index, index + 1)),
  ...Array.from({ length: 251 }, (_, index) => wire(index, (index + 37) % 250)),
];

const retainedNodes = nodeSet(1001);
const retainedPositions = new Map<TopologyNodeId, { x: number; y: number }>(retainedNodes.map(({ id }, index) => [id, { x: (index % 32) * 300, y: Math.floor(index / 32) * 200 }]));
const retainedWires = Array.from({ length: 20_000 }, (_, index) => wire(index % 1000, (index + 1) % 1001));

describe('topology placement runtime benchmark (Node/browser-independent pure module)', () => {
  bench('initial ordered placement: 24 nodes, 24 unique pairs, 96 input wire rows', () => {
    placeTopologyNodes(smallNodes, smallRows, { mode: 'initial' });
  });

  bench('SCC condensation: 250 nodes, 500 unique pairs', () => {
    placeTopologyNodes(largeNodes, largePairs, { mode: 'auto' });
  });

  bench('incremental no-op: 1001 retained nodes, 20,000 wires', () => {
    placeTopologyNodes(retainedNodes, retainedWires, { mode: 'incremental', existingPositions: retainedPositions });
  });
});
