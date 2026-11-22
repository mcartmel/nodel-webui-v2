import Konva from 'konva';
import './style.css';
import { getStoredTheme, getSystemThemeMediaQuery, isNodelTheme, storeTheme, THEME_STORAGE_KEY, type NodelTheme } from '../../theme/theme';
import {
  CARD_HEADER_HEIGHT, FIXTURE_NODE_COUNTS, PORTS_TOP, PORT_ROW_HEIGHT, cardHeight, createFixture, curveArrow, edgeCurves,
  type Curve, type FixtureEdge, type FixtureNode, type FixtureNodeCount
} from './fixture';
import type { LocalGraphProjection } from './local-projection';
import { graphBounds, selectionChanges, type Selection } from './camera-selection';

const host = document.querySelector<HTMLElement>('#diagram');
const failure = host?.querySelector<HTMLElement>('.canvas-failure');
const stageHost = document.createElement('div');
stageHost.className = 'canvas-stage';
if (host) host.append(stageHost);

let colors = readColors();
const requestedNodeCount = Number(new URLSearchParams(window.location.search).get('nodes'));
const nodeCount: FixtureNodeCount = FIXTURE_NODE_COUNTS.includes(requestedNodeCount as FixtureNodeCount) ? requestedNodeCount as FixtureNodeCount : 9;
const localMode = new URLSearchParams(window.location.search).get('source') === 'local';
const sizeSelect = document.querySelector<HTMLSelectElement>('[data-node-count]');
if (sizeSelect) sizeSelect.value = localMode ? 'local' : String(nodeCount);
if (localMode) {
  const summary = document.querySelector<HTMLElement>('[data-fixture-summary]');
  if (summary) summary.textContent = 'Loading local configuration…';
}

const onSizeChange = () => {
  if (!sizeSelect) return;
  const url = new URL(window.location.href);
  if (sizeSelect.value === 'local') {
    url.searchParams.set('source', 'local');
    url.searchParams.delete('nodes');
  } else if (FIXTURE_NODE_COUNTS.some((count) => String(count) === sizeSelect.value)) {
    url.searchParams.delete('source');
    url.searchParams.set('nodes', sizeSelect.value);
  } else {
    return;
  }
  window.location.assign(url);
};
sizeSelect?.addEventListener('change', onSizeChange);
let nodes: FixtureNode[] = [];
let edges: FixtureEdge[] = [];
let authoredNodes: readonly FixtureNode[] = [];
const nodeById = new Map<string, FixtureNode>();
const edgeById = new Map<string, FixtureEdge>();
const incidentEdges = new Map<string, Set<string>>();
const wireGeometry = new Map<string, { curves: Curve[]; arrow: ReturnType<typeof curveArrow> }>();
let authoredWorldBounds: ReturnType<typeof graphBounds>;

let stage: Konva.Stage | undefined;
let wireLayer: Konva.Layer | undefined;
let cardLayer: Konva.Layer | undefined;
let selectedNode: string | undefined;
let selectedEdge: string | undefined;
let viewportWidth = 0;
let viewportHeight = 0;
const cardGroups = new Map<string, Konva.Group>();
const socketShapes = new Map<string, Konva.Circle>();

function readColors(): { surface: string; foreground: string; muted: string; border: string; accent: string; grid: string; wire: string; action: string; actionStrong: string; event: string; eventStrong: string } {
  const style = getComputedStyle(document.documentElement);
  const resolve = (token: string, fallback: string) => style.getPropertyValue(token).trim() || fallback;
  return {
    surface: `rgb(${resolve('--nodel-surface', '255 255 255')})`,
    foreground: `rgb(${resolve('--nodel-fg', '32 42 53')})`,
    muted: `rgb(${resolve('--nodel-muted', '102 116 130')})`,
    border: `rgb(${resolve('--nodel-border', '215 222 229')})`,
    accent: `rgb(${resolve('--nodel-accent', '40 115 200')})`,
    grid: `rgb(${resolve('--nodel-border', '215 222 229')})`,
    wire: `rgb(${resolve('--nodel-muted', '116 132 148')})`,
    action: `rgb(${resolve('--nodel-topology-action', '37 99 235')})`,
    actionStrong: `rgb(${resolve('--nodel-topology-action-strong', '29 78 216')})`,
    event: `rgb(${resolve('--nodel-topology-event', '13 148 136')})`,
    eventStrong: `rgb(${resolve('--nodel-topology-event-strong', '15 118 110')})`
  };
}

