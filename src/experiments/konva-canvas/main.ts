import Konva from 'konva';
import './style.css';
import { getStoredTheme, getSystemThemeMediaQuery, isNodelTheme, storeTheme, THEME_STORAGE_KEY, type NodelTheme } from '../../theme/theme';
import {
  CARD_HEADER_HEIGHT, FIXTURE_NODE_COUNTS, PORTS_TOP, PORT_ROW_HEIGHT, cardHeight, createFixture, curveArrow, edgeCurves,
  type Curve, type FixtureEdge, type FixtureNode, type FixtureNodeCount, type Point
} from './fixture';
import type { LocalGraph } from './local-graph';
import type { LocalCardPatch, LocalEnrichmentProjection } from './local-enrichment-projection';
import type { RemoteEnrichmentBatch } from './remote-enrichment';
import { graphBounds, selectionChanges, type Selection } from './camera-selection';
import { LocalFraming } from './local-framing';
import { createEnrichmentLifetime, createLocalSnapshotLifetime, localInspectionDepth } from './enrichment-lifetime';
import { localNodePath } from '../../utils/urls';
import { isUsableNodeName } from '../../utils/node-name';
import { networkNodeSearchHref } from '../../navigation/node-links';
import { LocalLaneReservations } from './lane-reservations';

const host = document.querySelector<HTMLElement>('#diagram');
const failure = host?.querySelector<HTMLElement>('.canvas-failure');
const summary = document.querySelector<HTMLElement>('[data-fixture-summary]');
const query = new URLSearchParams(window.location.search);
const localMode = query.get('source') === 'local';
const inspectionDepth = localInspectionDepth(query);
const stageHost = document.createElement('div');
stageHost.className = 'canvas-stage';
stageHost.tabIndex = localMode ? 0 : -1;
stageHost.setAttribute('role', 'img');
stageHost.setAttribute('aria-label', localMode ? 'Topology diagram. Focus and use arrow keys to inspect nodes; press Enter to open the selected node title.' : 'Room network diagram.');
if (host) host.append(stageHost);

let colors = readColors();
const requestedNodeCount = Number(query.get('nodes'));
const nodeCount: FixtureNodeCount = FIXTURE_NODE_COUNTS.includes(requestedNodeCount as FixtureNodeCount) ? requestedNodeCount as FixtureNodeCount : 9;
const sizeSelect = document.querySelector<HTMLSelectElement>('[data-node-count]');
const syncSizeSelect = () => { if (sizeSelect) sizeSelect.value = localMode ? 'local' : String(nodeCount); };
syncSizeSelect();
if (localMode) {
  if (summary) summary.textContent = 'Loading local configuration…';
}
const localFraming = localMode ? new LocalFraming() : undefined;
const localSnapshot = localMode ? createLocalSnapshotLifetime(loadLocalGraph) : undefined;
const enrichmentLifetime = localMode ? createEnrichmentLifetime({
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle)
}) : undefined;
let pageDisposed = false;

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
  if (url.href === window.location.href) return;
  // Discard Stage B before navigation; only the interrupted Stage A can recover on Back.
  enrichmentLifetime?.cancel();
  localSnapshot?.suspend();
  window.location.assign(url);
};
sizeSelect?.addEventListener('change', onSizeChange);
let nodes: FixtureNode[] = [];
let edges: FixtureEdge[] = [];
const nodeById = new Map<string, FixtureNode>();
const edgeById = new Map<string, FixtureEdge>();
const incidentEdges = new Map<string, Set<string>>();
const wireGeometry = new Map<string, { curves: Curve[]; arrow: ReturnType<typeof curveArrow> }>();
const laneReservations = new LocalLaneReservations();
interface ActiveCardDrag {
  origin: Point;
  didMove: boolean;
  reservationsReleased: boolean;
  deferredEdgeIds: Set<string>;
}
const activeDrags = new Map<string, ActiveCardDrag>();
let authoredWorldBounds: ReturnType<typeof graphBounds>;

let stage: Konva.Stage | undefined;
let wireLayer: Konva.Layer | undefined;
let cardLayer: Konva.Layer | undefined;
let selectedNode: string | undefined;
let selectedEdge: string | undefined;
let viewportWidth = 0;
let viewportHeight = 0;
const cardGroups = new Map<string, Konva.Group>();
interface PortRow { label: Konva.Text; socket: Konva.Circle; port: FixtureNode['ports'][number] }
const socketRows = new Map<string, PortRow>();
interface CardShapes { rect: Konva.Rect; header: Konva.Rect; divider: Konva.Line; dot?: Konva.Circle; title: Konva.Text; status: Konva.Text; host?: Konva.Group }
const cardShapes = new Map<string, CardShapes>();
let keyboardCardIndex = -1;
let hoveredCardId: string | undefined;
let keyboardCardId: string | undefined;

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
    const shapes = cardShapes.get(node.id);
    if (!shapes) continue;
    shapes.rect.fill(colors.surface);
    shapes.rect.stroke(selectedNode === node.id ? colors.accent : colors.border);
    shapes.rect.strokeWidth(selectedNode === node.id ? 2.2 : 1);
    shapes.header.fill(colors.surface);
    shapes.title.fill(colors.foreground);
    shapes.status.fill(colors.muted);
    shapes.divider.stroke(colors.border);
    if (shapes.host) repaintHostGlyph(shapes.host);
    for (const port of node.ports) {
      const socket = socketRows.get(`${node.id}:${port.id}`)?.socket;
      const selected = selectedEdge ? edgeById.get(selectedEdge) : undefined;
      const highlighted = !!selected && (selected.from.nodeId === node.id && selected.from.portId === port.id || selected.to.nodeId === node.id && selected.to.portId === port.id);
      const appearance = socketColor(port, highlighted);
      socket?.fill(appearance.fill);
      socket?.stroke(appearance.stroke);
      socket?.radius(highlighted ? 5 : 4);
    }
    const labels = cardGroups.get(node.id)?.find('Text') ?? [];
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

