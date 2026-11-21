import Konva from 'konva';
import './style.css';
import { getStoredTheme, getSystemThemeMediaQuery, isNodelTheme, storeTheme, THEME_STORAGE_KEY, type NodelTheme } from '../../theme/theme';
import {
  CARD_HEADER_HEIGHT, FIXTURE_NODE_COUNTS, PORTS_TOP, PORT_ROW_HEIGHT, cardHeight, createFixture, curveArrow, edgeCurves,
  type Curve, type FixtureEdge, type FixtureNode, type FixtureNodeCount
} from './fixture';

const host = document.querySelector<HTMLElement>('#diagram');
const failure = host?.querySelector<HTMLElement>('.canvas-failure');
const stageHost = document.createElement('div');
stageHost.className = 'canvas-stage';
if (host) host.append(stageHost);

let colors = readColors();
const requestedNodeCount = Number(new URLSearchParams(window.location.search).get('nodes'));
const nodeCount: FixtureNodeCount = FIXTURE_NODE_COUNTS.includes(requestedNodeCount as FixtureNodeCount) ? requestedNodeCount as FixtureNodeCount : 9;
const { nodes, edges } = createFixture(nodeCount);
const authoredNodes: readonly FixtureNode[] = nodes.map((node) => Object.freeze({
  ...node,
  ports: Object.freeze([...node.ports])
}));
const nodeById = new Map(nodes.map((node) => [node.id, node]));
const initialNodeById = new Map(authoredNodes.map((node) => [node.id, node]));
const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
const incidentEdges = new Map<string, Set<string>>();
const wireGeometry = new Map<string, { curves: Curve[]; arrow: ReturnType<typeof curveArrow> }>();
for (const edge of edges) {
  for (const nodeId of [edge.from.nodeId, edge.to.nodeId]) {
    const incident = incidentEdges.get(nodeId) ?? new Set<string>();
    incident.add(edge.id);
    incidentEdges.set(nodeId, incident);
  }
}

let stage: Konva.Stage | undefined;
let wireLayer: Konva.Layer | undefined;
let cardLayer: Konva.Layer | undefined;
let selectedNode: string | undefined;
let selectedEdge: string | undefined;
let viewportWidth = 0;
let viewportHeight = 0;
const cardGroups = new Map<string, Konva.Group>();
const socketShapes = new Map<string, Konva.Circle>();

function readColors(): { surface: string; foreground: string; muted: string; border: string; accent: string; grid: string; wire: string } {
  const style = getComputedStyle(document.documentElement);
  const resolve = (token: string, fallback: string) => style.getPropertyValue(token).trim() || fallback;
  return {
    surface: `rgb(${resolve('--nodel-surface', '255 255 255')})`,
    foreground: `rgb(${resolve('--nodel-fg', '32 42 53')})`,
    muted: `rgb(${resolve('--nodel-muted', '102 116 130')})`,
    border: `rgb(${resolve('--nodel-border', '215 222 229')})`,
    accent: `rgb(${resolve('--nodel-accent', '40 115 200')})`,
    grid: `rgb(${resolve('--nodel-border', '215 222 229')})`,
    wire: `rgb(${resolve('--nodel-muted', '116 132 148')})`
  };
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
      socket?.fill(colors.surface);
      socket?.stroke(colors.wire);
    }
    const labels = group.find('Text');
    labels.forEach((label, index) => {
      if (label instanceof Konva.Text) label.fill(index === 0 ? colors.foreground : colors.muted);
    });
  }
  wireLayer?.getChildren().forEach((shape) => {
    if (shape instanceof Konva.Shape) shape.stroke(colors.wire);
  });
  refreshSelection();
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
  const terminal = curves.at(-1);
  wireGeometry.set(edge.id, { curves, arrow: terminal && curveArrow(terminal) });
}