function wireColor(edge: FixtureEdge, selected = false): string {
  if (edge.bindingKind === 'action') return selected ? colors.actionStrong : colors.action;
  if (edge.bindingKind === 'event') return selected ? colors.eventStrong : colors.event;
  return selected ? colors.accent : colors.wire;
}

function socketColor(port: FixtureNode['ports'][number], highlighted: boolean): { fill: string; stroke: string } {
  const localEndpoint = port.localKind === 'local-action' || port.localKind === 'local-event';
  if (highlighted) {
    const selected = selectedEdge ? edgeById.get(selectedEdge) : undefined;
    const hue = selected ? wireColor(selected, true) : colors.accent;
    // Preserve the synthetic benchmark's legacy filled selection treatment.
    if (!port.localKind) return { fill: hue, stroke: hue };
    return { fill: localEndpoint ? hue : colors.surface, stroke: hue };
  }
  if (port.localKind) {
    const hue = port.localKind.endsWith('action') ? colors.action : colors.event;
    return { fill: localEndpoint ? hue : colors.surface, stroke: hue };
  }
  // Untyped synthetic ports retain their original neutral socket treatment.
  return { fill: colors.surface, stroke: colors.wire };
}

function applyTheme(theme: NodelTheme): void {
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  colors = readColors();
  updateCanvasColors();
}

function updateCanvasColors(): void {
  for (const node of nodes) {
    const group = cardGroups.get(node.id);
    if (!group) continue;
    const shapes = group.getChildren();
    const card = shapes[0];
    if (card instanceof Konva.Rect) {
      card.fill(colors.surface);
      card.stroke(selectedNode === node.id ? colors.accent : colors.border);
      card.strokeWidth(selectedNode === node.id ? 2.2 : 1);
    }
    const header = shapes[1];
    if (header instanceof Konva.Rect) header.fill(colors.surface);
    const title = shapes[3];
    if (title instanceof Konva.Text) title.fill(colors.foreground);
    const status = shapes[4];
    if (status instanceof Konva.Text) status.fill(colors.muted);
    const divider = shapes[5];
    if (divider instanceof Konva.Line) divider.stroke(colors.border);
    for (const port of node.ports) {
      const socket = socketShapes.get(`${node.id}:${port.id}`);
      const selected = selectedEdge ? edgeById.get(selectedEdge) : undefined;
      const highlighted = !!selected && (selected.from.nodeId === node.id && selected.from.portId === port.id || selected.to.nodeId === node.id && selected.to.portId === port.id);
      const appearance = socketColor(port, highlighted);
      socket?.fill(appearance.fill);
      socket?.stroke(appearance.stroke);
      socket?.radius(highlighted ? 5 : 4);
    }
    const labels = group.find('Text');
    labels.forEach((label, index) => {
      if (label instanceof Konva.Text) label.fill(index === 0 ? colors.foreground : colors.muted);
    });
  }
  wireLayer?.getChildren().forEach((shape) => {
    if (shape instanceof Konva.Shape) {
      const edge = edgeById.get(shape.id());
      if (edge) shape.stroke(wireColor(edge, selectedEdge === edge.id));
    }
  });
  wireLayer?.batchDraw();
  cardLayer?.batchDraw();
}

function initializeTheme(): void {
  const media = getSystemThemeMediaQuery();
  const selector = document.querySelector<HTMLSelectElement>('[data-theme-select]');
  // data-theme is the resolved color (including before first paint), not the user's choice.
  let preference: NodelTheme | 'system';
  const setPreference = (next: NodelTheme | 'system') => {
    preference = next;
    if (selector) selector.value = next;
    applyTheme(next === 'system' ? (media?.matches ? 'dark' : 'light') : next);
  };
  setPreference(getStoredTheme() ?? 'system');
  media?.addEventListener('change', () => {
    if (preference === 'system') setPreference('system');
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && preference === 'system') setPreference('system');
  });
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) setPreference(getStoredTheme() ?? 'system');
  });
  selector?.addEventListener('change', () => {
    if (selector.value === 'system') {
      try { window.localStorage.removeItem(THEME_STORAGE_KEY); } catch { /* Preference storage is optional. */ }
      setPreference('system');
    } else if (isNodelTheme(selector.value)) {
      storeTheme(selector.value);
      setPreference(selector.value);
    }
  });
}