function updateWireGeometry(edge: FixtureEdge): boolean {
  const curves = edgeCurves(edge, nodeById);
  const socket = curves.at(-1)!.end;
  let arrow: ReturnType<typeof curveArrow>;
  for (let i = curves.length - 1; i >= 0 && !arrow; i -= 1) arrow = curveArrow(curves[i]!, socket);
  const previous = wireGeometry.get(edge.id);
  if (previous && sameWireGeometry(previous.curves, curves) && sameArrow(previous.arrow, arrow)) return false;
  wireGeometry.set(edge.id, { curves, arrow });
  localFraming?.updateRoute(edge.id, curves, arrow);
  return true;
}

function sameWireGeometry(a: Curve[], b: Curve[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const first = a[index]!;
    const second = b[index]!;
    if (first.start.x !== second.start.x || first.start.y !== second.start.y ||
      first.control1.x !== second.control1.x || first.control1.y !== second.control1.y ||
      first.control2.x !== second.control2.x || first.control2.y !== second.control2.y ||
      first.end.x !== second.end.x || first.end.y !== second.end.y) return false;
  }
  return true;
}

function sameArrow(a: ReturnType<typeof curveArrow>, b: ReturnType<typeof curveArrow>): boolean {
  if (!a || !b) return a === b;
  return a.t === b.t && a.tip.x === b.tip.x && a.tip.y === b.tip.y &&
    a.left.x === b.left.x && a.left.y === b.left.y && a.right.x === b.right.x && a.right.y === b.right.y;
}

