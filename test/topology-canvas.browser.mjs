/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({
  configFile: './vite.config.ts',
  server: { host: '127.0.0.1', port: 0, strictPort: false }
});
let browser;

try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not bind a TCP port');
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {})
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${address.port}/nodes.html`);
  await page.waitForTimeout(1500); // Allow Vite's initial X6 dependency optimization reload to finish.
  await page.evaluate(async () => {
    const { TopologyCanvas } = await import('/src/features/topology/topology-canvas.ts');
    const root = document.createElement('div');
    root.id = 'canvas-test-root';
    root.style.cssText = 'width:1000px;height:650px;position:relative';
    document.body.replaceChildren(root);
    const callbacks = { selectedNode: null, selectedWire: null, moved: null, viewport: null, sequence: [] };
    const canvas = new TopologyCanvas(root, {
      onNodeSelected: (id) => { callbacks.selectedNode = id; callbacks.sequence.push(['node', id]); },
      onWireSelected: (id) => { callbacks.selectedWire = id; callbacks.sequence.push(['wire', id]); },
      onNodeMoved: (id, point) => { callbacks.moved = { id, ...point }; callbacks.movedCount = (callbacks.movedCount ?? 0) + 1; },
      onViewportChanged: (viewport) => { callbacks.viewport = viewport; callbacks.viewportCount = (callbacks.viewportCount ?? 0) + 1; }
    });
    const nodes = [
      { id: 'domain/room:controller', title: '<img src=x onerror=alert(1)>', status: 'Reachable', summary: '2 actions · 1 event', position: { x: 100, y: 100 }, ports: [
        { id: 'remote/action:<alias>', label: '<svg onload=alert(1)>', direction: 'output' },
        { id: 'unused/local', label: 'Unused', direction: 'input' }
      ] },
      { id: 'domain/projector', title: 'Concierge Labs - Nodel Player — 東京 & <auxiliary panel> 0123456789', status: 'Discovered · a deliberately long readability status with diagnostics', summary: '1 action · 1 event · an intentionally long endpoint and connection summary', position: { x: 500, y: 120 }, ports: [
        { id: 'local/action/on', label: 'Power On', direction: 'input' },
        { id: 'local/event/state', label: 'State', direction: 'output' },
        ...Array.from({ length: 24 }, (_, index) => ({
          id: `dense/${index}`,
          label: `Dense endpoint ${index} — value & <meta>`,
          direction: index % 2 ? 'output' : 'input'
        }))
      ] }
    ];
    const wires = [
      { id: 'binding/action/first', source: { nodeId: nodes[0].id, portId: nodes[0].ports[0].id }, target: { nodeId: nodes[1].id, portId: nodes[1].ports[0].id }, label: '<alias>' },
      { id: 'binding/action/second', source: { nodeId: nodes[0].id, portId: nodes[0].ports[0].id }, target: { nodeId: nodes[1].id, portId: nodes[1].ports[0].id } },
      { id: 'binding/event/self', source: { nodeId: nodes[1].id, portId: nodes[1].ports[1].id }, target: { nodeId: nodes[1].id, portId: nodes[1].ports[1].id }, status: 'unresolved' },
      { id: 'binding/event/self-parallel', source: { nodeId: nodes[1].id, portId: nodes[1].ports[1].id }, target: { nodeId: nodes[1].id, portId: nodes[1].ports[1].id } }
    ];
    canvas.update({ nodes, wires });
    canvas.graph.on('edge:click', () => { callbacks.edgeEvents = (callbacks.edgeEvents ?? 0) + 1; });
    window.topologyAdapterTest = { canvas, callbacks, nodes, wires };
  });

  const state = await page.evaluate(() => {
    const { canvas } = window.topologyAdapterTest;
    const root = document.querySelector('#canvas-test-root');
    const svg = root.querySelector('svg');
    return {
      counts: canvas.getRenderedCounts(),
      text: svg.textContent,
      injected: Boolean(svg.querySelector('img,script,foreignObject')),
      wires: [...svg.querySelectorAll('.x6-edge')].length,
      paths: [...svg.querySelectorAll('.x6-edge .connection')].map((path) => path.getAttribute('d')),
      ports: [...svg.querySelectorAll('.x6-port circle')].map((port) => ({ ariaLabel: port.getAttribute('aria-label'), title: port.closest('.x6-port').querySelector('title')?.textContent, fill: getComputedStyle(port).fill })),
      portLabels: [...svg.querySelectorAll('.x6-port text')].map((label) => {
        const rect = label.getBoundingClientRect();
        const nodeRect = label.closest('.x6-node').querySelector('rect').getBoundingClientRect();
        return { text: label.querySelector('tspan')?.textContent ?? label.textContent, ariaLabel: label.getAttribute('aria-label'), rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, nodeRect: { left: nodeRect.left, right: nodeRect.right, top: nodeRect.top, bottom: nodeRect.bottom }, parent: label.closest('.x6-port').getAttribute('port') };
      }),
      nodeSizes: [...canvas.graph.getNodes()].map((cell) => cell.size()),
      nodeDetails: [...svg.querySelectorAll('.x6-node')].map((node) => ({ ariaLabel: node.querySelector('rect')?.getAttribute('aria-label'), title: node.querySelector('title')?.textContent })),
      visibleNodeLabels: [...svg.querySelectorAll('.x6-node text')].filter((label) => !label.closest('.x6-port')).map((label) => {
        const rect = label.getBoundingClientRect();
        const body = label.closest('.x6-node').querySelector('rect').getBoundingClientRect();
        return { text: label.querySelector('tspan')?.textContent ?? label.textContent, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, body: { left: body.left, right: body.right, top: body.top, bottom: body.bottom } };
      }),
      canvasSizing: { height: getComputedStyle(root).height, minHeight: getComputedStyle(root).minHeight },
      inlineTextCount: svg.querySelectorAll('text').length,
      edgeTextCount: svg.querySelectorAll('.x6-edge text').length,
      magnets: [...svg.querySelectorAll('[magnet]')].map((port) => port.getAttribute('magnet')),
      cssIsScoped: root.querySelector('style')?.textContent.includes('.nodel-topology-canvas .x6-graph') ?? false
    };
  });
  assert.deepEqual(state.counts, { nodes: 2, wires: 4, ports: 28 });
  assert.equal(state.wires, 4, 'parallel and self wires render as separate edges');
  assert.notEqual(state.paths[0], state.paths[1], 'parallel unbundled bindings receive separate native X6 lanes');
  assert.notEqual(state.paths[2], state.paths[3], 'parallel self loops receive signed, distinct native X6 lanes');
  const unchangedMutations = await page.evaluate(() => {
    const { canvas, nodes, wires } = window.topologyAdapterTest;
    const observer = new MutationObserver(() => {});
    observer.observe(document.querySelector('#canvas-test-root svg'), { childList: true, attributes: true, subtree: true });
    canvas.update(structuredClone({ nodes, wires }));
    const positions = new Map();
    for (const node of nodes) positions.set(node.id, node.position);
    canvas.setNodePositions(positions);
    const count = observer.takeRecords().length;
    observer.disconnect();
    return count;
  });
  assert.equal(unchangedMutations, 0, 'equal projections and positions leave mounted nodes, sockets and wire paths untouched');
  assert.ok(state.paths.every((path) => path && /[ML]/.test(path)), 'routed wires have explicit orthogonal segments');
  assert.ok(state.inlineTextCount > 0, 'node titles and socket endpoint names are visibly rendered');
  assert.equal(state.edgeTextCount, 0, 'wire labels remain absent from the diagram');
  assert.ok(state.nodeDetails[1].ariaLabel?.includes('Concierge Labs') && state.nodeDetails[1].title?.replaceAll('\u00a0', ' ').includes('deliberately long readability status'), `node details remain available to assistive technology and hover: ${JSON.stringify(state.nodeDetails[1])}`);
  assert.ok(state.portLabels.some((port) => port.text.includes('…') && port.ariaLabel === '<svg onload=alert(1)>' && port.rect.left >= port.nodeRect.left + 10 && port.rect.right <= port.nodeRect.right - 10), `socket labels truncate within the padded block and retain full accessibility: ${JSON.stringify(state.portLabels.slice(0, 2))}`);
  assert.ok(state.visibleNodeLabels.some((label) => label.text.replaceAll('\u00a0', ' ').includes('Concierge Labs') && label.rect.left >= label.body.left + 14 && label.rect.right <= label.body.right - 14), `node title remains visible, truncated and padded inside its block: ${JSON.stringify(state.visibleNodeLabels)}`);
  assert.ok(state.ports.some((port) => port.ariaLabel?.startsWith('input:') && port.fill === 'rgb(255, 255, 255)') && state.ports.some((port) => port.ariaLabel?.startsWith('output:') && port.fill !== 'rgb(255, 255, 255)'), `input and output types have distinct physical styling: ${JSON.stringify(state.ports.slice(0, 5))}`);
  assert.ok(state.nodeSizes.every((size) => size.height >= 106 && size.height <= 420));
  assert.equal(state.injected, false, 'untrusted labels are text rather than HTML');
  assert.equal(state.magnets.length, 28, 'all endpoint ports render');
  assert.ok(state.magnets.every((magnet) => magnet !== 'true'), 'no endpoint port is connectable');
  assert.equal(state.cssIsScoped, true);
  assert.equal(state.canvasSizing.height, '650px', 'adapter class does not override the component-provided host height');
  assert.equal(state.canvasSizing.minHeight, '0px', 'adapter class does not impose a viewport-independent minimum height');

  const themeColors = await page.evaluate(() => {
    const root = document.querySelector('#canvas-test-root');
      const node = root.querySelector('.x6-node');
    document.documentElement.style.setProperty('--nodel-surface', '240 20 10');
    document.documentElement.style.setProperty('--nodel-fg', '250 250 250');
      const lightOverride = { body: getComputedStyle(node.querySelector('rect')).fill };
    document.documentElement.style.setProperty('--nodel-surface', '32 32 32');
    document.documentElement.style.setProperty('--nodel-fg', '229 229 229');
      const dark = { body: getComputedStyle(node.querySelector('rect')).fill };
    const bodyRect = node.querySelector('rect').getBoundingClientRect();
    document.documentElement.style.removeProperty('--nodel-surface');
    document.documentElement.style.removeProperty('--nodel-fg');
      return { lightOverride, dark, bodyVisible: bodyRect.width > 0 };
  });
  assert.equal(themeColors.lightOverride.body, 'rgb(240, 20, 10)', 'SVG surface follows the active RGB theme token');
  assert.equal(themeColors.dark.body, 'rgb(32, 32, 32)', 'dark surface token remains visible in the graph');
  assert.equal(themeColors.bodyVisible, true, 'topology blocks remain visible under light and dark themes');
  await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' });
  const forcedColors = await page.locator('#canvas-test-root').evaluate((root) => ({
    active: matchMedia('(forced-colors: active)').matches,
    scopedRule: root.querySelector('style')?.textContent.includes('@media (forced-colors: active)') ?? false
  }));
  assert.equal(forcedColors.active, true, 'Chromium forced-colors emulation is active');
  assert.equal(forcedColors.scopedRule, true, 'canvas provides a scoped forced-colors treatment');
  await page.emulateMedia({ forcedColors: 'none' });

  await page.evaluate(() => {
    const root = document.querySelector('#canvas-test-root');
    root.style.width = '760px';
    root.style.height = '520px';
  });
  await page.waitForFunction(() => {
    const { canvas } = window.topologyAdapterTest;
    const area = canvas.graph.getGraphArea();
    return Math.abs(area.width - 760) < 1 && Math.abs(area.height - 520) < 1;
  });
  await page.evaluate(() => {
    const root = document.querySelector('#canvas-test-root');
    root.style.width = '1000px';
    root.style.height = '650px';
  });
  await page.waitForFunction(() => {
    const area = window.topologyAdapterTest.canvas.graph.getGraphArea();
    return Math.abs(area.width - 1000) < 1 && Math.abs(area.height - 650) < 1;
  });

  const cameraApi = await page.evaluate(() => {
    const { canvas } = window.topologyAdapterTest;
    const before = canvas.graph.getNodes().map((cell) => cell.getPosition());
    canvas.centerOnNode('domain/projector');
    const centered = canvas.getViewport();
    canvas.selectNode('domain/projector');
    const selectedNode = document.querySelectorAll('.x6-node.is-selected').length;
    canvas.selectWire('binding/action/first');
    const selectedWire = document.querySelectorAll('.x6-edge.is-selected').length;
    const acceptedScale = canvas.getViewport().scale;
    canvas.setViewport({ x: 0, y: 0, scale: 0.1 });
    const lowerRejected = canvas.getViewport().scale === acceptedScale;
    canvas.setViewport({ x: 0, y: 0, scale: 3 });
    const upperRejected = canvas.getViewport().scale === acceptedScale;
    canvas.fitToView();
    return { before, after: canvas.graph.getNodes().map((cell) => cell.getPosition()), centered, selectedNode, selectedWire, lowerRejected, upperRejected, fit: canvas.getViewport() };
  });
  assert.deepEqual(cameraApi.after, cameraApi.before, 'camera fit and center never move saved layout positions');
  assert.ok(Number.isFinite(cameraApi.centered.x) && cameraApi.centered.scale > 0);
  assert.equal(cameraApi.selectedNode, 1, 'public adapter API can select a node by domain ID');
  assert.equal(cameraApi.selectedWire, 1, 'public adapter API can select a wire by binding ID');
  assert.equal(cameraApi.lowerRejected, true, 'persisted zoom cannot drop below the interactive 0.25 threshold');
  assert.equal(cameraApi.upperRejected, true, 'persisted zoom cannot exceed the interactive 2.5 threshold');
  assert.ok(cameraApi.fit.scale <= 1, 'fit-to-view caps initial zoom at a legible scale');
  assert.ok(cameraApi.fit.scale >= 0.25, 'fit-to-view respects the wheel and persisted viewport minimum');
  const portApi = await page.evaluate(() => {
    const { canvas, nodes } = window.topologyAdapterTest;
    const domainPort = nodes[0].ports[0];
    canvas.selectPort(nodes[0].id, domainPort.id);
    const selected = document.querySelectorAll('.x6-port.is-selected').length;
    canvas.centerOnPort(nodes[0].id, domainPort.id);
    canvas.update({ nodes, wires: window.topologyAdapterTest.wires });
    const restored = document.querySelectorAll('.x6-port.is-selected').length;
    canvas.selectPort(null);
    const cleared = document.querySelectorAll('.x6-port.is-selected').length;
    return { selected, restored, cleared };
  });
  assert.deepEqual(portApi, { selected: 1, restored: 1, cleared: 0 }, 'selected port highlight survives updates and public navigation can center it');
  const viewportNotifications = await page.evaluate(() => {
    const { canvas, callbacks } = window.topologyAdapterTest;
    let before = callbacks.viewportCount ?? 0;
    canvas.setViewport({ x: 44, y: 20, scale: 1.2 });
    const programmatic = (callbacks.viewportCount ?? 0) - before;
    before = callbacks.viewportCount ?? 0;
    canvas.setViewport({ x: 48, y: 22, scale: 1.3 }, { notify: false });
    const restored = (callbacks.viewportCount ?? 0) - before;
    canvas.setViewport({ x: 0, y: 0, scale: 1 }, { notify: false });
    return { programmatic, restored };
  });
  assert.deepEqual(viewportNotifications, { programmatic: 1, restored: 0 }, 'programmatic camera updates notify once, persisted restores are silent');

  // Exercise actual user selection, movement, panning, zooming, and a rejected port drag.
  const node = page.locator('.x6-node').first();
  const nodeBox = await node.locator('rect').first().boundingBox();
  assert.ok(nodeBox);
  await page.mouse.click(nodeBox.x + 30, nodeBox.y + 22);
  await page.waitForFunction(() => window.topologyAdapterTest.callbacks.selectedNode === 'domain/room:controller');
  assert.equal(await page.locator('.x6-node.is-selected').count(), 1, 'node selection is visible');
  await page.mouse.move(nodeBox.x + 40, nodeBox.y + 48);
  await page.mouse.down();
  await page.mouse.move(nodeBox.x + 110, nodeBox.y + 100, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => window.topologyAdapterTest.callbacks.moved?.id === 'domain/room:controller');

  // Click every actual widened SVG hit path, including both separated parallel lanes.
  const wireHitPoints = await page.evaluate(() => {
    const canvas = window.topologyAdapterTest.canvas;
    const records = /** @type {{ id: string; samples: { x: number; y: number }[]; view: SVGGElement }[]} */ (canvas.graph.getEdges().map(edge => {
      const path = /** @type {SVGPathElement | null} */ (canvas.graph.findViewByCell(edge).container.querySelector('.connection-wrap'));
      if (!path) throw new Error('Every unbundled wire needs a physical SVG hit target.');
      const length = path.getTotalLength();
      const samples = Array.from({ length: 101 }, (_, index) => {
        const point = /** @type {DOMPoint} */ (path.getPointAtLength(length * (index + 1) / 102).matrixTransform(path.getScreenCTM()));
        return { x: point.x, y: point.y };
      });
      return { id: edge.getData().domainId, samples, view: /** @type {SVGGElement} */ (canvas.graph.findViewByCell(edge).container) };
    }));
    return records.map((record, recordIndex) => {
      let best = { x: 0, y: 0, separation: 0 };
      for (const point of record.samples) {
        const hitTarget = document.elementFromPoint(point.x, point.y);
        if (!hitTarget || !record.view.contains(hitTarget)) continue;
        const nearest = Math.min(...records.filter((_, index) => index !== recordIndex).flatMap(other => other.samples.map(candidate => Math.hypot(point.x - candidate.x, point.y - candidate.y))));
        if (nearest > best.separation) best = { x: point.x, y: point.y, separation: nearest };
      }
      if (!best.separation) throw new Error(`No unobstructed hit region for ${record.id}: ${record.view.querySelector('.connection-wrap').getAttribute('d')}`);
      return { id: record.id, ...best };
    });
  });
  assert.ok(wireHitPoints.every(hit => hit.separation > 8), `each parallel path has a unique physical hit region wider than its 16px half-hit radius: ${JSON.stringify(wireHitPoints)}`);
  for (const hit of wireHitPoints) {
    await page.mouse.click(Number(hit.x), Number(hit.y));
    await page.waitForFunction((id) => window.topologyAdapterTest.callbacks.selectedWire === id, hit.id, { timeout: 2500 })
      .catch(async () => { throw new Error(`Hit ${hit.id} at ${hit.x},${hit.y} (separation ${hit.separation}) selected ${await page.evaluate(() => window.topologyAdapterTest.callbacks.selectedWire)}`); });
  }
  assert.equal(await page.locator('.x6-edge.is-selected').count(), 1, 'wire selection is visible');
  const selectedWire = await page.evaluate(() => window.topologyAdapterTest.callbacks.selectedWire);
  assert.equal(await page.evaluate(() => window.topologyAdapterTest.callbacks.edgeEvents), wireHitPoints.length, 'physical hits reach the intended X6 edge for each distinct route');
  assert.deepEqual(await page.evaluate(() => window.topologyAdapterTest.callbacks.sequence.slice(-2)), [['node', null], ['wire', selectedWire]], 'wire click leaves its binding selected after clearing node selection');

  await page.evaluate(() => {
    const { canvas, nodes } = window.topologyAdapterTest;
    canvas.setNodePositions(new Map([[nodes[0].id, { x: 650, y: 100 }], [nodes[1].id, { x: 200, y: 100 }]]));
  });
  const reversedSource = page.locator('.x6-node').first().locator('rect').first();
  const reversedSourceBox = await reversedSource.boundingBox();
  assert.ok(reversedSourceBox);
  await page.mouse.move(reversedSourceBox.x + 70, reversedSourceBox.y + 25);
  await page.mouse.down();
  await page.mouse.move(reversedSourceBox.x + 90, reversedSourceBox.y + 25, { steps: 2 });
  await page.mouse.up();
  const reverseRoute = await page.evaluate(() => {
    const { canvas } = window.topologyAdapterTest;
    const edge = canvas.graph.getEdges().find(candidate => candidate.getData().domainId === 'binding/action/first');
    const sourceNode = edge.getSourceNode();
    const targetNode = edge.getTargetNode();
    const sourcePort = sourceNode.getPort(edge.getSourcePortId());
    const targetPort = targetNode.getPort(edge.getTargetPortId());
    const sourceView = canvas.graph.findViewByCell(sourceNode);
    const targetView = canvas.graph.findViewByCell(targetNode);
    const center = (element) => { const rect = element.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; };
    const path = canvas.graph.findViewByCell(edge).container.querySelector('.connection');
    const length = path.getTotalLength();
    const screenPoint = (at) => { const point = path.getPointAtLength(at).matrixTransform(path.getScreenCTM()); return { x: point.x, y: point.y }; };
    const start = screenPoint(0);
    const startAfter = screenPoint(Math.min(8, length / 4));
    const end = screenPoint(length);
    const endBefore = screenPoint(Math.max(0, length - 8));
    const sourceSocket = center(sourceView.findPortElem(edge.getSourcePortId()).querySelector('circle'));
    const targetSocket = center(targetView.findPortElem(edge.getTargetPortId()).querySelector('circle'));
    return {
      sourceDirection: sourcePort.group, targetDirection: targetPort.group,
      sourceNodeX: sourceNode.getPosition().x, targetNodeX: targetNode.getPosition().x,
      vertices: edge.getVertices(),
      start, startAfter, sourceSocket, end, endBefore, targetSocket
    };
  });
  assert.equal(reverseRoute.sourceDirection, 'output');
  assert.equal(reverseRoute.targetDirection, 'input');
  assert.ok(reverseRoute.sourceNodeX > reverseRoute.targetNodeX, 'the dragged source block is now to the right of its target');
  assert.ok(reverseRoute.vertices[0].x > reverseRoute.sourceNodeX + 248 && reverseRoute.vertices.at(-1).x < reverseRoute.targetNodeX, 'native Manhattan waypoints leave the source output and target input outside both card bodies');
  assert.ok(Math.abs(reverseRoute.start.x - reverseRoute.sourceSocket.x) < 2 && reverseRoute.startAfter.x > reverseRoute.start.x + 2, `output path exits the source card's right side: ${JSON.stringify(reverseRoute)}`);
  assert.ok(Math.abs(reverseRoute.end.x - reverseRoute.targetSocket.x) < 4 && reverseRoute.endBefore.x < reverseRoute.end.x - 2, `input path enters the target card's left side: ${JSON.stringify(reverseRoute)}`);
  await page.evaluate(() => window.topologyAdapterTest.canvas.setNodePositions(new Map([
    ['domain/room:controller', { x: 36, y: 36 }], ['domain/projector', { x: 346, y: 36 }]
  ])));

  const beforeGesture = await page.evaluate(() => window.topologyAdapterTest.canvas.getRenderedCounts());
  const output = page.locator('[magnet]').first();
  const input = page.locator('[magnet]').nth(2);
  const outputBox = await output.boundingBox();
  const inputBox = await input.boundingBox();
  assert.ok(outputBox && inputBox);
  await page.mouse.move(outputBox.x + outputBox.width / 2, outputBox.y + outputBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Delete');
  await page.mouse.click(1200, 760, { button: 'right' });
  const afterGesture = await page.evaluate(() => window.topologyAdapterTest.canvas.getRenderedCounts());
  assert.deepEqual(afterGesture, beforeGesture, 'connection, delete and context-menu gestures cannot mutate graph');

  await page.mouse.move(900, 580);
  const prePan = await page.evaluate(() => window.topologyAdapterTest.canvas.getViewport());
  await page.mouse.down();
  await page.mouse.move(930, 600, { steps: 3 });
  await page.mouse.up();
  const afterPan = await page.evaluate(() => window.topologyAdapterTest.canvas.getViewport());
  assert.ok(afterPan.x !== prePan.x || afterPan.y !== prePan.y, 'dragging blank canvas pans the viewport');
  await page.mouse.move(930, 600);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  const viewport = await page.evaluate(() => window.topologyAdapterTest.canvas.getViewport());
  assert.notEqual(viewport.scale, 1, 'ctrl-wheel changes the viewport scale');

  const identity = await page.evaluate(() => {
    const test = window.topologyAdapterTest;
    const canvas = test.canvas;
    const graph = canvas.graph;
    const firstCell = graph.getNodes()[0];
    const firstEdgeId = graph.getEdges()[0].id;
    const survivingPort = firstCell.getPorts()[0].id;
    const updated = test.nodes.map((entry, i) => i ? entry : {
      ...entry,
      title: 'Updated controller',
      position: { x: -999, y: -999 },
      ports: [entry.ports[0], { id: 'fresh port', label: 'fresh', direction: 'output' }]
    });
    canvas.update({ nodes: updated, wires: test.wires.filter((wire) => wire.id !== 'binding/action/second') });
    return {
      sameNode: graph.getNodes()[0] === firstCell,
      sameEdge: graph.getCellById(firstEdgeId) !== null,
      preservedPort: firstCell.hasPort(survivingPort),
      counts: canvas.getRenderedCounts(),
      position: firstCell.getPosition()
    };
  });
  assert.equal(identity.sameNode, true, 'refresh does not replace unchanged nodes');
  assert.equal(identity.sameEdge, true, 'unchanged edge identity survives an incremental update');
  assert.equal(identity.preservedPort, true, 'removing a neighboring port does not retarget the survivor');
  assert.deepEqual(identity.counts, { nodes: 2, wires: 3, ports: 28 });
  assert.ok(identity.position.x > 0, `refresh retains the user-dragged node position: ${JSON.stringify(identity.position)}`);

  const resetPosition = await page.evaluate(() => {
    const test = window.topologyAdapterTest;
    const movedCallbacks = test.callbacks.movedCount ?? 0;
    test.canvas.setNodePositions(new Map([[test.nodes[0].id, { x: 36, y: 36 }], [test.nodes[1].id, { x: 346, y: 36 }]]));
    const positions = test.canvas.graph.getNodes().map((cell) => cell.getPosition());
    test.canvas.update({ nodes: test.nodes, wires: test.wires });
    return { positions, afterRefresh: test.canvas.graph.getNodes().map((cell) => cell.getPosition()), movedCallbacks, movedAfter: test.callbacks.movedCount ?? 0 };
  });
  assert.deepEqual(resetPosition.positions, [{ x: 36, y: 36 }, { x: 346, y: 36 }], 'layout reset physically moves existing cells');
  assert.deepEqual(resetPosition.afterRefresh, resetPosition.positions, 'routine refresh preserves reset positions');
  assert.equal(resetPosition.movedAfter, resetPosition.movedCallbacks, 'programmatic reset positions do not masquerade as user moves');

  // Run the actual controller and projection into X6 against deterministic HTTP fixtures.
  let readMode = 'placeholder';
  let releaseAssignment;
  let assignmentArrived;
  const pendingAssignment = new Promise((resolve) => { assignmentArrived = resolve; });
  await page.route(/\/REST(?:\/(?:nodeURLs|actions|events|remote(?:\/schema)?))?$/, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/REST') {
      const nodes = readMode === 'placeholder' ? ['Owner'] : ['Owner', 'Display'];
      await route.fulfill({ json: { nodes: Object.fromEntries(nodes.map((name) => [name, { name }])) } });
    } else if (path === '/REST/nodeURLs') await route.fulfill({ json: [] });
    else if (/\/display\/REST\/actions$/i.test(path)) await route.fulfill({ json: { power: { name: 'Power On' } } });
    else if (/\/owner\/REST\/remote$/i.test(path)) {
      if (readMode === 'fail') {
        await new Promise((resolve) => { releaseAssignment = resolve; assignmentArrived(); });
        await route.fulfill({ status: 403, json: {} });
      } else await route.fulfill({ json: readMode === 'clear' ? {} : { actions: { go: { node: 'Display', action: 'POWER ON' }, unbound: {}, partial: { node: 'Display' } } } });
    } else await route.fulfill({ json: {} });
  });
  await page.evaluate(async () => {
    const { TopologyController } = await import('/src/features/topology/topology-controller.ts');
    const { presentTopology } = await import('/src/features/topology/topology-presentation.ts');
    const { canvas, callbacks } = window.topologyAdapterTest;
    const state = { mode: 'connected' };
    const positions = new Map();
    state.render = () => {
      const result = presentTopology(state.update.graph, positions, { query: '', showCandidates: true, showPlaceholders: true }, state.mode);
      state.projection = result.projection;
      canvas.update(state.projection);
    };
    state.readWire = () => {
      const [wire] = state.projection.wires;
      const [edge] = canvas.graph.getEdges();
      if (!wire || !edge) throw new Error('Expected a projected and rendered wire.');
      const terminal = (cell, id) => ({ nodeId: cell.getData().domainId, portId: cell.getPort(id).data.domainId });
      const path = /** @type {SVGPathElement | null} */ (canvas.graph.findViewByCell(edge).container.querySelector('.connection'));
      if (!path) throw new Error('Expected a rendered connection path.');
      return {
        wire, id: edge.id, domainId: edge.getData().domainId,
        source: terminal(edge.getSourceNode(), edge.getSourcePortId()), target: terminal(edge.getTargetNode(), edge.getTargetPortId()),
        dash: path.getAttribute('stroke-dasharray'),
        stroke: getComputedStyle(path).stroke
      };
    };
    state.wirePoint = () => {
      const [edge] = canvas.graph.getEdges();
      const view = canvas.graph.findViewByCell(edge).container;
      const path = /** @type {SVGPathElement} */ (view.querySelector('.connection-wrap'));
      let point;
      for (let index = 1; index < 100; index++) {
        const candidate = /** @type {DOMPoint} */ (path.getPointAtLength(path.getTotalLength() * index / 100).matrixTransform(path.getScreenCTM()));
        const hit = document.elementFromPoint(candidate.x, candidate.y);
        if (hit && view.contains(hit)) { point = candidate; break; }
      }
      if (!point) throw new Error(`No physically exposed portion of wire ${edge.getData().domainId}`);
      callbacks.selectedWire = null;
      return { x: point.x, y: point.y };
    };
    state.controller = new TopologyController((update) => { state.update = update; state.render(); });
    window.topologyAdapterTest.integrated = state;
    canvas.setViewport({ x: 0, y: 0, scale: 1 });
    state.controller.start();
  });
  const idle = () => page.waitForFunction(() => window.topologyAdapterTest.integrated.update.phase === 'idle');
  const readWire = async () => {
    const record = await page.evaluate(() => window.topologyAdapterTest.integrated.readWire());
    assert.deepEqual(record.source, record.wire.source, 'X6 source matches the directed projection');
    assert.deepEqual(record.target, record.wire.target, 'X6 target matches the directed projection');
    assert.equal(record.domainId, record.wire.id);
    return record;
  };
  const clickWire = async (bindingId) => {
    const hit = await page.evaluate(() => window.topologyAdapterTest.integrated.wirePoint());
    await page.mouse.click(Number(hit.x), Number(hit.y));
    await page.waitForFunction((id) => window.topologyAdapterTest.callbacks.selectedWire === id, bindingId, { timeout: 2500 })
      .catch(async () => { throw new Error(`Physical integrated wire hit ${bindingId} at ${hit.x},${hit.y} selected ${await page.evaluate(() => window.topologyAdapterTest.callbacks.selectedWire)}`); });
  };
  await idle();
  const placeholder = await readWire();
  assert.equal(placeholder.wire.status, 'unresolved');
  assert.equal(placeholder.stroke, 'rgb(146, 64, 14)', 'unresolved evidence retains the warning token instead of the neutral base stroke');
  await clickWire(placeholder.wire.id);
  await page.evaluate(() => { const state = window.topologyAdapterTest.integrated; state.mode = 'compact'; state.render(); });
  const compact = await readWire();
   assert.equal(compact.id, placeholder.id, `compact transition preserves opaque wire identity (${placeholder.id}/${placeholder.domainId} -> ${compact.id}/${compact.domainId})`);
  assert.equal(await page.locator('.x6-edge.is-selected').count(), 1, 'recreated cell keeps selected styling');
  assert.notEqual(compact.source.portId, placeholder.source.portId);
  assert.notEqual(compact.target.portId, placeholder.target.portId);
  await page.evaluate(() => { const state = window.topologyAdapterTest.integrated; state.mode = 'connected'; state.render(); });
  const connected = await readWire();
  assert.equal(connected.id, placeholder.id, 'returning to Connected restores wire identity');
  assert.deepEqual(connected.source, placeholder.source, 'returning to Connected restores the exact source terminal');
  assert.deepEqual(connected.target, placeholder.target, 'returning to Connected restores the exact target terminal');

  readMode = 'discovered';
  await page.evaluate(() => window.topologyAdapterTest.integrated.controller.refresh());
  await idle();
  const resolved = await readWire();
  assert.equal(resolved.id, placeholder.id, `placeholder promotion preserves wire identity (${placeholder.id}/${placeholder.domainId} -> ${resolved.id}/${resolved.domainId})`);
  assert.deepEqual(resolved.target, resolved.wire.target, 'resolved physical target remains the exact directed projected terminal');
  assert.equal(resolved.wire.status, undefined);
  await page.evaluate(() => {
    const { canvas, integrated } = window.topologyAdapterTest;
    const [edge] = canvas.graph.getEdges();
    const sourceView = canvas.graph.findViewByCell(edge.getSourceNode());
    integrated.cell = edge;
    integrated.port = sourceView.container.querySelector('[magnet]');
  });
  readMode = 'fail';
  await page.evaluate(() => window.topologyAdapterTest.integrated.controller.refresh());
  await page.waitForFunction(() => window.topologyAdapterTest.integrated.projection.wires[0]?.status === 'pending');
  await page.evaluate(() => window.topologyAdapterTest.canvas.selectWire(null));
  await page.mouse.move(1200, 750);
  const pending = await readWire();
  assert.deepEqual(pending.target, resolved.target);
  assert.equal(pending.wire.status, 'pending');
  assert.equal(pending.dash, '1 4');
  assert.equal(pending.stroke, 'rgb(7, 89, 133)', 'cached assignment evidence uses its separate accent treatment');
  await pendingAssignment;
  releaseAssignment();
  await idle();
  const stale = await readWire();
  assert.deepEqual(stale.target, resolved.target);
  assert.equal(stale.wire.status, 'stale');
  assert.equal(stale.dash, '7 3');
  assert.equal(stale.stroke, 'rgb(146, 64, 14)', 'stale evidence remains visibly distinct from cached/pending evidence');
  assert.deepEqual(await readWire(), stale, 'evidence updates retain the exact directed physical terminals');
  readMode = 'discovered';
  await page.evaluate(() => window.topologyAdapterTest.integrated.controller.refresh());
  await idle();
  const fresh = await readWire();
  assert.equal(fresh.id, resolved.id);
  assert.deepEqual(fresh.source, resolved.source);
  assert.deepEqual(fresh.target, resolved.target, 'fresh evidence resets stale styling without changing terminals');
  assert.equal(fresh.stroke, 'rgb(82, 82, 82)', 'fresh evidence returns to the neutral wire style');
  readMode = 'clear';
  await page.evaluate(() => window.topologyAdapterTest.integrated.controller.refresh());
  await idle();
  assert.deepEqual(await page.evaluate(() => window.topologyAdapterTest.canvas.getRenderedCounts()), { nodes: 2, wires: 0, ports: 0 });
  await page.evaluate(() => {
    const { canvas, integrated, nodes, wires } = window.topologyAdapterTest;
    integrated.controller.dispose();
    canvas.update({ nodes, wires });
  });

  await page.evaluate(() => {
    const other = document.createElement('div');
    other.id = 'second-canvas';
    other.style.cssText = 'width:400px;height:300px';
    document.body.append(other);
    const second = new window.topologyAdapterTest.canvas.constructor(other);
    second.update({ nodes: [{ id: 'isolated', title: 'Isolated', status: 'Ready', summary: '', position: { x: 10, y: 10 }, ports: [] }], wires: [] });
    window.topologyAdapterTest.second = second;
  });
  assert.deepEqual(await page.evaluate(() => window.topologyAdapterTest.second.getRenderedCounts()), { nodes: 1, wires: 0, ports: 0 });
  assert.deepEqual(await page.evaluate(() => window.topologyAdapterTest.canvas.getRenderedCounts()), { nodes: 2, wires: 4, ports: 28 });
  await page.evaluate(() => window.topologyAdapterTest.second.dispose());

  const groupFrame = await page.evaluate(() => {
    const root = document.createElement('div');
    root.id = 'group-frame-canvas';
    root.style.cssText = 'width:400px;height:300px;position:relative';
    document.body.append(root);
    const canvas = new window.topologyAdapterTest.canvas.constructor(root);
    const nodes = [
      { id: 'group-a', title: 'Group A', status: 'Discovered', summary: '', position: { x: 0, y: 0 }, ports: [{ id: 'out', label: 'Out', direction: 'output' }] },
      { id: 'group-b', title: 'Group B', status: 'Discovered', summary: '', position: { x: 100, y: 0 }, ports: [{ id: 'in', label: 'In', direction: 'input' }] },
      { id: 'far-away', title: 'Isolated', status: 'Discovered', summary: '', position: { x: 5000, y: 0 }, ports: [] }
    ];
    canvas.update({ nodes, wires: [{ id: 'group-link', source: { nodeId: 'group-a', portId: 'out' }, target: { nodeId: 'group-b', portId: 'in' } }] });
    canvas.frameConnectedGroup('group-a', { padding: 20, minScale: 0.25, maxScale: 1 });
    const viewport = canvas.getViewport();
    const isolated = canvas.graph.getNodes().find((node) => node.getData().domainId === 'far-away');
    const isolatedScreenX = isolated.getPosition().x * viewport.scale + viewport.x;
    canvas.dispose();
    root.remove();
    return { viewport, isolatedScreenX };
  });
  assert.equal(groupFrame.viewport.scale, 1, 'connected group framing uses a bounded legible scale');
  assert.equal(groupFrame.viewport.x + 174 * groupFrame.viewport.scale, 200, 'connected group is centred in the viewport');
  assert.ok(groupFrame.isolatedScreenX > 1000, 'disconnected nodes stay outside the connected-group camera frame');

  const overflowLayout = await page.evaluate(() => {
    const root = document.createElement('div');
    root.id = 'overflow-canvas';
    root.style.cssText = 'width:900px;height:600px;position:relative';
    document.body.append(root);
    const canvas = new window.topologyAdapterTest.canvas.constructor(root);
    const endpoints = Array.from({ length: 160 }, (_, index) => ({
      id: `dense/${index}`, label: `Searchable endpoint ${index} — descriptive name`, direction: index % 2 ? 'output' : 'input'
    }));
    const nodes = [
      { id: 'high-degree', title: 'High-degree inventory node', status: 'Discovered', summary: '160 endpoints', position: { x: 50, y: 20 }, ports: endpoints },
      { id: 'sink', title: 'Sink', status: 'Discovered', summary: '', position: { x: 600, y: 20 }, ports: [{ id: 'in', label: 'Sink input', direction: 'input' }] }
    ];
    canvas.update({ nodes, wires: [{ id: 'dense-wire', source: { nodeId: 'high-degree', portId: 'dense/159' }, target: { nodeId: 'sink', portId: 'in' } }] });
    const dense = canvas.graph.getNodes().find(node => node.getData().domainId === 'high-degree');
    const view = canvas.graph.findViewByCell(dense);
    const labels = () => dense.getPorts().map(port => {
      const element = view.findPortElem(port.id);
      const group = element.closest('.x6-port');
      const text = group.querySelector('text');
      const rect = text.getBoundingClientRect();
      const socket = /** @type {SVGCircleElement} */ (group.querySelector('circle'));
      const socketRect = socket.getBoundingClientRect();
      return { id: port.data.domainId, direction: port.group, label: text.querySelector('tspan')?.textContent ?? text.textContent, ariaLabel: text.getAttribute('aria-label'), rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }, socket: { display: getComputedStyle(socket).display, x: socketRect.x + socketRect.width / 2, y: socketRect.y + socketRect.height / 2 } };
    });
    const initialLabels = labels();
    const size = dense.size();
    const nodeText = [...view.container.querySelectorAll('text')].map(text => text.textContent).join(' ');
    canvas.selectPort('high-degree', 'dense/158');
    const selected = labels().find(port => port.id === 'dense/158');
    const edge = canvas.graph.getEdges()[0];
    const endpoint = (cell, portId) => ({ nodeId: cell.getData().domainId, portId: cell.getPort(portId).data.domainId });
    const terminals = { source: endpoint(edge.getSourceNode(), edge.getSourcePortId()), target: endpoint(edge.getTargetNode(), edge.getTargetPortId()) };
    canvas.centerOnPort('high-degree', 'dense/158');
    window.topologyAdapterTest.overflow = { canvas, root };
    return { size, nodeText, initialLabels, selected, terminals, selectedPortCount: root.querySelectorAll('.x6-port.is-selected').length };
  });
  assert.equal(overflowLayout.size.height, 420, 'high-degree node is capped at the adapter presentation limit');
  const overflowNodeText = overflowLayout.nodeText.replaceAll('\u00a0', ' ');
  assert.ok(overflowNodeText.includes('+160 more') && overflowNodeText.includes('Inspector → Endpoints'), `node displays an endpoint overflow count with a searchable-inspector action: ${overflowLayout.nodeText}`);
  const visibleOverflowLabels = overflowLayout.initialLabels.filter(port => port.rect.right > port.rect.left && port.rect.bottom > port.rect.top);
  assert.ok(visibleOverflowLabels.length < 160 && visibleOverflowLabels.length > 20, `bounded endpoint labels keep the dense node readable while exposing a page of names (${visibleOverflowLabels.length}): ${JSON.stringify(visibleOverflowLabels.slice(0, 4))}`);
  const visibleSockets = overflowLayout.initialLabels.filter(port => port.socket.display !== 'none');
  assert.ok(visibleSockets.length < 40 && visibleSockets.length > 20, 'dense endpoints are represented by distinct count-bearing grouped anchors, not stacked 10px sockets');
  for (const direction of ['input', 'output']) {
    const rows = visibleOverflowLabels.filter(port => port.direction === direction).sort((left, right) => left.rect.top - right.rect.top);
    assert.ok(rows.slice(1).every((port, index) => port.rect.top >= rows[index].rect.bottom), `${direction} labels have non-overlapping rows inside the height-capped block: ${JSON.stringify(rows.map(port => port.rect))}`);
    const sockets = visibleSockets.filter(port => port.direction === direction).sort((left, right) => left.socket.y - right.socket.y);
    assert.ok(sockets.slice(1).every((port, index) => port.socket.y - sockets[index].socket.y >= 10), `${direction} grouped socket anchors have distinct physical centers`);
  }
  assert.equal(overflowLayout.selectedPortCount, 1, 'the selected hidden endpoint receives a visible physical highlight');
  assert.equal(overflowLayout.selected.ariaLabel, 'Searchable endpoint 158 — descriptive name', 'selecting an overflow endpoint reveals its exact accessible name');
  assert.ok(overflowLayout.selected.label.includes('Searchable') && overflowLayout.selected.label.includes('…'), 'selected endpoint label is physically visible and width-truncated');
  assert.deepEqual(overflowLayout.terminals, { source: { nodeId: 'high-degree', portId: 'dense/159' }, target: { nodeId: 'sink', portId: 'in' } }, 'overflow presentation keeps wire terminal IDs and direction exact');
  await page.evaluate(() => { const { canvas, root } = window.topologyAdapterTest.overflow; canvas.dispose(); root.remove(); });

  await page.evaluate(() => {
    const root = document.createElement('div');
    root.id = 'drag-invalidation-canvas';
    root.style.cssText = 'width:1000px;height:650px;position:relative';
    document.body.append(root);
    const canvas = new window.topologyAdapterTest.canvas.constructor(root, {
      onWireSelected: id => { window.topologyAdapterTest.dragInvalidation.selectedWire = id; }
    });
    const dragState = { canvas, root, wires: [], selectedWire: null, nodeMovedEvents: 0 };
    canvas.graph.on('node:moved', () => { dragState.nodeMovedEvents++; });
    const nodes = [
      { id: 'route-a', title: 'Route A', status: 'Discovered', summary: '', position: { x: 30, y: 140 }, ports: [{ id: 'out', label: 'A out', direction: 'output' }] },
      { id: 'route-b', title: 'Route B', status: 'Discovered', summary: '', position: { x: 660, y: 140 }, ports: [{ id: 'in', label: 'B in', direction: 'input' }] },
      { id: 'obstacle-c', title: 'Obstacle C', status: 'Discovered', summary: '', position: { x: 330, y: 420 }, ports: [{ id: 'out', label: 'C out', direction: 'output' }] }
    ];
    const wires = [{ id: 'route-a-b', source: { nodeId: 'route-a', portId: 'out' }, target: { nodeId: 'route-b', portId: 'in' } }];
    canvas.update({ nodes, wires });
    dragState.wires = wires;
    window.topologyAdapterTest.dragInvalidation = dragState;
  });
  const obstacleState = await page.evaluate(() => {
    const { canvas, root } = window.topologyAdapterTest.dragInvalidation;
    const path = /** @type {SVGPathElement} */ (root.querySelector('.x6-edge .connection'));
    const obstacle = [...canvas.graph.getNodes()].find(node => node.getData().domainId === 'obstacle-c');
    const body = canvas.graph.findViewByCell(obstacle).container.querySelector('rect').getBoundingClientRect();
    const intersects = (path, body) => {
      const length = path.getTotalLength();
      const transform = path.getScreenCTM();
      return Array.from({ length: Math.min(512, Math.ceil(length / 4)) + 1 }, (_, index) => path.getPointAtLength(length * index / Math.min(512, Math.ceil(length / 4))).matrixTransform(transform))
        .some(point => point.x >= body.left && point.x <= body.right && point.y >= body.top && point.y <= body.bottom);
    };
    return { initialPath: path.getAttribute('d'), initialCrossing: intersects(path, body) };
  });
  assert.equal(obstacleState.initialCrossing, false, 'the initial unrelated obstacle does not overlap the directed route');
  const obstacleNode = page.locator('#drag-invalidation-canvas .x6-node').nth(2);
  await obstacleNode.scrollIntoViewIfNeeded();
  const obstacleBox = await obstacleNode.locator('rect').first().boundingBox();
  assert.ok(obstacleBox);
  await page.mouse.move(obstacleBox.x + 100, obstacleBox.y + 28);
  await page.mouse.down();
  await page.mouse.move(obstacleBox.x + 110, obstacleBox.y - 192, { steps: 8 });
  await page.mouse.up();
  const rerouted = await page.evaluate(() => {
    const { canvas, root } = window.topologyAdapterTest.dragInvalidation;
    const path = /** @type {SVGPathElement} */ (root.querySelector('.x6-edge .connection'));
    const obstacle = [...canvas.graph.getNodes()].find(node => node.getData().domainId === 'obstacle-c');
    const body = canvas.graph.findViewByCell(obstacle).container.querySelector('rect').getBoundingClientRect();
    const length = path.getTotalLength();
    const transform = path.getScreenCTM();
    let crossesBounds = false;
    for (let index = 0, count = Math.min(512, Math.ceil(length / 4)); index <= count; index++) {
      const point = path.getPointAtLength(length * index / count).matrixTransform(transform);
      if (point.x >= body.left && point.x <= body.right && point.y >= body.top && point.y <= body.bottom) { crossesBounds = true; break; }
    }
    return { path: path.getAttribute('d'), crossesBounds, moved: obstacle.getPosition(), localRouting: canvas.localRouting, nodeMovedEvents: window.topologyAdapterTest.dragInvalidation.nodeMovedEvents };
  });
  assert.deepEqual(rerouted.moved, { x: 340, y: 200 }, 'the unrelated node was actually dragged across the route');
  assert.equal(rerouted.localRouting, false, 'the bounded obstacle recheck exercises the small-diagram router');
  assert.ok(rerouted.nodeMovedEvents > 0, 'X6 reports the completed unrelated node drag');
  assert.equal(rerouted.crossesBounds, false, 'rerouted nonincident path clears the newly moved card body');
  assert.notEqual(rerouted.path, obstacleState.initialPath, 'drag-end invalidation replaces the old nonincident X6 route');
  const obstacleHit = await page.evaluate(() => {
    const { canvas } = window.topologyAdapterTest.dragInvalidation;
    const view = canvas.graph.findViewByCell(canvas.graph.getEdges()[0]).container;
    const path = /** @type {SVGPathElement} */ (view.querySelector('.connection-wrap'));
    const length = path.getTotalLength();
    for (let index = 1; index < 100; index++) {
      const point = path.getPointAtLength(length * index / 100).matrixTransform(path.getScreenCTM());
      const hit = document.elementFromPoint(point.x, point.y);
      if (hit && view.contains(hit)) return { x: point.x, y: point.y, id: canvas.graph.getEdges()[0].getData().domainId };
    }
    throw new Error('Rerouted nonincident edge has no visible physical hit region.');
  });
  await page.mouse.click(obstacleHit.x, obstacleHit.y);
  await page.waitForFunction(id => window.topologyAdapterTest.dragInvalidation.selectedWire === id, obstacleHit.id);
  await page.evaluate(() => { const { canvas, root } = window.topologyAdapterTest.dragInvalidation; canvas.dispose(); root.remove(); });

  const asyncSelection = await page.evaluate(async () => {
    const root = document.createElement('div');
    root.id = 'async-selection-canvas';
    root.style.cssText = 'width:900px;height:600px;position:relative';
    document.body.append(root);
    const canvas = new window.topologyAdapterTest.canvas.constructor(root);
    const nodes = Array.from({ length: 25 }, (_, index) => ({
      id: `async-${index}`, title: `Async node ${index}`, status: 'Discovered', summary: '',
      position: { x: (index % 5) * 160, y: Math.floor(index / 5) * 100 },
      ports: [{ id: 'output', label: `Async output ${index}`, direction: 'output' }]
    }));
    canvas.selectPort('async-24', 'output');
    const renderedSelection = new Promise((resolve, reject) => {
      const check = (view) => {
        if (view && view.cell.getData().domainId !== 'async-24') return false;
        const port = root.querySelector('.x6-port.is-selected');
        if (!port) return false;
        canvas.graph.off('view:mounted', onMounted);
        canvas.graph.off('render:done', onRendered);
        clearTimeout(timeout);
        resolve({ selectedCount: root.querySelectorAll('.x6-port.is-selected').length, portLabel: port.querySelector('text')?.getAttribute('aria-label'), restoredOnMount: true });
        return true;
      };
      const onMounted = ({ view }) => {
        if (view.cell.getData().domainId === 'async-24') requestAnimationFrame(() => check(view));
      };
      const onRendered = () => { requestAnimationFrame(() => check()); };
      const timeout = setTimeout(() => reject(new Error(`X6 mounted/rendered the selected node without restoring the selected endpoint: selected=${canvas.selectedPortKey}, domain=${canvas.selectedPortNodeId}, nodes=${canvas.graph.getNodes().map(node => node.getData().domainId).join(',')}, ports=${root.querySelectorAll('.x6-port').length}, highlights=${root.querySelectorAll('.x6-port.is-selected').length}`)), 5000);
      canvas.graph.on('view:mounted', onMounted);
      canvas.graph.on('render:done', onRendered);
    });
    canvas.update({ nodes, wires: [] });
    const mountedSelection = root.querySelector('.x6-port.is-selected');
    const result = mountedSelection
      ? { selectedCount: root.querySelectorAll('.x6-port.is-selected').length, portLabel: mountedSelection.querySelector('text')?.getAttribute('aria-label'), restoredOnMount: false }
      : await renderedSelection;
    const asyncEnabled = canvas.graph.options.async;
    canvas.dispose();
    root.remove();
    return { ...result, asyncEnabled };
  });
  assert.equal(asyncSelection.asyncEnabled, true, 'large topology uses X6 asynchronous cell rendering');
  assert.equal(asyncSelection.selectedCount, 1, 'render:done restores an endpoint selection requested before its X6 view mounted');
  assert.equal(asyncSelection.portLabel, 'Async output 24');
  assert.equal(asyncSelection.restoredOnMount, true, 'selection was restored by an X6 mount/render event rather than a later polling lookup');

  await page.evaluate(() => {
    const { canvas } = window.topologyAdapterTest;
    canvas.dispose();
  });
  assert.equal(await page.locator('.x6-graph').count(), 0, 'teardown removes X6 listeners and graph DOM');
  assert.equal(await page.locator('#canvas-test-root style').count(), 0, 'teardown removes adapter-owned scoped CSS');
  process.stdout.write('Topology canvas browser qualification passed in Chromium.\n');
} finally {
  await browser?.close();
  await server.close();
}