function drawCurve(context: Konva.Context, curve: Curve): void {
  context.beginPath();
  context.moveTo(curve.start.x, curve.start.y);
  context.bezierCurveTo(curve.control1.x, curve.control1.y, curve.control2.x, curve.control2.y, curve.end.x, curve.end.y);
}

function drawArrow(context: Konva.Context, { tip, left, right }: NonNullable<ReturnType<typeof curveArrow>>): void {
  context.beginPath();
  context.moveTo(tip.x, tip.y);
  context.lineTo(left.x, left.y);
  context.lineTo(right.x, right.y);
  context.closePath();
}

function updateWireGeometry(edge: FixtureEdge): void {
  const curves = edgeCurves(edge, nodeById);
  const socket = curves.at(-1)!.end;
  let arrow: ReturnType<typeof curveArrow>;
  for (let i = curves.length - 1; i >= 0 && !arrow; i -= 1) arrow = curveArrow(curves[i]!, socket);
  wireGeometry.set(edge.id, { curves, arrow });
}

function makeWire(edge: FixtureEdge): Konva.Shape {
  updateWireGeometry(edge);
  const shape = new Konva.Shape({
    id: edge.id,
    name: 'topology-wire',
    listening: true,
    stroke: wireColor(edge),
    strokeWidth: 1.6,
    hitStrokeWidth: 14,
    sceneFunc(context) {
      const geometry = wireGeometry.get(edge.id);
      if (!geometry) return;
      context.strokeStyle = wireColor(edge, selectedEdge === edge.id);
      context.lineCap = 'round';
      const selected = selectedEdge === edge.id;
      const typedSelection = selected && edge.bindingKind !== undefined;
      for (const curve of geometry.curves) {
        drawCurve(context, curve);
        // Local typed bindings get an unmistakable, double-contrast selection
        // without adding a layer or changing the synthetic benchmark ink.
        if (typedSelection) {
          context.strokeStyle = colors.surface;
          context.lineWidth = 5.2;
          context.stroke();
          drawCurve(context, curve);
          context.strokeStyle = wireColor(edge, true);
          context.lineWidth = 3.2;
        } else {
          context.lineWidth = selected ? 2.6 : 1.6;
        }
        context.stroke();
      }
      if (geometry.arrow) {
        drawArrow(context, geometry.arrow);
        context.fillStyle = wireColor(edge, selectedEdge === edge.id);
        context.fill();
      }
    },
    hitFunc(context, self) {
      const geometry = wireGeometry.get(edge.id);
      if (!geometry) return;
      for (const curve of geometry.curves) {
        drawCurve(context, curve);
        context.strokeShape(self);
      }
      if (geometry.arrow) {
        drawArrow(context, geometry.arrow);
        context.fillShape(self);
      }
    }
  });
  if (edge.bindingKind) shape.setAttr('bindingKind', edge.bindingKind);
  if (edge.ownerId) shape.setAttr('ownerId', edge.ownerId);
  shape.on('click tap', (event) => {
    event.cancelBubble = true;
    setSelection({ edgeId: edge.id });
  });
  return shape;
}