function makeWire(edge: FixtureEdge): Konva.Shape {
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

const statusText = (node: FixtureNode) => node.displayQualifier ?? node.displayStatus ?? (node.status === 'online' ? 'Online' : 'Standby');
const statusDot = (node: FixtureNode) => node.statusKind === 'local' || (!node.statusKind && node.status === 'online') ? '#39a779' : '#d79a3b';

function makePortRow(group: Konva.Group, node: FixtureNode, port: FixtureNode['ports'][number], y: number): void {
  const { side } = port;
  const label = new Konva.Text({
    x: side === 'left' ? 14 : 10, y: y - 7, width: node.width - 24,
    align: side === 'left' ? 'left' : 'right', text: port.label,
    fontFamily: 'system-ui, sans-serif', fontSize: 11, fill: colors.muted, listening: false, ellipsis: true, wrap: 'none'
  });
  const appearance = socketColor(port, false);
  const socket = new Konva.Circle({ x: side === 'left' ? 0 : node.width, y, radius: 4, fill: appearance.fill, stroke: appearance.stroke, strokeWidth: 1.5, listening: false, name: `socket-${node.id}-${port.id}` });
  if (port.localKind) socket.setAttr('localKind', port.localKind);
  socketRows.set(`${node.id}:${port.id}`, { label, socket, port });
  group.add(label, socket);
}

const rowCenter = (row: number) => PORTS_TOP + row * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2;

function positionRows(node: FixtureNode, visit: (port: FixtureNode['ports'][number], y: number) => void): void {
  const sides = { left: 0, right: 0 };
  for (const port of node.ports) visit(port, rowCenter(sides[port.side]++));
}

function moveCard(node: FixtureNode, group: Konva.Group): boolean {
  if (node.x === group.x() && node.y === group.y()) return false;
  const drag = activeDrags.get(node.id);
  if (drag) drag.didMove = true;
  node.x = group.x();
  node.y = group.y();
  localFraming?.updateCard(node);
  for (const edgeId of incidentEdges.get(node.id) ?? []) {
    const edge = edgeById.get(edgeId);
    if (edge) updateWireGeometry(edge);
  }
  wireLayer?.batchDraw();
  return true;
}

function releaseCardLaneReservations(node: FixtureNode): void {
  for (const edgeId of incidentEdges.get(node.id) ?? []) laneReservations.remove(edgeId);
}

function settleCardLanes(node: FixtureNode, deferredEdgeIds: Iterable<string> = []): void {
  const edgeIds = new Set(incidentEdges.get(node.id) ?? []);
  for (const edgeId of deferredEdgeIds) edgeIds.add(edgeId);
  const edges: FixtureEdge[] = [];
  for (const edgeId of edgeIds) {
    const edge = edgeById.get(edgeId);
    if (!edge) continue;
    const sourceDrag = activeDrags.get(edge.from.nodeId);
    const targetDrag = activeDrags.get(edge.to.nodeId);
    if (sourceDrag || targetDrag) {
      sourceDrag?.deferredEdgeIds.add(edgeId);
      targetDrag?.deferredEdgeIds.add(edgeId);
      continue;
    }
    edges.push(edge);
  }
  if (!edges.length) return;
  const result = laneReservations.settle(edges, nodeById);
  let changed = false;
  for (const edge of edges) changed = updateWireGeometry(edge) || changed;
  if (changed) wireLayer?.batchDraw();
  // Keep stats local to this allocator result; this is not exposed on the UI or DOM.
  void result.bucketCount;
  void result.candidateCount;
}

function updateHostGlyphKind(glyph: Konva.Group, kind: NonNullable<FixtureNode['hostKind']>): void {
  glyph.name(`host-location-${kind}`);
  for (const child of glyph.getChildren()) {
    if (child.name() === 'host-house') child.visible(kind === 'local');
    if (child.name() === 'host-arrow') child.visible(kind === 'remote');
    if (child.name() === 'host-question-badge' || child.name() === 'host-question-mark') child.visible(kind === 'unknown');
  }
}

function repaintHostGlyph(glyph: Konva.Group): void {
  const stroke = colors.muted;
  for (const child of glyph.getChildren()) {
    if (child instanceof Konva.Shape) child.stroke(stroke);
    if (child instanceof Konva.Circle) child.fill(colors.surface);
    if (child instanceof Konva.Text) child.fill(stroke);
  }
}

function makeHostGlyph(node: FixtureNode): Konva.Group {
  const glyph = new Konva.Group({ x: 0, y: 0, listening: false, name: `host-location-${node.hostKind ?? 'unknown'}` });
  const stroke = colors.muted;
  glyph.add(new Konva.Line({ points: [0, 0, 0, -6, 7, -12, 14, -6, 14, 0, 10, 0, 10, -4, 4, -4, 4, 0, 0, 0], stroke, strokeWidth: 1.4, lineJoin: 'round', lineCap: 'round', name: 'host-house', visible: node.hostKind === 'local' }));
  glyph.add(new Konva.Line({ points: [0, 6, 14, -8, 9, -8], stroke, strokeWidth: 1.6, lineCap: 'round', lineJoin: 'round', name: 'host-arrow', visible: node.hostKind === 'remote' }));
  glyph.add(new Konva.Line({ points: [14, -8, 14, -3], stroke, strokeWidth: 1.6, lineCap: 'round', lineJoin: 'round', name: 'host-arrow', visible: node.hostKind === 'remote' }));
  glyph.add(new Konva.Circle({ x: 7, y: -2, radius: 6, stroke, strokeWidth: 1.4, fill: colors.surface, name: 'host-question-badge', visible: node.hostKind === 'unknown' }));
  glyph.add(new Konva.Text({ x: 2.5, y: -8.5, width: 9, text: '?', fontFamily: 'system-ui, sans-serif', fontSize: 11, fontStyle: 'bold', align: 'center', fill: stroke, name: 'host-question-mark', visible: node.hostKind === 'unknown' }));
  return glyph;
}

function visibleHostGlyphBounds(glyph: Konva.Group): { left: number; top: number; right: number; bottom: number } | undefined {
  const visible = glyph.getChildren().filter((shape) => shape.visible());
  if (!visible.length) return undefined;
  const bounds = visible.map((shape) => shape.getClientRect({ relativeTo: glyph }));
  return {
    left: Math.min(...bounds.map(({ x }) => x)),
    top: Math.min(...bounds.map(({ y }) => y)),
    right: Math.max(...bounds.map(({ x, width }) => x + width)),
    bottom: Math.max(...bounds.map(({ y, height }) => y + height))
  };
}

function positionHostGlyph(glyph: Konva.Group, node: FixtureNode, title: Konva.Text): void {
  const bounds = visibleHostGlyphBounds(glyph);
  if (!bounds) return;
  const titleHeight = title.getClientRect({ skipTransform: true }).height;
  // Use the actual stroke-inclusive visible bounds: local houses have negative
  // intrinsic y coordinates, and the bounds must be centered on the title ink.
  glyph.position({
    x: node.width - 16 - bounds.right,
    y: title.y() + titleHeight / 2 - (bounds.top + bounds.bottom) / 2
  });
}

function setCardAccessibleMessage(message: string): void {
  if (!failure) return;
  failure.classList.add('is-visually-hidden');
  failure.textContent = message;
  failure.hidden = false;
}

function headerTooltip(tooltip: string, linkLabel: string): string {
  if (!linkLabel) return tooltip;
  const cue = linkLabel.length > 318 ? `${linkLabel.slice(0, 317)}…` : linkLabel;
  const combined = `${tooltip} ${cue}`;
  if (combined.length <= 320) return combined;
  const available = Math.max(0, 318 - cue.length);
  return `${tooltip.slice(0, available)}… ${cue}`;
}

function refreshActiveCardDescription(): void {
  const activeId = keyboardCardId ?? hoveredCardId;
  const node = activeId ? nodeById.get(activeId) : undefined;
  const group = activeId ? cardGroups.get(activeId) : undefined;
  if (node && group && node.tooltip) {
    const destination = titleDestination(node);
    const linkLabel = destination?.fallback ? `Find ${node.name} on Network.` : destination ? `Open ${node.name}.` : '';
    const detail = [node.tooltip, linkLabel].filter(Boolean).join(' ');
    const description = `${node.name}. ${detail}`;
    stage?.container().setAttribute('title', headerTooltip(node.tooltip, linkLabel));
    stageHost.setAttribute('aria-label', description);
    group.setAttr('accessibleDescription', description);
    setCardAccessibleMessage(description);
    return;
  }
  const container = stage?.container();
  container?.removeAttribute('title');
  if (activeId) cardGroups.get(activeId)?.setAttr('accessibleDescription', '');
  stageHost.setAttribute('aria-label', localMode ? 'Topology diagram. Focus and use arrow keys to inspect nodes; press Enter to open the selected node title.' : 'Room network diagram.');
  if (failure) {
    failure.classList.remove('is-visually-hidden');
    failure.hidden = true;
  }
}

type TitleDestination = { href: string; fallback: boolean };

function titleDestination(node: FixtureNode): TitleDestination | undefined {
  if (node.origin === 'local' && node.localPathName && isUsableNodeName(node.localPathName)) {
    try { return { href: localNodePath(node.localPathName), fallback: false }; }
    catch { return undefined; }
  }
  // Referenced nodes may not be hosted here. Keep navigation on the current
  // Nodel origin unless an already-verified same-origin route is available.
  // The experiment currently retains no verified remote admin route, so use
  // the established Network search rather than triggering discovery here.
  if (node.origin === 'referenced') {
    const href = networkNodeSearchHref(node.name);
    return href ? { href, fallback: true } : undefined;
  }
  return undefined;
}

function navigateToTitle(node: FixtureNode, event?: MouseEvent): void {
  const destination = titleDestination(node);
  if (!destination) return;
  if (event && (event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey)) {
    event.preventDefault();
    window.open(destination.href, '_blank', 'noopener,noreferrer');
    return;
  }
  window.location.assign(destination.href);
}

function syncTitleLink(node: FixtureNode, shapes: CardShapes): void {
  const destination = titleDestination(node);
  shapes.title.name(destination ? 'topology-node-title-link' : 'topology-node-title');
  if (destination) shapes.title.setAttr('navigationHref', destination.href);
  else shapes.title.setAttr('navigationHref', undefined);
}

function makeCard(node: FixtureNode): Konva.Group {
  const height = cardHeight(node);
  const group = new Konva.Group({ x: node.x, y: node.y, draggable: true, id: node.id, name: 'topology-card' });
  const rect = new Konva.Rect({ x: 0, y: 0, width: node.width, height, fill: colors.surface, stroke: colors.border, strokeWidth: 1, cornerRadius: 10, shadowColor: '#142536', shadowBlur: 11, shadowOpacity: 0.1, shadowOffsetY: 3, ...(nodes.length > 9 ? { shadowForStrokeEnabled: false } : {}) });
  group.add(rect);
  const header = new Konva.Rect({ x: 1, y: 1, width: node.width - 2, height: CARD_HEADER_HEIGHT - 1, fill: colors.surface, cornerRadius: [9, 9, 0, 0], listening: false });
  group.add(header);
  const realNode = node.hostKind !== undefined;
  const dot = realNode ? undefined : new Konva.Circle({ x: 18, y: 22, radius: 4, fill: statusDot(node), listening: false });
  const destination = realNode ? titleDestination(node) : undefined;
  const title = new Konva.Text({ x: realNode ? 16 : 30, y: realNode ? 12 : 13, width: node.width - (realNode ? 54 : 44), text: node.name, fontFamily: 'system-ui, sans-serif', fontSize: realNode ? 15 : 14, fontStyle: 'bold', fill: colors.foreground, listening: false, ellipsis: true, wrap: 'none', name: destination ? 'topology-node-title-link' : 'topology-node-title' });
  const status = new Konva.Text({ x: realNode ? 16 : 30, y: 35, width: node.width - (realNode ? 54 : 44), text: statusText(node), fontFamily: 'system-ui, sans-serif', fontSize: 11, fill: colors.muted, listening: false, ellipsis: true, wrap: 'none', visible: Boolean(statusText(node)) });
  const hostGlyph = realNode ? makeHostGlyph(node) : undefined;
  if (hostGlyph) positionHostGlyph(hostGlyph, node, title);
  const divider = new Konva.Line({ points: [0, CARD_HEADER_HEIGHT, node.width, CARD_HEADER_HEIGHT], stroke: colors.border, strokeWidth: 1, listening: false });
  group.add(...(dot ? [dot] : []), title, status, ...(hostGlyph ? [hostGlyph] : []));
  if (realNode) {
    if (node.tooltip) group.setAttr('accessibleDescription', node.tooltip);
    group.on('mouseenter', () => { hoveredCardId = node.id; refreshActiveCardDescription(); });
    group.on('mouseleave', () => {
      if (hoveredCardId === node.id) hoveredCardId = undefined;
      if (stage) stage.container().style.cursor = '';
      refreshActiveCardDescription();
    });
  }
  cardShapes.set(node.id, { rect, header, divider, ...(dot ? { dot } : {}), title, status, ...(hostGlyph ? { host: hostGlyph } : {}) });
  syncTitleLink(node, cardShapes.get(node.id)!);
  const visibleTitleWidth = () => Math.min(title.width(), title.getTextWidth());
  group.add(divider);
  // Keep the existing left-then-right child order on the initial mount.
  for (const side of ['left', 'right'] as const) {
    let row = 0;
    for (const port of node.ports) {
      if (port.side === side) makePortRow(group, node, port, rowCenter(row++));
    }
  }
  group.on('click tap', (event) => {
    const mouseEvent = event.evt as MouseEvent;
    if (mouseEvent.button === 2) {
      mouseEvent.preventDefault();
      event.cancelBubble = true;
      return;
    }
    if (stage && titleDestination(node)) {
      const pointer = stage.getPointerPosition();
      if (pointer) {
        const point = group.getAbsoluteTransform().copy().invert().point(pointer);
        const titleEndX = title.x() + visibleTitleWidth();
        const titleEndY = title.y() + title.height();
        if (point.x >= title.x() && point.x <= titleEndX && point.y >= title.y() && point.y <= titleEndY) {
          event.cancelBubble = true;
          navigateToTitle(node, mouseEvent);
          return;
        }
      }
    }
    event.cancelBubble = true;
    setSelection({ nodeId: node.id });
  });
  group.on('mousemove', () => {
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    const point = pointer ? group.getAbsoluteTransform().copy().invert().point(pointer) : undefined;
    const inTitle = Boolean(point && titleDestination(node) && point.x >= title.x() && point.x <= title.x() + visibleTitleWidth() && point.y >= title.y() && point.y <= title.y() + title.height());
    stage.container().style.cursor = inTitle ? 'pointer' : '';
  });
  group.on('dragstart', () => {
    if (!localMode) return;
    if (activeDrags.has(node.id)) return;
    releaseCardLaneReservations(node);
    activeDrags.set(node.id, {
      origin: { x: node.x, y: node.y },
      didMove: false,
      reservationsReleased: true,
      deferredEdgeIds: new Set()
    });
  });
  group.on('dragmove', () => {
    // Konva emits dragstart before dragmove; pointer movement never allocates lanes.
    moveCard(node, group);
  });
  group.on('dragend', () => {
    if (!localMode) {
      moveCard(node, group);
      return;
    }
    const drag = activeDrags.get(node.id);
    const movedAtEnd = moveCard(node, group);
    const moved = movedAtEnd || Boolean(drag && (drag.didMove || drag.origin.x !== group.x() || drag.origin.y !== group.y()));
    activeDrags.delete(node.id);
    if (moved || drag?.reservationsReleased || drag?.deferredEdgeIds.size) {
      settleCardLanes(node, drag?.deferredEdgeIds);
    }
  });
  return group;
}

function patchCard(patch: LocalCardPatch): Iterable<string> {
  const { id } = patch;
  const node = nodeById.get(id)!;
  const group = cardGroups.get(id)!;
  const shapes = cardShapes.get(id)!;
  if (node.name !== patch.name) {
    node.name = patch.name;
    shapes.title.text(patch.name);
  }
  if (node.origin !== patch.origin) node.origin = patch.origin;
  if (node.localPathName !== patch.localPathName) {
    if (patch.localPathName === undefined) delete node.localPathName;
    else node.localPathName = patch.localPathName;
  }
  if (node.displayStatus !== patch.displayStatus) {
    node.displayStatus = patch.displayStatus;
  }
  node.displayQualifier = patch.displayQualifier;
  const subtitle = statusText(node);
  if (shapes.status.text() !== subtitle) shapes.status.text(subtitle);
  shapes.status.visible(Boolean(subtitle));
  if (node.statusKind !== patch.statusKind) {
    node.statusKind = patch.statusKind;
    const dot = statusDot(node);
    if (shapes.dot && shapes.dot.fill() !== dot) shapes.dot.fill(dot);
  }
  if (patch.hostKind !== undefined && node.hostKind !== patch.hostKind) {
    node.hostKind = patch.hostKind;
    if (shapes.host) {
      updateHostGlyphKind(shapes.host, patch.hostKind);
      positionHostGlyph(shapes.host, node, shapes.title);
    }
    else {
      shapes.host = makeHostGlyph(node);
      positionHostGlyph(shapes.host, node, shapes.title);
      group.add(shapes.host);
    }
  }
  if (patch.hostDescription !== undefined) node.hostDescription = patch.hostDescription;
  if (patch.tooltip !== undefined) {
    node.tooltip = patch.tooltip;
    group.setAttr('accessibleDescription', patch.tooltip);
  }
  if (shapes.dot && node.hostKind !== undefined) {
    shapes.dot.destroy();
    delete shapes.dot;
    shapes.title.x(16).width(node.width - 54).fontSize(15);
    shapes.status.x(16).width(node.width - 54);
  } else if (!shapes.dot && node.hostKind === undefined) {
    shapes.dot = new Konva.Circle({ x: 18, y: 22, radius: 4, fill: statusDot(node), listening: false });
    group.add(shapes.dot);
    shapes.title.x(30).width(node.width - 44).fontSize(14);
    shapes.status.x(30).width(node.width - 44);
  }
  syncTitleLink(node, shapes);
  refreshActiveCardDescription();
  if (!patch.ports) return [];

  // Keep the node and each native row in place. Replace only the immutable layout input.
  const moved = new Set<string>();
  node.ports = patch.ports;
  const height = cardHeight(node);
  const resized = shapes.rect.height() !== height;
  if (resized) {
    shapes.rect.height(height);
    localFraming?.updateCard(node);
  }
  positionRows(node, (port, y) => {
    const row = socketRows.get(`${id}:${port.id}`);
    if (!row) {
      makePortRow(group, node, port, y);
      return;
    }
    if (row.socket.y() !== y) {
      moved.add(port.id);
      row.label.y(y - 7);
      row.socket.y(y);
    }
    if (row.label.text() !== port.label) row.label.text(port.label);
    row.port = port;
  });
  const incident = incidentEdges.get(id) ?? [];
  if (resized) return incident; // Exterior rails depend on the whole card height.
  if (!moved.size) return [];
  return [...incident].filter((wireId) => {
    const { from, to } = edgeById.get(wireId)!;
    return (from.nodeId === id && moved.has(from.portId)) || (to.nodeId === id && moved.has(to.portId));
  });
}

function rememberWire(edge: FixtureEdge): void {
  edgeById.set(edge.id, edge);
  for (const nodeId of [edge.from.nodeId, edge.to.nodeId]) {
    const incident = incidentEdges.get(nodeId) ?? new Set<string>();
    incident.add(edge.id);
    incidentEdges.set(nodeId, incident);
  }
}

function addCardShape(node: FixtureNode): void {
  const group = makeCard(node);
  cardGroups.set(node.id, group);
  cardLayer?.add(group);
  localFraming?.updateCard(node);
}

function applyEnrichment(changes: RemoteEnrichmentBatch<LocalGraph>, projection: LocalEnrichmentProjection): void {
  if (pageDisposed || enrichmentLifetime?.signal.aborted || !stage || !localFraming) return;

  const dirtyWires = new Set<string>();
  const newWires = new Set<string>();
  const changedGeometryWires = new Set<string>();
  const scene = {
    nodes: nodeById,
    patchCard(card: LocalCardPatch) {
      const incident = [...patchCard(card)];
      for (const edgeId of incident) changedGeometryWires.add(edgeId);
      return incident;
    },
    addCard(node: FixtureNode) {
      nodes.push(node);
      nodeById.set(node.id, node);
      addCardShape(node);
    },
    addWire(edge: FixtureEdge) {
      edges.push(edge);
      rememberWire(edge);
      newWires.add(edge.id);
    }
  };
  // Keep accepted order for first insertion, but compute each dirty route and reduce extents once.
  const before = localFraming.revision;
  for (const result of changes.results) {
    for (const id of projection.apply(result, scene)) dirtyWires.add(id);
  }
  for (const id of dirtyWires) {
    const edge = edgeById.get(id)!;
    updateWireGeometry(edge);
    if (newWires.has(id)) wireLayer?.add(makeWire(edge));
  }
  const eligibleForSettlement = new Set([...newWires, ...dirtyWires, ...changedGeometryWires]);
  const deferred = new Set<string>();
  for (const id of eligibleForSettlement) {
    const edge = edgeById.get(id);
    if (!edge) continue;
    const sourceDrag = activeDrags.get(edge.from.nodeId);
    const targetDrag = activeDrags.get(edge.to.nodeId);
    if (sourceDrag || targetDrag) {
      deferred.add(id);
      sourceDrag?.deferredEdgeIds.add(id);
      targetDrag?.deferredEdgeIds.add(id);
    }
  }
  if (eligibleForSettlement.size > deferred.size) {
    const settlementEdges = [...eligibleForSettlement].filter((id) => !deferred.has(id)).map((id) => edgeById.get(id)!).filter(Boolean);
    const settlement = laneReservations.settle(settlementEdges, nodeById);
    for (const edge of settlementEdges) {
      updateWireGeometry(edge);
    }
    void settlement.bucketCount;
    void settlement.candidateCount;
  }
  for (const id of deferred) {
    laneReservations.remove(id);
  }
  if (localFraming.revision !== before) localFraming.bounds();
  if (summary) summary.textContent = projection.summary(changes);
  if (dirtyWires.size) wireLayer?.batchDraw();
  if (changes.results.length || changes.finish) cardLayer?.batchDraw();
  // A finish must leave its draw queued before the scheduler retires; never cancel Konva's frame.
  if (changes.finish) enrichmentLifetime?.finish();
}

function setSelection(next: Selection): void {
  const previous = { nodeId: selectedNode, edgeId: selectedEdge };
  if (localMode) {
    const selectedIndex = next.nodeId ? nodes.findIndex(({ id }) => id === next.nodeId) : -1;
    if (selectedIndex >= 0) {
      keyboardCardId = next.nodeId;
      keyboardCardIndex = selectedIndex;
    } else {
      keyboardCardId = undefined;
      keyboardCardIndex = -1;
    }
  }
  if (previous.nodeId === next.nodeId && previous.edgeId === next.edgeId) return;
  const changed = selectionChanges(previous, next, edgeById);
  selectedNode = next.nodeId;
  selectedEdge = next.edgeId;
  for (const nodeId of changed.nodeIds) {
    const rect = cardShapes.get(nodeId)?.rect;
    rect?.stroke(selectedNode === nodeId ? colors.accent : colors.border);
    rect?.strokeWidth(selectedNode === nodeId ? 2.2 : 1);
  }
  // Wires consult selectedEdge in their scene function; one layer draw below updates both paths.
  for (const socketId of changed.socketIds) {
    const row = socketRows.get(socketId);
    if (!row) continue;
    const highlighted = selectedEdge !== undefined && (() => {
      const edge = edgeById.get(selectedEdge);
      if (!edge) return false;
      return `${edge.from.nodeId}:${edge.from.portId}` === socketId || `${edge.to.nodeId}:${edge.to.portId}` === socketId;
    })();
    const appearance = socketColor(row.port, highlighted);
    row.socket.stroke(appearance.stroke);
    row.socket.fill(appearance.fill);
    row.socket.radius(highlighted ? 5 : 4);
  }
  if (changed.edgeIds.size) wireLayer?.batchDraw();
  if (changed.nodeIds.size || changed.socketIds.size) cardLayer?.batchDraw();
}

function centerCamera(): void {
  const bounds = localFraming ? localFraming.bounds() : authoredWorldBounds;
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
    stageHost.addEventListener('pointerleave', () => { if (stage) stage.container().style.cursor = ''; });
    wireLayer = new Konva.Layer({ name: 'wires' });
    cardLayer = new Konva.Layer({ name: 'cards' });
    stage.add(wireLayer, cardLayer);
    for (const edge of edges) {
      updateWireGeometry(edge);
      const shape = makeWire(edge);
      wireLayer.add(shape);
    }
    for (const node of nodes) addCardShape(node);
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
      if (initial) {
        centerCamera();
        enrichmentLifetime?.sized();
      } else stage.batchDraw();
    });
    observer.observe(stageHost);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelection({});
        return;
      }
      if (!localMode || document.activeElement !== stageHost || !nodes.length) return;
      if (event.key === 'Enter' && keyboardCardId) {
        const node = nodeById.get(keyboardCardId);
        if (node && selectedNode === keyboardCardId && titleDestination(node)) {
          event.preventDefault();
          navigateToTitle(node);
        }
        return;
      }
      if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      keyboardCardIndex = (keyboardCardIndex + step + nodes.length) % nodes.length;
      const node = nodes[keyboardCardIndex]!;
      const card = cardGroups.get(node.id);
      if (card) { keyboardCardId = node.id; setSelection({ nodeId: node.id }); refreshActiveCardDescription(); }
    };
    document.addEventListener('keydown', onKeyDown);
    if (localMode) stageHost.addEventListener('focus', () => {
      if (keyboardCardIndex < 0 && selectedNode) keyboardCardIndex = nodes.findIndex(({ id }) => id === selectedNode);
      if (keyboardCardIndex < 0) keyboardCardIndex = 0;
      const node = nodes[keyboardCardIndex];
      const card = node ? cardGroups.get(node.id) : undefined;
      if (node && card) { keyboardCardId = node.id; setSelection({ nodeId: node.id }); refreshActiveCardDescription(); }
    });
    if (localMode) stageHost.addEventListener('blur', () => {
      keyboardCardId = undefined;
      refreshActiveCardDescription();
    });
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
      laneReservations.clear();
      activeDrags.clear();
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
if (localMode) {
  const label = document.querySelector<HTMLElement>('[data-experiment-label]');
  const title = document.querySelector<HTMLElement>('.experiment-header h1');
  if (label) label.textContent = 'Read-only local configuration';
  if (title) title.textContent = 'Local network topology';
  document.title = 'Local network topology · Konva canvas experiment';
}
function onPageHide(event: PageTransitionEvent): void {
  if (event.persisted) {
    localSnapshot?.suspend();
    enrichmentLifetime?.freeze();
    return;
  }
  pageDisposed = true;
  enrichmentLifetime?.cancel();
  localSnapshot?.dispose();
  sizeSelect?.removeEventListener('change', onSizeChange);
  window.removeEventListener('pagehide', onPageHide);
  window.removeEventListener('pageshow', onPageShow);
}

