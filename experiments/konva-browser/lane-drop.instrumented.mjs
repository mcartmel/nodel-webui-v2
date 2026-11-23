import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'vite';

// This alternate Konva-only bundle is never written to a release directory.
const root = fileURLToPath(new URL('../../', import.meta.url));
const outDir = '/tmp/kilo/konva-final-instrumented-20261123';
const once = (source, anchor, replacement) => {
  if (source.split(anchor).length !== 2) throw new Error(`Missing or ambiguous instrumentation anchor: ${anchor}`);
  return source.replace(anchor, replacement);
};
await build({
  configFile: resolve(root, 'vite.konva.config.ts'),
  build: { outDir },
  plugins: [{
    name: 'lane-drop-test-only-probes',
    enforce: 'pre',
    transform(source, id) {
      if (id.endsWith('/src/experiments/konva-canvas/lane-reservations.ts')) {
        // Stress the real browser-bundled allocator at both limits, separate
        // from physical drops and without painting hundreds of test cards.
        return `${source}
globalThis.__laneCapProbe = () => {
  const card = (id, x, y, side) => ({ id, name: id, x, y, width: 218,
    ports: [{ id: '0', label: '0', side, direction: side === 'right' ? 'out' : 'in' }] });
  const nodes = new Map([['common', card('common', 0, 0, 'right')]]);
  const wires = Array.from({ length: 600 }, (_, index) => {
    const id = 'target' + index;
    nodes.set(id, card(id, -200, 400 + 100 * index, 'left'));
    return { id: 'w' + index, from: { nodeId: 'common', portId: '0' }, to: { nodeId: id, portId: '0' } };
  });
  const reservations = new LocalLaneReservations();
  reservations.seed(wires, nodes);
  const counts = ({ descriptors, ...counts }) => counts;
  const single = counts(reservations.settle([{ ...wires[599], id: 'new' }], nodes));
  reservations.remove('new');
  const batch = counts(reservations.settle(wires.slice(0, 60), nodes));
  return { limits: LANE_LIMITS, single, batch };
};`;
      }
      if (!id.endsWith('/src/experiments/konva-canvas/main.ts')) return;
      source = once(source, 'function updateWireGeometry(edge: FixtureEdge): boolean {',
        'function updateWireGeometry(edge: FixtureEdge): boolean {\n  globalThis.__laneLedger?.geometry(edge.id, false);');
      source = once(source, '  wireGeometry.set(edge.id, { curves, arrow });',
        '  globalThis.__laneLedger?.geometry(edge.id, true);\n  wireGeometry.set(edge.id, { curves, arrow });');
      source = once(source, '  const result = laneReservations.settle(edges, nodeById);',
        '  globalThis.__laneTaskMark?.("settle-start");\n  const result = laneReservations.settle(edges, nodeById);\n  globalThis.__laneTaskMark?.("allocator-end");\n  globalThis.__laneLedger?.settle("drop", edges, result);');
      source = once(source, '  // Keep stats local to this allocator result;',
        '  globalThis.__laneTaskMark?.("settle-end");\n  // Keep stats local to this allocator result;');
      source = once(source, '    const settlement = laneReservations.settle(settlementEdges, nodeById);',
        '    const settlement = laneReservations.settle(settlementEdges, nodeById);\n    globalThis.__laneLedger?.settle("enrichment", settlementEdges, settlement);');
      return source;
    },
  }],
});