function makeCard(node: FixtureNode): Konva.Group {
  const height = cardHeight(node);
  const group = new Konva.Group({ x: node.x, y: node.y, draggable: true, id: node.id, name: 'topology-card' });
  const rect = new Konva.Rect({ x: 0, y: 0, width: node.width, height, fill: colors.surface, stroke: colors.border, strokeWidth: 1, cornerRadius: 10, shadowColor: '#142536', shadowBlur: 11, shadowOpacity: 0.1, shadowOffsetY: 3, ...(nodes.length > 9 ? { shadowForStrokeEnabled: false } : {}) });
  group.add(rect);
  group.add(new Konva.Rect({ x: 1, y: 1, width: node.width - 2, height: CARD_HEADER_HEIGHT - 1, fill: colors.surface, cornerRadius: [9, 9, 0, 0], listening: false }));
  group.add(new Konva.Circle({ x: 18, y: 22, radius: 4, fill: node.statusKind === 'local' ? '#39a779' : node.statusKind ? '#d79a3b' : node.status === 'online' ? '#39a779' : '#d79a3b', listening: false }));
  group.add(new Konva.Text({ x: 30, y: 13, width: node.width - 44, text: node.name, fontFamily: 'system-ui, sans-serif', fontSize: 14, fontStyle: 'bold', fill: colors.foreground, listening: false, ellipsis: true, wrap: 'none' }));
  group.add(new Konva.Text({ x: 30, y: 34, width: node.width - 44, text: node.displayStatus ?? (node.status === 'online' ? 'Online' : 'Standby'), fontFamily: 'system-ui, sans-serif', fontSize: 11, fill: colors.muted, listening: false, ellipsis: true, wrap: 'none' }));
  group.add(new Konva.Line({ points: [0, CARD_HEADER_HEIGHT, node.width, CARD_HEADER_HEIGHT], stroke: colors.border, strokeWidth: 1, listening: false }));
  for (const side of ['left', 'right'] as const) {
    const ports = node.ports.filter((item) => item.side === side);
    ports.forEach((item, index) => {
      const y = PORTS_TOP + index * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2;
      group.add(new Konva.Text({
        x: side === 'left' ? 14 : 10,
        y: y - 7,
        width: node.width - 24,
        align: side === 'left' ? 'left' : 'right',
        text: item.label,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 11,
        fill: colors.muted,
        listening: false,
        ellipsis: true,
        wrap: 'none'
      }));
      const appearance = socketColor(item, false);
      const socket = new Konva.Circle({ x: side === 'left' ? 0 : node.width, y, radius: 4, fill: appearance.fill, stroke: appearance.stroke, strokeWidth: 1.5, listening: false, name: `socket-${node.id}-${item.id}` });
      if (item.localKind) socket.setAttr('localKind', item.localKind);
      socketShapes.set(`${node.id}:${item.id}`, socket);
      group.add(socket);
    });
  }
  group.on('click tap', (event) => {
    event.cancelBubble = true;
    setSelection({ nodeId: node.id });
  });
  group.on('dragmove', () => {
    node.x = group.x();
    node.y = group.y();
    for (const edgeId of incidentEdges.get(node.id) ?? []) {
      const edge = edgeById.get(edgeId);
      if (edge) updateWireGeometry(edge);
    }
    wireLayer?.batchDraw();
  });
  group.on('dragend', () => {
    node.x = group.x();
    node.y = group.y();
  });
  return group;
}

function setSelection(next: Selection): void {
  const previous = { nodeId: selectedNode, edgeId: selectedEdge };
  if (previous.nodeId === next.nodeId && previous.edgeId === next.edgeId) return;
  const changed = selectionChanges(previous, next, edgeById);
  selectedNode = next.nodeId;
  selectedEdge = next.edgeId;
  for (const nodeId of changed.nodeIds) {
    const rect = cardGroups.get(nodeId)?.findOne<Konva.Rect>('Rect');
    rect?.stroke(selectedNode === nodeId ? colors.accent : colors.border);
    rect?.strokeWidth(selectedNode === nodeId ? 2.2 : 1);
  }
  // Wires consult selectedEdge in their scene function; one layer draw below updates both paths.
  for (const socketId of changed.socketIds) {
    const socket = socketShapes.get(socketId);
    if (!socket) continue;
    const highlighted = selectedEdge !== undefined && (() => {
      const edge = edgeById.get(selectedEdge);
      if (!edge) return false;
      return `${edge.from.nodeId}:${edge.from.portId}` === socketId || `${edge.to.nodeId}:${edge.to.portId}` === socketId;
    })();
    const [nodeId, portId] = socketId.split(':');
    const port = nodeById.get(nodeId!)?.ports.find((item) => item.id === portId);
    if (!port) continue;
    const appearance = socketColor(port, highlighted);
    socket.stroke(appearance.stroke);
    socket.fill(appearance.fill);
    socket.radius(highlighted ? 5 : 4);
  }
  if (changed.edgeIds.size) wireLayer?.batchDraw();
  if (changed.nodeIds.size || changed.socketIds.size) cardLayer?.batchDraw();
}