function makeWire(edge: FixtureEdge): Konva.Shape {
  updateWireGeometry(edge);
  const shape = new Konva.Shape({
    id: edge.id,
    name: 'topology-wire',
    listening: true,
    stroke: colors.wire,
    strokeWidth: 1.6,
    hitStrokeWidth: 14,
    sceneFunc(context) {
      const geometry = wireGeometry.get(edge.id);
      if (!geometry) return;
      context.strokeStyle = selectedEdge === edge.id ? colors.accent : colors.wire;
      context.lineWidth = selectedEdge === edge.id ? 2.6 : 1.6;
      context.lineCap = 'round';
      for (const curve of geometry.curves) {
        drawCurve(context, curve);
        context.stroke();
      }
      if (geometry.arrow) {
        drawArrow(context, geometry.arrow);
        context.fillStyle = selectedEdge === edge.id ? colors.accent : colors.wire;
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
  shape.on('click tap', (event) => {
    event.cancelBubble = true;
    selectedEdge = edge.id;
    selectedNode = undefined;
    refreshSelection();
  });
  return shape;
}

function makeCard(node: FixtureNode): Konva.Group {
  const height = cardHeight(node);
  const group = new Konva.Group({ x: node.x, y: node.y, draggable: true, id: node.id, name: 'topology-card' });
  const rect = new Konva.Rect({ x: 0, y: 0, width: node.width, height, fill: colors.surface, stroke: colors.border, strokeWidth: 1, cornerRadius: 10, shadowColor: '#142536', shadowBlur: 11, shadowOpacity: 0.1, shadowOffsetY: 3 });
  group.add(rect);
  group.add(new Konva.Rect({ x: 1, y: 1, width: node.width - 2, height: CARD_HEADER_HEIGHT - 1, fill: colors.surface, cornerRadius: [9, 9, 0, 0], listening: false }));
  group.add(new Konva.Circle({ x: 18, y: 22, radius: 4, fill: node.status === 'online' ? '#39a779' : '#d79a3b', listening: false }));
  group.add(new Konva.Text({ x: 30, y: 13, width: node.width - 44, text: node.name, fontFamily: 'system-ui, sans-serif', fontSize: 14, fontStyle: 'bold', fill: colors.foreground, listening: false, ellipsis: true, wrap: 'none' }));
  group.add(new Konva.Text({ x: 30, y: 34, width: node.width - 44, text: node.status === 'online' ? 'Online' : 'Standby', fontFamily: 'system-ui, sans-serif', fontSize: 11, fill: colors.muted, listening: false }));
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
      const socket = new Konva.Circle({ x: side === 'left' ? 0 : node.width, y, radius: 4, fill: colors.surface, stroke: colors.wire, strokeWidth: 1.5, listening: false, name: `socket-${node.id}-${item.id}` });
      socketShapes.set(`${node.id}:${item.id}`, socket);
      group.add(socket);
    });
  }
  group.on('click tap', (event) => {
    event.cancelBubble = true;
    selectedNode = node.id;
    selectedEdge = undefined;
    refreshSelection();
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

function refreshSelection(): void {
  for (const node of nodes) {
    const group = cardGroups.get(node.id);
    const rect = group?.findOne<Konva.Rect>('Rect');
    rect?.stroke(selectedNode === node.id ? colors.accent : colors.border);
    rect?.strokeWidth(selectedNode === node.id ? 2.2 : 1);
    for (const item of node.ports) {
      const socket = socketShapes.get(`${node.id}:${item.id}`);
      const highlighted = selectedEdge !== undefined && (edgeById.get(selectedEdge)?.from.nodeId === node.id && edgeById.get(selectedEdge)?.from.portId === item.id || edgeById.get(selectedEdge)?.to.nodeId === node.id && edgeById.get(selectedEdge)?.to.portId === item.id);
      socket?.stroke(highlighted ? colors.accent : colors.wire);
      socket?.fill(highlighted ? colors.accent : colors.surface);
      socket?.radius(highlighted ? 5 : 4);
    }
  }
  wireLayer?.batchDraw();
  cardLayer?.batchDraw();
}

function centerCamera(): void {
  if (!stage) return;
  const allCurves = edges.flatMap((edge) => edgeCurves(edge, initialNodeById));
  const graphLeft = Math.min(...authoredNodes.map((node) => node.x), ...allCurves.flatMap((curve) => [curve.start.x, curve.control1.x, curve.control2.x, curve.end.x]));
  const graphRight = Math.max(...authoredNodes.map((node) => node.x + node.width), ...allCurves.flatMap((curve) => [curve.start.x, curve.control1.x, curve.control2.x, curve.end.x]));
  const graphWidth = graphRight - graphLeft;
  const graphTop = Math.min(...authoredNodes.map((node) => node.y));
  const graphBottom = Math.max(
    ...authoredNodes.map((node) => node.y + cardHeight(node)),
    ...edges.flatMap((edge) => {
      return edgeCurves(edge, initialNodeById).flatMap((curve) => [curve.start.y, curve.control1.y, curve.control2.y, curve.end.y]);
    })
  );
  const graphHeight = graphBottom - graphTop;
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

function initialize(): void {
  if (!host || !stageHost) {
    if (failure) failure.hidden = false;
    return;
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
        selectedNode = undefined;
        selectedEdge = undefined;
        refreshSelection();
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
        selectedNode = undefined;
        selectedEdge = undefined;
        refreshSelection();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const sizeSelect = document.querySelector<HTMLSelectElement>('[data-node-count]');
    if (sizeSelect) sizeSelect.value = String(nodeCount);
    const summary = document.querySelector<HTMLElement>('[data-fixture-summary]');
    if (summary) summary.textContent = `${nodes.length} nodes · ${edges.length} edges`;
    const onSizeChange = () => {
      if (!sizeSelect) return;
      if (!FIXTURE_NODE_COUNTS.some((count) => String(count) === sizeSelect.value)) return;
      const url = new URL(window.location.href);
      url.searchParams.set('nodes', sizeSelect.value);
      window.location.assign(url);
    };
    sizeSelect?.addEventListener('change', onSizeChange);
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
    if (failure) failure.hidden = true;
  } catch {
    stage?.destroy();
    stage = undefined;
    if (failure) failure.hidden = false;
  }
}

initializeTheme();
initialize();