function onPageShow(event: PageTransitionEvent): void {
  if (!event.persisted || pageDisposed) return;
  syncSizeSelect();
  localSnapshot?.restore();
}

window.addEventListener('pagehide', onPageHide);
window.addEventListener('pageshow', onPageShow);

function setAccessibleMessage(message: string): void {
  if (!failure) return;
  failure.classList.remove('is-visually-hidden');
  failure.textContent = message;
  failure.hidden = false;
}

function installGraph(nextNodes: FixtureNode[], nextEdges: FixtureEdge[]): boolean {
  if (pageDisposed) return false;
  nodes = nextNodes;
  edges = nextEdges;
  for (const node of nodes) nodeById.set(node.id, node);
  for (const edge of edges) rememberWire(edge);
  if (localMode) laneReservations.seed(edges, nodeById);
  const mounted = initialize();
  if (!mounted) return false;
  function* initialRoutes(): IterableIterator<Curve[]> {
    for (const { curves } of wireGeometry.values()) yield curves;
  }
  // Synthetic Reset keeps its authored extents; local Reset uses live scene extents.
  if (!localFraming) authoredWorldBounds = graphBounds(nodes, initialRoutes());
  if (nodes.length === 0) setAccessibleMessage('No local or referenced nodes were found in the local configuration snapshot.');
  else if (failure) failure.hidden = true;
  return true;
}