function centerCamera(): void {
  const bounds = authoredWorldBounds;
  if (!stage || !bounds) return;
  const graphLeft = bounds.left;
  const graphTop = bounds.top;
  const graphWidth = bounds.right - bounds.left;
  const graphHeight = bounds.bottom - bounds.top;
  const scale = Math.min(1, (viewportWidth - 40) / graphWidth, (viewportHeight - 36) / graphHeight);
  stage.scale({ x: scale, y: scale });
  stage.position({ x: Math.round((viewportWidth - graphWidth * scale) / 2 - graphLeft * scale), y: Math.round((viewportHeight - graphHeight * scale) / 2 - graphTop * scale) });
  stage.batchDraw();
}

function setZoom(nextScale: number, anchor = { x: viewportWidth / 2, y: viewportHeight / 2 }): void {
  if (!stage) return;
  const scale = Math.max(0.04, Math.min(1.6, nextScale));
  const world = { x: (anchor.x - stage.x()) / stage.scaleX(), y: (anchor.y - stage.y()) / stage.scaleY() };
  stage.scale({ x: scale, y: scale });
  stage.position({ x: anchor.x - world.x * scale, y: anchor.y - world.y * scale });
  stage.batchDraw();
}

function initialize(): boolean {
  if (!host || !stageHost) {
    if (failure) {
      failure.textContent = localMode ? 'Local topology canvas could not be rendered.' : 'Canvas rendering is unavailable in this browser.';
      failure.hidden = false;
    }
    return false;
  }
  try {
    stage = new Konva.Stage({ container: stageHost, width: 1, height: 1, draggable: true });
    wireLayer = new Konva.Layer({ name: 'wires' });
    cardLayer = new Konva.Layer({ name: 'cards' });
    stage.add(wireLayer, cardLayer);
    for (const edge of edges) {
      const shape = makeWire(edge);
      wireLayer.add(shape);
    }
    for (const node of nodes) {
      const group = makeCard(node);
      cardGroups.set(node.id, group);
      cardLayer.add(group);
    }
    stage.on('click tap', (event) => {
      if (event.target === stage) {
        setSelection({});
      }
    });
    stage.on('wheel', (event) => {
      event.evt.preventDefault();
      const pointer = stage?.getPointerPosition();
      if (!pointer || !stage) return;
      const factor = 1.07;
      setZoom(stage.scaleX() * (event.evt.deltaY > 0 ? 1 / factor : factor), pointer);
    });
    const preventNativeWheel = (event: WheelEvent) => event.preventDefault();
    stageHost.addEventListener('wheel', preventNativeWheel, { passive: false });
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width <= 0 || rect.height <= 0 || !stage) return;
      const initial = viewportWidth === 0 || viewportHeight === 0;
      viewportWidth = rect.width;
      viewportHeight = rect.height;
      stage.size({ width: viewportWidth, height: viewportHeight });
      if (initial) centerCamera();
      else stage.batchDraw();
    });
    observer.observe(stageHost);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelection({});
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const summary = document.querySelector<HTMLElement>('[data-fixture-summary]');
    if (summary) summary.textContent = localMode ? `${nodes.length} nodes · ${edges.length} configured` : `${nodes.length} nodes · ${edges.length} edges`;
    const zoomOut = document.querySelector<HTMLButtonElement>('[data-view="zoom-out"]');
    const zoomIn = document.querySelector<HTMLButtonElement>('[data-view="zoom-in"]');
    const reset = document.querySelector<HTMLButtonElement>('[data-view="reset"]');
    const onZoomOut = () => setZoom((stage?.scaleX() ?? 1) / 1.15);
    const onZoomIn = () => setZoom((stage?.scaleX() ?? 1) * 1.15);
    const onReset = () => centerCamera();
    zoomOut?.addEventListener('click', onZoomOut);
    zoomIn?.addEventListener('click', onZoomIn);
    reset?.addEventListener('click', onReset);
    const onPageHide = (event: PageTransitionEvent) => {
      // The browser will revive this same document and stage on a cache hit.
      if (event.persisted) return;
      window.removeEventListener('pagehide', onPageHide);
      observer.disconnect();
      stageHost.removeEventListener('wheel', preventNativeWheel);
      document.removeEventListener('keydown', onKeyDown);
      zoomOut?.removeEventListener('click', onZoomOut);
      zoomIn?.removeEventListener('click', onZoomIn);
      reset?.removeEventListener('click', onReset);
      sizeSelect?.removeEventListener('change', onSizeChange);
      stage?.destroy();
      stage = undefined;
    };
    window.addEventListener('pagehide', onPageHide);
    if (failure && !localMode) failure.hidden = true;
    return true;
  } catch {
    stage?.destroy();
    stage = undefined;
    if (failure) {
      if (localMode) failure.textContent = 'Local topology canvas could not be rendered.';
      failure.hidden = false;
    }
    return false;
  }
}