async function loadLocalGraph(signal: AbortSignal): Promise<void> {
  let localMountFailed = false;
  // Keep all snapshot/model/layout code out of the default synthetic entry path.
  try {
    const { loadLocalSnapshot } = await import('./local-snapshot');
    if (pageDisposed || signal.aborted) return;
    const snapshot = await loadLocalSnapshot(signal);
    if (pageDisposed || signal.aborted) return;
    const [{ graphInputFromLocalSnapshot, buildLocalGraph, prepareRemoteOwnerInspection }, { placeLocalGraph }, { projectLocalGraph }] = await Promise.all([
      import('./local-graph'), import('./local-placement'), import('./local-projection')
    ]);
    if (pageDisposed || signal.aborted) return;
    const graph = buildLocalGraph(graphInputFromLocalSnapshot(snapshot));
    const positions = placeLocalGraph(graph);
    const projection = projectLocalGraph(graph, positions);
    if (!installGraph(projection.nodes, projection.edges)) {
      localMountFailed = true;
      throw new Error('Local topology canvas could not be rendered.');
    }
    if (summary) summary.textContent = projection.summary;
    const lifetime = enrichmentLifetime;
    if (!lifetime || !graph.eligibleRemoteOwners.length) return;
    lifetime.afterPaint((deadline) => {
      // Stage B has an independent error boundary, leaving the mounted local scene intact.
      const reportFailure = () => {
        if (!lifetime.signal.aborted && summary) summary.textContent += ' · Remote inspection unavailable';
        lifetime.cancel();
      };
      void Promise.all([import('./remote-enrichment'), import('./local-enrichment-projection')]).then(([scheduler, views]) => {
        if (!lifetime.canStart || pageDisposed || !stage) return;
        const liveProjection = new views.LocalEnrichmentProjection(graph, projection);
        lifetime.attach(scheduler.startRemoteEnrichment({
          owners: graph.eligibleRemoteOwners,
          depth: inspectionDepth,
          signal: lifetime.signal,
          deadline,
          prepare: (owner, bindings, collectFollowUps) => prepareRemoteOwnerInspection(owner, bindings, collectFollowUps ? graph.nodes : undefined),
          apply(changes) {
            try { applyEnrichment(changes, liveProjection); }
            catch { reportFailure(); }
          }
        }));
      }).catch(() => { if (lifetime.canStart) reportFailure(); });
    });
  } catch (error) {
    if (pageDisposed || signal.aborted) return;
    if (summary) summary.textContent = 'Local configuration unavailable';
    setAccessibleMessage(localMountFailed
      ? 'Local topology canvas could not be rendered.'
      : error instanceof Error && error.name === 'AbortError'
        ? 'Local topology loading was cancelled.' : 'Local topology could not be loaded from this page origin.');
  }
}

if (localMode) {
  setAccessibleMessage('Loading local topology snapshot…');
  localSnapshot?.start();
} else {
  const fixture = createFixture(nodeCount);
  installGraph(fixture.nodes, fixture.edges);
}