initializeTheme();
const localController = new AbortController();
let pageDisposed = false;
let localMountFailed = false;
if (localMode) {
  const label = document.querySelector<HTMLElement>('[data-experiment-label]');
  const title = document.querySelector<HTMLElement>('.experiment-header h1');
  if (label) label.textContent = 'Read-only local configuration';
  if (title) title.textContent = 'Local network topology';
  document.title = 'Local network topology · Konva canvas experiment';
}
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  pageDisposed = true;
  localController.abort();
  sizeSelect?.removeEventListener('change', onSizeChange);
});

function setAccessibleMessage(message: string): void {
  if (!failure) return;
  failure.textContent = message;
  failure.hidden = false;
}

function installGraph(nextNodes: FixtureNode[], nextEdges: FixtureEdge[]): boolean {
  if (pageDisposed) return false;
  nodes = nextNodes;
  edges = nextEdges;
  authoredNodes = nodes.map((node) => Object.freeze({ ...node, ports: Object.freeze([...node.ports]) }));
  for (const node of nodes) nodeById.set(node.id, node);
  for (const edge of edges) {
    edgeById.set(edge.id, edge);
    for (const nodeId of [edge.from.nodeId, edge.to.nodeId]) {
      const incident = incidentEdges.get(nodeId) ?? new Set<string>();
      incident.add(edge.id);
      incidentEdges.set(nodeId, incident);
    }
  }
  const summary = document.querySelector<HTMLElement>('[data-fixture-summary]');
  if (summary) summary.textContent = `${nodes.length} nodes · ${edges.length} configured`;
  const mounted = initialize();
  function* initialRoutes(): IterableIterator<Curve[]> {
    for (const { curves } of wireGeometry.values()) yield curves;
  }
  authoredWorldBounds = graphBounds(authoredNodes, initialRoutes());
  if (!mounted) return false;
  if (nodes.length === 0) setAccessibleMessage('No local or referenced nodes were found in the local configuration snapshot.');
  else if (failure) failure.hidden = true;
  return true;
}

if (localMode) {
  if (failure) {
    failure.textContent = 'Loading local topology snapshot…';
    failure.hidden = false;
  }
  // Keep all snapshot/model/layout code out of the default synthetic entry path.
  void import('./local-snapshot').then(async ({ loadLocalSnapshot }) => {
    const snapshot = await loadLocalSnapshot(localController.signal);
    if (pageDisposed || localController.signal.aborted) return;
    const [{ graphInputFromLocalSnapshot, buildLocalGraph }, { placeLocalGraph }, { projectLocalGraph }] = await Promise.all([
      import('./local-graph'), import('./local-placement'), import('./local-projection')
    ]);
    if (pageDisposed || localController.signal.aborted) return;
    const graph = buildLocalGraph(graphInputFromLocalSnapshot(snapshot));
    const positions = placeLocalGraph(graph);
    const projection: LocalGraphProjection = projectLocalGraph(graph, positions);
    if (!installGraph(projection.nodes, projection.edges)) {
      localMountFailed = true;
      throw new Error('Local topology canvas could not be rendered.');
    }
    const summary = document.querySelector<HTMLElement>('[data-fixture-summary]');
    if (summary) summary.textContent = projection.summary;
  }).catch((error: unknown) => {
    if (pageDisposed || localController.signal.aborted) return;
    const summary = document.querySelector<HTMLElement>('[data-fixture-summary]');
    if (summary) summary.textContent = 'Local configuration unavailable';
    setAccessibleMessage(localMountFailed
      ? 'Local topology canvas could not be rendered.'
      : error instanceof Error && error.name === 'AbortError'
        ? 'Local topology loading was cancelled.' : 'Local topology could not be loaded from this page origin.');
  });
} else {
  const fixture = createFixture(nodeCount);
  installGraph(fixture.nodes, fixture.edges);
}
