import Konva from 'konva';
import './style.css';
import { getStoredTheme, getSystemThemeMediaQuery, isNodelTheme, storeTheme, THEME_STORAGE_KEY, type NodelTheme } from '../../theme/theme';
import {
  CARD_HEADER_HEIGHT, FIXTURE_NODE_COUNTS, cardHeight, createFixture, curveArrow, edgeCurves, overflowSocketOffset, portRowCenter, portWindowEdgeRoute,
  type Curve, type FixtureEdge, type FixtureNode, type FixtureNodeCount, type Point, type PortSide
} from './fixture';
import type { LocalGraph } from './local-graph';
import type { PreviewCallbacks, PreviewRenderer } from './preview-coordinator';
import type { TopologyStartupShell } from './startup-shell';
import type { LocalCardPatch, LocalEnrichmentProjection } from './local-enrichment-projection';
import type { RemoteEnrichmentBatch } from './remote-enrichment';
import { fittedCameraScale, graphBounds, selectionChanges, type Selection } from './camera-selection';
import { LocalFraming } from './local-framing';
import { localNodePath } from '../../utils/urls';
import { isUsableNodeName } from '../../utils/node-name';
import { networkNodeSearchHref } from '../../navigation/node-links';
import { LocalLaneReservations } from './lane-reservations';
import { OVERFLOW_DIRECTIONS, PORT_SIDES, TOP_RAIL_HEIGHT, canExpandFootprint, type OverflowDirection, type TakeoffRole } from './card-footprint';
import { portLabelBounds, portLabelLayouts } from './port-label-layout';
import { BindingChooser, bindingChoices, bindingEndpointMatches, type ChooserContext } from './binding-chooser';
import { PORT_WHEEL_BURST_QUIET_MS, portWheelStep, type PortWindowMode } from './port-wheel';
import { EdgeNavigation } from './edge-navigation';
import './binding-chooser.css';
import type { LocalWirePairs } from './local-projection';
import type { LocalCardRectangle } from './local-placement';
import {
  captureSessionCamera, mergeSessionCardPositions, readSessionLayout, retirePendingSessionCards, sessionCameraPosition,
  SESSION_LAYOUT_MIN_SCALE, SessionLayoutWriter, writeSessionLayout,
  type SessionCamera, type SessionCardPosition
} from './session-layout';

const host = document.querySelector<HTMLElement>('#diagram');
const failure = host?.querySelector<HTMLElement>('.canvas-failure');
const summary = document.querySelector<HTMLElement>('[data-fixture-summary]');
const query = new URLSearchParams(window.location.search);
declare const __KONVA_PORT_WINDOW_MODE__: PortWindowMode;
const portWindowMode = typeof __KONVA_PORT_WINDOW_MODE__ === 'undefined' ? 'chooser' : __KONVA_PORT_WINDOW_MODE__;
const localMode = document.documentElement.dataset.topologyRealMode === 'true' || query.get('source') === 'local';
const stageHost = document.createElement('div');
stageHost.className = 'canvas-stage';
stageHost.tabIndex = localMode ? 0 : -1;
stageHost.setAttribute('role', 'img');
const diagramLabel = localMode ? 'Topology diagram. Arrow keys select a card; [ and ] inspect its port names; Enter opens its title; P opens ports and bindings.' : 'Room network diagram.';
stageHost.setAttribute('aria-label', diagramLabel);
if (host) host.append(stageHost);

let colors = readColors();
const requestedNodeCount = Number(query.get('nodes'));
const nodeCount: FixtureNodeCount = FIXTURE_NODE_COUNTS.includes(requestedNodeCount as FixtureNodeCount) ? requestedNodeCount as FixtureNodeCount : 9;
const localFraming = localMode ? new LocalFraming() : undefined;
let previewFrozen = false;
let pageDisposed = false;
let nodes: FixtureNode[] = [];
let edges: FixtureEdge[] = [];
const nodeById = new Map<string, FixtureNode>();
const edgeById = new Map<string, FixtureEdge>();
const incidentEdges = new Map<string, Set<string>>();
const portIncidentEdges = new Map<string, Map<string, Set<string>>>();
const wireGeometry = new Map<string, { curves: Curve[]; arrow: ReturnType<typeof curveArrow> }>();
const laneReservations = new LocalLaneReservations();
interface ActiveCardDrag {
  origin: Point;
  didMove: boolean;
  reservationsReleased: boolean;
  deferredEdgeIds: Set<string>;
}
const activeDrags = new Map<string, ActiveCardDrag>();
const pinnedCardIds = new Set<string>();
const getSessionStorage = () => window.sessionStorage;
let pendingLayoutCards: Map<string, SessionCardPosition> | undefined;
let initialSessionCamera: SessionCamera | undefined;
let lastValidSessionCamera: SessionCamera | undefined;
let restoreLateCard: ((node: FixtureNode) => void) | undefined;
let pendingSavedAnchors: (() => Iterable<LocalCardRectangle>) | undefined;
let pendingAnchorOverlaps: ((card: FixtureNode, height: number) => boolean) | undefined;
let panOrigin: { position: Point; scale: number } | undefined;
const sessionLayoutWriter = localMode ? new SessionLayoutWriter(persistSessionLayout) : undefined;
sessionLayoutWriter?.setDiscovering(true);
let writeWhenDrawable = false;
let authoredWorldBounds: ReturnType<typeof graphBounds>;
let initialPreviewBounds: ReturnType<typeof graphBounds>;

let stage: Konva.Stage | undefined;
let edgeNavigation: EdgeNavigation | undefined;
let wireLayer: Konva.Layer | undefined;
let cardLayer: Konva.Layer | undefined;
let selectedNode: string | undefined;
let selectedEdge: string | undefined;
let viewportWidth = 0;
let viewportHeight = 0;
let viewportDrawable = false;
const cardGroups = new Map<string, Konva.Group>();
interface PortRow { label: Konva.Text; socket: Konva.Circle; port: FixtureNode['ports'][number] }
const socketRows = new Map<string, PortRow>();
const footprintRowPools = new Map<string, Record<PortSide, PortRow[]>>();
interface CardShapes { rect: Konva.Rect; header: Konva.Rect; divider: Konva.Line; dot?: Konva.Circle; title: Konva.Text; status: Konva.Text; host?: Konva.Group }
const cardShapes = new Map<string, CardShapes>();

function edgeCamera() {
  if (!stage) return;
  return { width: viewportWidth, height: viewportHeight, x: stage.x(), y: stage.y(), scale: stage.scaleX() };
}

function syncEdgeCamera(moving = false): void {
  const camera = edgeCamera();
  if (!camera) return;
  if (moving) edgeNavigation?.updateDuringCameraGesture(camera);
  else edgeNavigation?.updateViewport(camera);
}

function syncEdgeCardGeometry(): void {
  edgeNavigation?.markGeometryDirty();
}
interface OverflowRail {
  group: Konva.Group;
  label: Konva.Text;
  chevron: Konva.Line;
  pageHit: Konva.Rect;
  sockets: Record<TakeoffRole, Konva.Circle>;
  socketHits: Record<TakeoffRole, Konva.Rect>;
}
type CardRails = Partial<Record<PortSide, Record<OverflowDirection, OverflowRail>>>;
const overflowRails = new Map<string, CardRails>();
let bindingChooser: BindingChooser | undefined;
let portsControl: HTMLButtonElement | undefined;
let pageControls: HTMLElement | undefined;
const pageButtons: Array<{ side: PortSide; direction: OverflowDirection; button: HTMLButtonElement }> = [];
let restoreCardFocus: string | undefined;
let sceneWirePairs: LocalWirePairs | undefined;
let keyboardCardIndex = -1;
let hoveredCardId: string | undefined;
let keyboardCardId: string | undefined;
let activePortId: string | undefined;
let keyboardPortSide: PortSide | undefined;
let hoveredRail: { nodeId: string; side: PortSide; direction: OverflowDirection } | undefined;

function persistSessionLayout(): void {
  if (!stage || !nodes.length) return;
  const rect = stageHost.getBoundingClientRect();
  if (!viewportDrawable || !positiveViewport(rect)) {
    writeWhenDrawable = true;
    return;
  }
  const camera = captureSessionCamera(panOrigin?.position ?? stage.position(), panOrigin?.scale ?? stage.scaleX(),
    { width: viewportWidth, height: viewportHeight });
  lastValidSessionCamera = camera ?? lastValidSessionCamera;
  const cards = mergeSessionCardPositions(nodeById, pinnedCardIds, pendingLayoutCards,
    (id, point) => activeDrags.get(id)?.origin ?? point);
  writeSessionLayout(getSessionStorage, cards, lastValidSessionCamera);
}

function markPlacementDirty(): void {
  if (!sessionLayoutWriter) return;
  if (viewportDrawable) sessionLayoutWriter.schedule();
  else writeWhenDrawable = true;
}

function readColors(): { surface: string; background: string; foreground: string; muted: string; border: string; accent: string; grid: string; wire: string; action: string; actionStrong: string; event: string; eventStrong: string } {
  const style = getComputedStyle(document.documentElement);
  const resolve = (token: string, fallback: string) => style.getPropertyValue(token).trim() || fallback;
  return {
    surface: `rgb(${resolve('--nodel-surface', '255 255 255')})`,
    background: `rgb(${resolve('--nodel-bg', '250 250 250')})`,
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
    shapes.rect.fill(isMutedLocalCard(node) ? colors.background : colors.surface);
    shapes.rect.stroke(selectedNode === node.id ? colors.accent : colors.border);
    shapes.rect.strokeWidth(selectedNode === node.id ? 2.2 : 1);
    shapes.header.fill(isMutedLocalCard(node) ? colors.background : colors.surface);
    shapes.title.fill(colors.foreground);
    shapes.status.fill(colors.muted);
    shapes.divider.stroke(colors.border);
    if (shapes.host) repaintHostGlyph(shapes.host);
    positionRows(node, (port) => {
      const socket = socketRows.get(`${node.id}:${port.id}`)?.socket;
      const selected = selectedEdge ? edgeById.get(selectedEdge) : undefined;
      const highlighted = !!selected && (selected.from.nodeId === node.id && selected.from.portId === port.id || selected.to.nodeId === node.id && selected.to.portId === port.id);
      const appearance = socketColor(port, highlighted);
      socket?.fill(appearance.fill);
      socket?.stroke(appearance.stroke);
      socket?.radius(highlighted ? 5 : 4);
    });
    const labels = cardGroups.get(node.id)?.find('Text') ?? [];
    labels.forEach((label, index) => {
      if (label instanceof Konva.Text) label.fill(index === 0 ? colors.foreground : colors.muted);
    });
    repaintOverflowRails(node);
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

function updateWireGeometry(edge: FixtureEdge, curves = edgeCurves(edge, nodeById)): boolean {
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
function isMutedLocalCard(node: FixtureNode): boolean {
  if (node.origin === 'local') return ['Not inspected', 'Unreachable', 'Identity unresolved', 'Invalid response'].includes(node.displayQualifier ?? '');
  if (node.origin !== 'referenced') return false;
  return node.displayQualifier !== '' && node.displayQualifier !== 'Bindings partially loaded';
}

function makePortRow(group: Konva.Group, node: FixtureNode, port: FixtureNode['ports'][number], y: number): PortRow {
  const { side } = port;
  const bounds = portLabelBounds(node.width, side, false);
  const label = new Konva.Text({
    x: bounds.x, y: y - 7, width: bounds.width,
    align: side === 'left' ? 'left' : 'right', text: port.label,
    fontFamily: 'system-ui, sans-serif', fontSize: 11, fill: colors.muted, listening: false, ellipsis: true, wrap: 'none'
  });
  const appearance = socketColor(port, false);
  const socket = new Konva.Circle({ x: side === 'left' ? 0 : node.width, y, radius: 4, fill: appearance.fill, stroke: appearance.stroke, strokeWidth: 1.5, listening: false, name: `socket-${node.id}-${port.id}` });
  const row = { label, socket, port };
  bindPortRow(node, row, port);
  group.add(label, socket);
  return row;
}

function bindPortRow(node: FixtureNode, row: PortRow, port: FixtureNode['ports'][number]): void {
  row.port = port;
  row.label.text(port.label);
  row.socket.name(`socket-${node.id}-${port.id}`);
  row.socket.setAttrs({ localKind: port.localKind, portId: port.id, accessibleDescription: port.label });
  socketRows.set(`${node.id}:${port.id}`, row);
}

function positionRows(node: FixtureNode, visit: (port: FixtureNode['ports'][number], y: number) => void): void {
  const footprint = node.footprint;
  if (footprint) {
    for (const side of PORT_SIDES) {
      let row = 0;
      for (const port of footprint.visible(side)) visit(port, portRowCenter(row++));
    }
    return;
  }
  const sides = { left: 0, right: 0 };
  for (const port of node.ports) visit(port, portRowCenter(sides[port.side]++));
}

function syncPortLabelBounds(node: FixtureNode): void {
  const positioned: Array<{ port: FixtureNode['ports'][number]; y: number }> = [];
  positionRows(node, (port, y) => positioned.push({ port, y }));
  const layouts = portLabelLayouts(node.width, positioned.map(({ port, y }) => ({ id: port.id, side: port.side, row: y })));
  for (const { port, y } of positioned) {
    const row = socketRows.get(`${node.id}:${port.id}`);
    if (!row) continue;
    const bounds = layouts.get(port.id)!;
    row.label.position({ x: bounds.x, y: y - 7 });
    row.label.width(bounds.width);
  }
}

function positionPortAtPoint(node: FixtureNode, x: number, y: number): FixtureNode['ports'][number] | undefined {
  const rows: Array<{ port: FixtureNode['ports'][number]; y: number }> = [];
  positionRows(node, (port, rowY) => rows.push({ port, y: rowY }));
  const layouts = portLabelLayouts(node.width, rows.map(({ port, y: rowY }) => ({ id: port.id, side: port.side, row: rowY })));
  return rows.find(({ port, y: rowY }) => {
    if (Math.abs(y - rowY) > 7) return false;
    const bounds = layouts.get(port.id)!;
    return x >= bounds.x && x <= bounds.x + bounds.width;
  })?.port;
}

function refreshHoveredPortAfterGeometryChange(node: FixtureNode, group: Konva.Group): void {
  if (!stage || keyboardCardId || hoveredCardId !== node.id || activeDrags.has(node.id)) return;
  const pointer = stage.getPointerPosition();
  if (!pointer) return;
  const point = group.getAbsoluteTransform().copy().invert().point(pointer);
  const rail = hoveredRail?.nodeId === node.id ? hoveredRail : undefined;
  if (rail && !node.footprint?.overflowCount(rail.side, rail.direction)) hoveredRail = undefined;
  const shapes = cardShapes.get(node.id);
  const title = shapes?.title;
  const inTitle = Boolean(title && titleDestination(node) && point.x >= title.x() && point.x <= title.x() + Math.min(title.width(), title.getTextWidth()) && point.y >= title.y() && point.y <= title.y() + title.height());
  const port = inTitle ? undefined : positionPortAtPoint(node, point.x, point.y);
  if (port?.id === activePortId) return;
  activePortId = port?.id;
  refreshActiveCardDescription();
}

const roles = ['alias', 'local'] as const;

function ensureOverflowRails(group: Konva.Group, node: FixtureNode): void {
  const footprint = node.footprint!;
  const rails = overflowRails.get(node.id) ?? {};
  const makeRail = (side: PortSide, direction: OverflowDirection): OverflowRail => {
    const x = side === 'left' ? 0 : node.width;
    const left = side === 'left';
    const height = direction === 'above' ? TOP_RAIL_HEIGHT : 32;
    const rail = new Konva.Group({ x, name: `overflow-rail-${side}${direction === 'above' ? '-above' : ''}`, visible: false });
    rail.setAttrs({ portSide: side, overflowDirection: direction });
    const label = new Konva.Text({ x: left ? 35 : -36, width: 36, y: (height - 12) / 2, fontSize: 12, fontStyle: 'bold', fontFamily: 'system-ui, sans-serif', align: left ? 'left' : 'center', listening: false });
    const caretX = left ? 25 : -46;
    const caretY = height / 2;
    const up = direction === 'above';
    const chevron = new Konva.Line({ points: [caretX - 4, caretY + (up ? 2 : -2), caretX, caretY + (up ? -2 : 2), caretX + 4, caretY + (up ? 2 : -2)], strokeWidth: 1.7, lineCap: 'round', lineJoin: 'round', listening: false });
    const hit = new Konva.Rect({ x: left ? 34 : -36, y: 0, width: 37, height, fill: 'transparent', name: 'overflow-rail-hit' });
    const pageHit = new Konva.Rect({ x: left ? 10 : -64, y: 0, width: left ? 24 : 28, height, fill: 'transparent', name: 'overflow-page-hit' });
    const makeSocket = (role: TakeoffRole) => new Konva.Circle({ x: 0, y: overflowSocketOffset(direction, role), radius: 4, strokeWidth: 1.5, listening: false, name: `overflow-takeoff-${role}` });
    const sockets = { alias: makeSocket('alias'), local: makeSocket('local') };
    const socketHitHalf = direction === 'above' ? 5 : 7;
    const makeSocketHit = (role: TakeoffRole) => new Konva.Rect({ x: -7, y: overflowSocketOffset(direction, role) - socketHitHalf, width: 15, height: 2 * socketHitHalf, fill: 'transparent', name: `overflow-role-hit-${role}` });
    const socketHits = { alias: makeSocketHit('alias'), local: makeSocketHit('local') };
    rail.add(hit, pageHit, label, chevron, sockets.alias, sockets.local, socketHits.alias, socketHits.local);
    rail.on('click tap', event => {
      event.cancelBubble = true;
      if ((event.evt as MouseEvent).button === 2) return;
      if (event.target === pageHit && node.footprint?.canScroll(side)) {
        turnPortPage(node.id, side, direction);
        return;
      }
      const role = roles.find(role => event.target === socketHits[role]);
      openBindingChooser({ nodeId: node.id, side, direction, ...(role ? { role } : {}) });
    });
    rail.on('mousemove', event => {
      event.cancelBubble = true;
      hoveredRail = { nodeId: node.id, side, direction };
      activePortId = keyboardCardId ? activePortId : undefined;
      stage?.container().style.setProperty('cursor', 'pointer');
      const target: unknown = event.target.getAttr('accessibleDescription');
      if (typeof target === 'string') stage?.container().setAttribute('title', target);
    });
    rail.on('mouseleave', () => {
      if (hoveredRail?.nodeId === node.id && hoveredRail.side === side && hoveredRail.direction === direction) {
        hoveredRail = undefined;
        refreshActiveCardDescription();
      }
    });
    group.add(rail);
    return { group: rail, label, chevron, pageHit, sockets, socketHits };
  };
  for (const side of PORT_SIDES) {
    if (!rails[side] && footprint.overflowCount(side)) rails[side] = { above: makeRail(side, 'above'), below: makeRail(side, 'below') };
    for (const direction of OVERFLOW_DIRECTIONS) rails[side]?.[direction].group.moveToTop();
  }
  if (rails.left || rails.right) overflowRails.set(node.id, rails);
}

const hiddenPortDescription = (count: number, side: PortSide, direction: OverflowDirection) =>
  `${count} hidden ${side} ${count === 1 ? 'port' : 'ports'} ${direction} the window`;

function repaintOverflowRails(node: FixtureNode): void {
  const footprint = node.footprint;
  const rails = overflowRails.get(node.id);
  if (!footprint || !rails) return;
  const selected = selectedEdge ? edgeById.get(selectedEdge) : undefined;
  const endpoints = [selected?.from, selected?.to].filter(point => point?.nodeId === node.id);
  const takeoffs = endpoints.map(point => footprint.attachment(point!.portId));
  for (const side of PORT_SIDES) {
    for (const direction of OVERFLOW_DIRECTIONS) {
      const rail = rails[side]?.[direction];
      if (!rail) continue;
      const count = footprint.overflowCount(side, direction);
      rail.group.visible(count > 0);
      if (!count) continue;
      rail.group.y(footprint.railTop(direction));
      const description = hiddenPortDescription(count, side, direction);
      rail.group.setAttr('accessibleDescription', `${description}. Open bindings.`);
      rail.group.findOne('.overflow-rail-hit')?.setAttr('accessibleDescription', `${description}. Open bindings.`);
      rail.pageHit.setAttr('accessibleDescription', footprint.canScroll(side) ? `${description}. ${direction === 'above' ? 'Previous' : 'Next'} page.` : `${description}. Open bindings.`);
      rail.label.text(String(count)).fill(colors.muted);
      rail.chevron.stroke(colors.muted);
      for (const role of roles) {
        const socket = rail.sockets[role];
        const highlighted = takeoffs.some(attachment => attachment?.side === side && 'role' in attachment && attachment.direction === direction && attachment.role === role);
        const hue = highlighted && selected ? wireColor(selected, true) : colors.wire;
        const hidden = footprint.overflowCount(side, direction, role);
        socket.visible(hidden > 0);
        rail.socketHits[role].visible(hidden > 0);
        rail.socketHits[role].setAttr('accessibleDescription', `${hidden} hidden ${side} ${role === 'alias' ? 'remote aliases' : 'local endpoints'} ${direction} the window. Open bindings.`);
        socket.stroke(hue).fill(role === 'local' ? hue : colors.surface).radius((highlighted ? 5 : 4) - (direction === 'above' ? 0.5 : 0));
      }
    }
  }
}

function syncFootprintRows(node: FixtureNode, group: Konva.Group): void {
  const footprint = node.footprint!;
  const pools = footprintRowPools.get(node.id) ?? { left: [], right: [] };
  if (!footprintRowPools.has(node.id)) footprintRowPools.set(node.id, pools);
  const selected = selectedEdge ? edgeById.get(selectedEdge) : undefined;
  for (const side of PORT_SIDES) {
    const pool = pools[side];
    // Clear the old logical mappings first: a retained port may move to another slot.
    for (const row of pool) socketRows.delete(`${node.id}:${row.port.id}`);
    let slot = 0;
    for (const port of footprint.visible(side)) {
      const y = portRowCenter(slot);
      let row = pool[slot];
      if (!row) { row = makePortRow(group, node, port, y); pool.push(row); }
      else {
        bindPortRow(node, row, port);
        if (!row.label.getParent()) group.add(row.label, row.socket);
      }
      const highlighted = selected?.from.nodeId === node.id && selected.from.portId === port.id || selected?.to.nodeId === node.id && selected.to.portId === port.id;
      const appearance = socketColor(port, highlighted);
      row.socket.fill(appearance.fill).stroke(appearance.stroke).radius(highlighted ? 5 : 4);
      slot++;
    }
    for (; slot < pool.length; slot++) { pool[slot]!.label.remove(); pool[slot]!.socket.remove(); }
  }
  syncPortLabelBounds(node);
  refreshHoveredPortAfterGeometryChange(node, group);
  ensureOverflowRails(group, node);
  repaintOverflowRails(node);
}

let portWheelFrame: number | undefined;
let portWheelTimeout: number | undefined;
let portWheelRemainder: { nodeId: string; side: PortSide; pixels: number } | undefined;
const pendingPortWindows = new Map<string, Partial<Record<PortSide, number>>>();

function updatePortWindows(changes: ReadonlyMap<string, readonly string[]>, refreshChooser = true): void {
  const dirty = new Set<string>();
  for (const [nodeId, ports] of changes) {
    if (!ports.length) continue;
    const node = nodeById.get(nodeId)!;
    const byPort = portIncidentEdges.get(nodeId);
    for (const id of ports) for (const edgeId of byPort?.get(id) ?? []) dirty.add(edgeId);
    syncFootprintRows(node, cardGroups.get(nodeId)!);
    if (nodeId === keyboardCardId && activePortId && !socketRows.has(`${nodeId}:${activePortId}`)) {
      activePortId = undefined;
    }
    if (nodeId === keyboardCardId || nodeId === hoveredCardId) refreshActiveCardDescription();
    if (nodeId === selectedNode) syncPortsControl();
    cardLayer?.batchDraw();
  }
  let wireChanged = false;
  for (const edgeId of dirty) {
    const edge = edgeById.get(edgeId)!;
    const sourceDrag = activeDrags.get(edge.from.nodeId);
    const targetDrag = activeDrags.get(edge.to.nodeId);
    const { curves, rail, offset } = portWindowEdgeRoute(edge, nodeById);
    if (!updateWireGeometry(edge, curves)) continue;
    wireChanged = true;
    if (sourceDrag || targetDrag) {
      sourceDrag?.deferredEdgeIds.add(edgeId);
      targetDrag?.deferredEdgeIds.add(edgeId);
      laneReservations.remove(edgeId);
    } else {
      laneReservations.replaceRenderedRail(edge, nodeById, rail, offset);
    }
  }
  if (wireChanged) wireLayer?.batchDraw();
  if (refreshChooser && changes.size) bindingChooser?.refresh();
}

function flushPortWheel(): void {
  portWheelFrame = undefined;
  const changes = new Map<string, string[]>();
  for (const [id, windows] of pendingPortWindows) {
    const footprint = nodeById.get(id)?.footprint;
    if (!footprint) continue;
    const moved = PORT_SIDES.flatMap(side => {
      const next = windows[side];
      return next === undefined ? [] : footprint.move(side, next);
    });
    if (moved.length) changes.set(id, moved);
  }
  pendingPortWindows.clear();
  updatePortWindows(changes);
}

/** A discrete input or lifecycle boundary supersedes any not-yet-painted step. */
function finishPortWheel(): void {
  if (portWheelFrame !== undefined) window.cancelAnimationFrame(portWheelFrame);
  portWheelFrame = undefined;
  if (portWheelTimeout !== undefined) window.clearTimeout(portWheelTimeout);
  portWheelTimeout = undefined;
  portWheelRemainder = undefined;
  pendingPortWindows.clear();
}

function scrollPortsAtPointer(target: Konva.Node, event: WheelEvent, pointer: Point): boolean {
  if (portWindowMode === 'chooser' || !localMode || event.ctrlKey || !viewportDrawable) return false;
  const group = target.findAncestor('.topology-card');
  const node = group && nodeById.get(group.id());
  if (!group || !node?.footprint) return false;
  const point = group.getAbsoluteTransform().copy().invert().point(pointer);
  if (point.x < 0 || point.x > node.width || point.y < CARD_HEADER_HEIGHT || point.y >= node.footprint.height) return false;
  const side = point.x < node.width / 2 ? 'left' : 'right';
  const footprint = node.footprint;
  if (!footprint.overflowCount(side)) return false;
  if (!footprint.canScroll(side)) return false; // No window to scroll until explicit expansion.
  const windows = pendingPortWindows.get(node.id) ?? {};
  const start = windows[side] ?? footprint.start(side);
  const max = footprint.maxStart(side);
  const prior = portWheelRemainder?.nodeId === node.id && portWheelRemainder.side === side ? portWheelRemainder.pixels : 0;
  const movement = portWheelStep(event.deltaY, event.deltaMode, footprint.rows[side], prior, portWindowMode);
  const next = Math.max(0, Math.min(max, start + movement.rows));
  portWheelRemainder = { nodeId: node.id, side, pixels: (next === 0 && movement.remainder < 0 || next === max && movement.remainder > 0) ? 0 : movement.remainder };
  if (next !== start) {
    windows[side] = next;
    pendingPortWindows.set(node.id, windows);
    if (portWindowMode !== 'D') portWheelFrame ??= window.requestAnimationFrame(flushPortWheel);
  }
  if (portWheelTimeout !== undefined) window.clearTimeout(portWheelTimeout);
  portWheelTimeout = window.setTimeout(() => {
    portWheelTimeout = undefined;
    portWheelRemainder = undefined;
    // Once per quiet burst, prepare the final geometry for Konva's next batched draw.
    // Waiting for our own rAF here would add a second frame to the commit.
    if (portWindowMode === 'D' && pendingPortWindows.size) flushPortWheel();
  }, portWindowMode === 'D' ? PORT_WHEEL_BURST_QUIET_MS : 140);
  return true;
}

function turnPortPage(nodeId: string, side: PortSide, direction: OverflowDirection, byRow = false): void {
  const footprint = nodeById.get(nodeId)?.footprint;
  if (!footprint?.canScroll(side) || activeDrags.size || panOrigin) return;
  finishPortWheel();
  const delta = (direction === 'above' ? -1 : 1) * (byRow ? 1 : footprint.rows[side]);
  const moved = footprint.move(side, footprint.start(side) + delta);
  if (!moved.length) return;
  updatePortWindows(new Map([[nodeId, moved]]));
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
    const overflow = PORT_SIDES.flatMap(side => OVERFLOW_DIRECTIONS.flatMap(direction => {
      const count = node.footprint?.overflowCount(side, direction) ?? 0;
      return count ? [`${hiddenPortDescription(count, side, direction)}.`] : [];
    }));
    const portKeys = PORT_SIDES.some(side => node.footprint?.canScroll(side))
      ? 'Shift and Left or Right chooses a port side; Page Up and Page Down move by page.' +
        (portWindowMode === 'chooser' ? '' : ' Shift and Page Up or Page Down move by row.') : '';
    const port = activePortId ? socketRows.get(`${node.id}:${activePortId}`)?.port : undefined;
    const portDetail = port ? `Port: ${port.label}.` : '';
    const detail = [node.tooltip, linkLabel, ...overflow, portDetail, 'Press [ and ] to inspect port names; P opens ports and bindings.', portKeys].filter(Boolean).join(' ');
    const description = `${node.name}. ${detail}`;
    const rail = !keyboardCardId && hoveredRail?.nodeId === node.id ? hoveredRail : undefined;
    const railCount = rail && node.footprint?.overflowCount(rail.side, rail.direction);
    stage?.container().setAttribute('title', rail && railCount ? `${hiddenPortDescription(railCount, rail.side, rail.direction)}. Open bindings.` : port ? `${port.label} — ${node.tooltip}` : headerTooltip(node.tooltip, linkLabel));
    stageHost.setAttribute('aria-label', description);
    group.setAttr('accessibleDescription', description);
    setCardAccessibleMessage(description);
    return;
  }
  const container = stage?.container();
  container?.removeAttribute('title');
  if (activeId) cardGroups.get(activeId)?.setAttr('accessibleDescription', '');
  activePortId = undefined;
  stageHost.setAttribute('aria-label', diagramLabel);
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
  const cardSurface = isMutedLocalCard(node) ? colors.background : colors.surface;
  // Konva otherwise composites a full stage-sized shadow buffer per filled,
  // stroked card per repaint. The fill already provides the card shadow.
  const rect = new Konva.Rect({ x: 0, y: 0, width: node.width, height, fill: cardSurface, stroke: colors.border, strokeWidth: 1, cornerRadius: 10, shadowColor: '#142536', shadowBlur: 11, shadowOpacity: 0.1, shadowOffsetY: 3, ...(localMode || nodes.length > 9 ? { shadowForStrokeEnabled: false } : {}) });
  group.add(rect);
  const header = new Konva.Rect({ x: 1, y: 1, width: node.width - 2, height: CARD_HEADER_HEIGHT - 1, fill: cardSurface, cornerRadius: [9, 9, 0, 0], listening: false });
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
    group.on('mouseenter', () => {
      hoveredCardId = node.id;
      if (!keyboardCardId) activePortId = undefined;
      refreshActiveCardDescription();
    });
    group.on('mouseleave', () => {
      if (hoveredCardId === node.id) hoveredCardId = undefined;
      if (hoveredRail?.nodeId === node.id) hoveredRail = undefined;
      if (!keyboardCardId) activePortId = undefined;
      if (stage) stage.container().style.cursor = '';
      refreshActiveCardDescription();
    });
  }
  cardShapes.set(node.id, { rect, header, divider, ...(dot ? { dot } : {}), title, status, ...(hostGlyph ? { host: hostGlyph } : {}) });
  syncTitleLink(node, cardShapes.get(node.id)!);
  const visibleTitleWidth = () => Math.min(title.width(), title.getTextWidth());
  group.add(divider);
  // Keep the existing left-then-right child order on the initial mount.
  if (node.footprint) {
    syncFootprintRows(node, group);
  } else {
    for (const side of PORT_SIDES) {
      let row = 0;
      for (const port of node.ports) {
        if (port.side === side) makePortRow(group, node, port, portRowCenter(row++));
      }
    }
    syncPortLabelBounds(node);
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
    setSelection({ nodeId: node.id }, 'pointer');
    refreshActiveCardDescription();
  });
  group.on('mousemove', () => {
    if (!stage) return;
    // Hover must not displace an explicit keyboard selection. A pointer
    // click changes selection through setSelection and releases that priority.
    const pointer = stage.getPointerPosition();
    const point = pointer ? group.getAbsoluteTransform().copy().invert().point(pointer) : undefined;
    const inTitle = Boolean(point && titleDestination(node) && point.x >= title.x() && point.x <= title.x() + visibleTitleWidth() && point.y >= title.y() && point.y <= title.y() + title.height());
    stage.container().style.cursor = inTitle ? 'pointer' : '';
    refreshHoveredPortAfterGeometryChange(node, group);
  });
  let cardDragMoved = false;
  group.on('dragstart', () => {
    cardDragMoved = false;
    if (!localMode) return;
    if (activeDrags.has(node.id)) return;
    finishPortWheel();
    releaseCardLaneReservations(node);
    sessionLayoutWriter?.setGestureActive(true);
    activeDrags.set(node.id, {
      origin: { x: node.x, y: node.y },
      didMove: false,
      reservationsReleased: true,
      deferredEdgeIds: new Set()
    });
  });
  group.on('dragmove', () => {
    // Konva emits dragstart before dragmove; pointer movement never allocates lanes.
    if (moveCard(node, group)) cardDragMoved = true;
  });
  group.on('dragend', () => {
    const movedDuringGesture = cardDragMoved;
    cardDragMoved = false;
    if (!localMode) {
      moveCard(node, group);
      // The dragmove handler already copied its final position to the model,
      // so moveCard may be false here. Synthetic cards have no other gesture
      // bookkeeping: refresh once per completed drop, never per drag frame.
      syncEdgeCardGeometry();
      return;
    }
    const drag = activeDrags.get(node.id);
    const movedAtEnd = moveCard(node, group);
    const moved = movedAtEnd || movedDuringGesture ||
      Boolean(drag && (drag.didMove || drag.origin.x !== group.x() || drag.origin.y !== group.y()));
    activeDrags.delete(node.id);
    if (moved) syncEdgeCardGeometry();
    sessionLayoutWriter?.setGestureActive(!!panOrigin || activeDrags.size > 0);
    if (moved) pinnedCardIds.add(node.id);
    if (moved || drag?.reservationsReleased || drag?.deferredEdgeIds.size) {
      settleCardLanes(node, drag?.deferredEdgeIds);
    }
    if (moved) sessionLayoutWriter?.schedule();
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
  const cardSurface = isMutedLocalCard(node) ? colors.background : colors.surface;
  if (shapes.rect.fill() !== cardSurface) shapes.rect.fill(cardSurface);
  if (shapes.header.fill() !== cardSurface) shapes.header.fill(cardSurface);
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

  if (node.footprint) {
    // Append only the first time an ID is seen. Inventory ordering and new
    // references never change previously visible or overflow attachments.
    node.footprint.append(patch.ports);
    node.ports = patch.ports;
    syncFootprintRows(node, group);
    refreshActiveCardDescription();
    if (selectedNode === id) syncPortsControl();
    return [];
  }

  // Keep the node and each native row in place. Replace only the immutable layout input.
  const moved = new Set<string>();
  node.ports = patch.ports;
  const height = cardHeight(node);
  const resized = shapes.rect.height() !== height;
  if (resized) {
    shapes.rect.height(height);
    localFraming?.updateCard(node);
    syncEdgeCardGeometry();
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
  syncPortLabelBounds(node);
  refreshHoveredPortAfterGeometryChange(node, group);
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
  for (const { nodeId, portId } of [edge.from, edge.to]) {
    const incident = incidentEdges.get(nodeId) ?? new Set<string>();
    incident.add(edge.id);
    incidentEdges.set(nodeId, incident);
    if (!localMode) continue;
    const ports = portIncidentEdges.get(nodeId) ?? new Map<string, Set<string>>();
    const wires = ports.get(portId) ?? new Set<string>();
    wires.add(edge.id);
    ports.set(portId, wires);
    portIncidentEdges.set(nodeId, ports);
  }
}

function addCardShape(node: FixtureNode): void {
  const group = makeCard(node);
  cardGroups.set(node.id, group);
  cardLayer?.add(group);
  localFraming?.updateCard(node);
  syncEdgeCardGeometry();
}

function occupiedCards(excludeDragOriginOf?: string): FixtureNode[] {
  const occupied = [...nodeById.values()].map(node => {
    const group = activeDrags.has(node.id) ? cardGroups.get(node.id) : undefined;
    return group ? { ...node, x: group.x(), y: group.y() } : node;
  });
  for (const [id, drag] of activeDrags) {
    if (id === excludeDragOriginOf) continue;
    const node = nodeById.get(id);
    const group = cardGroups.get(id);
    if (!node || ((group?.x() ?? node.x) === drag.origin.x && (group?.y() ?? node.y) === drag.origin.y)) continue;
    occupied.push({ ...node, id: `drag-origin:${id}`, ...drag.origin });
  }
  return occupied;
}

function resizeCardPorts({ nodeId }: ChooserContext, mode: 'expand' | 'compact'): string {
  finishPortWheel();
  const node = nodeById.get(nodeId);
  const group = cardGroups.get(nodeId);
  const shapes = cardShapes.get(nodeId);
  const oldFootprint = node?.footprint;
  const chosen = selectedEdge ? edgeById.get(selectedEdge) : undefined;
  const keepVisible = chosen ? [chosen.from, chosen.to].filter(point => point.nodeId === nodeId).map(({ portId }) => portId) : [];
  if (activePortId && keyboardCardId === nodeId) keepVisible.unshift(activePortId);
  const proposed = oldFootprint?.resize(mode, keepVisible);
  if (!node || !group || !shapes || !oldFootprint || !proposed) return '';
  if (mode === 'expand') {
    const occupied = occupiedCards(nodeId);
    const current = { ...node, x: group.x(), y: group.y() };
    const drag = activeDrags.get(nodeId);
    if (!canExpandFootprint(current, proposed, occupied) || pendingAnchorOverlaps?.(current, proposed.height) ||
      (drag && (!canExpandFootprint({ ...node, ...drag.origin }, proposed, occupied) ||
        pendingAnchorOverlaps?.({ ...node, ...drag.origin }, proposed.height)))) {
      return 'Not enough room to expand. Move this card away from its neighbours and try again.';
    }
  }

  node.footprint = proposed;
  shapes.rect.height(proposed.height);
  syncFootprintRows(node, group);
  localFraming?.updateCard(node);
  syncEdgeCardGeometry();
  const incident = incidentEdges.get(nodeId) ?? [];
  const affected = new Set([...incident, ...(sceneWirePairs?.update(incident, nodeById) ?? [])]);
  const settle: FixtureEdge[] = [];
  for (const id of affected) {
    const edge = edgeById.get(id)!;
    const sourceDrag = activeDrags.get(edge.from.nodeId);
    const targetDrag = activeDrags.get(edge.to.nodeId);
    if (sourceDrag || targetDrag) {
      sourceDrag?.deferredEdgeIds.add(id);
      targetDrag?.deferredEdgeIds.add(id);
      laneReservations.remove(id);
      delete edge.routeOffset;
      delete edge.routeOffsetFamily;
    } else settle.push(edge);
  }
  if (settle.length) laneReservations.settle(settle, nodeById);
  for (const id of affected) updateWireGeometry(edgeById.get(id)!);
  if (affected.size) wireLayer?.batchDraw();
  cardLayer?.batchDraw();
  localFraming?.bounds();
  refreshActiveCardDescription();
  syncPortsControl();
  return mode === 'expand' ? 'Ports expanded.' : 'Ports compacted.';
}

function syncPortsControl(): void {
  if (!portsControl) return;
  const card = selectedNode ? nodeById.get(selectedNode) : undefined;
  const footprint = card?.footprint;
  portsControl.hidden = !footprint || !(footprint.canCompact || PORT_SIDES.some(side => footprint.overflowCount(side) > 0));
  const overflow = footprint ? footprint.overflowCount('left') + footprint.overflowCount('right') : 0;
  portsControl.textContent = overflow ? `Ports and bindings (+${overflow})` : 'Ports and bindings';
  if (card) portsControl.setAttribute('aria-label', `${card.name}: Ports and bindings${overflow ? `, ${overflow} hidden ${overflow === 1 ? 'port' : 'ports'}` : ''}`);
  let hasPages = false;
  for (const { side, direction, button } of pageButtons) {
    const hidden = footprint?.canScroll(side) ? footprint.overflowCount(side, direction) : 0;
    if (!hidden && document.activeElement === button) focusPortsStage(card?.id);
    button.hidden = !hidden;
    if (hidden && card) {
      hasPages = true;
      button.setAttribute('aria-label', `${card.name}: ${direction === 'above' ? 'Previous' : 'Next'} ${side} port page, ${hiddenPortDescription(hidden, side, direction)}`);
    }
  }
  if (pageControls) pageControls.hidden = !hasPages;
}

function openBindingChooser(context: ChooserContext): void {
  finishPortWheel();
  if (context.side && selectedNode !== context.nodeId) setSelection({ nodeId: context.nodeId, edgeId: selectedEdge });
  bindingChooser?.open(context);
}

function focusPortsStage(nodeId?: string): void {
  if (!nodeId) return;
  // Restoring DOM focus must not replace the exact binding selection.
  restoreCardFocus = nodeId;
  stageHost.focus({ preventScroll: true });
  restoreCardFocus = undefined;
  keyboardCardId = nodeId;
  if (nodes[keyboardCardIndex]?.id !== nodeId) keyboardCardIndex = nodes.findIndex(node => node.id === nodeId);
  refreshActiveCardDescription();
}

function installBindingChooser(host: HTMLElement): void {
  portsControl = document.createElement('button');
  portsControl.type = 'button';
  portsControl.className = 'canvas-ports-control';
  portsControl.setAttribute('aria-haspopup', 'dialog');
  portsControl.setAttribute('aria-controls', 'topology-binding-chooser');
  portsControl.addEventListener('click', () => { if (selectedNode) openBindingChooser({ nodeId: selectedNode }); });
  host.append(portsControl);
  pageControls = document.createElement('div');
  pageControls.className = 'canvas-port-page-controls';
  for (const side of PORT_SIDES) for (const direction of OVERFLOW_DIRECTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${direction === 'above' ? 'Previous' : 'Next'} ${side} port page`;
    button.addEventListener('click', () => {
      if (!selectedNode) return;
      keyboardPortSide = side;
      turnPortPage(selectedNode, side, direction);
    });
    pageControls.append(button);
    pageButtons.push({ side, direction, button });
  }
  host.append(pageControls);
  syncPortsControl();
  bindingChooser = new BindingChooser(host, {
    read(context) {
      const { nodeId, side, direction, role } = context;
      const node = nodeById.get(nodeId);
      if (!node?.footprint) return;
      const wires = [...(incidentEdges.get(nodeId) ?? [])].map(id => edgeById.get(id)!).filter(Boolean);
      const choices = bindingChoices(node, wires, nodeById, context);
      return { name: node.name, choices, ...(side ? {
        overflowPorts: node.footprint.overflowCount(side, direction, role),
        overflowDirections: { above: node.footprint.overflowCount(side, 'above'), below: node.footprint.overflowCount(side, 'below') },
        overflowRoles: { alias: node.footprint.overflowCount(side, direction, 'alias'), local: node.footprint.overflowCount(side, direction, 'local') }
      } : {}),
        overflowBySide: { left: node.footprint.overflowCount('left'), right: node.footprint.overflowCount('right') },
        canExpand: node.footprint.canExpand, canCompact: node.footprint.canCompact };
    },
    resize: resizeCardPorts,
    select(context, edgeId) {
      const node = nodeById.get(context.nodeId);
      const edge = edgeById.get(edgeId);
      if (!node?.footprint || !edge) return;
      const ports = [edge.from, edge.to].filter(point => bindingEndpointMatches(node, point, context));
      if (!ports.length) return;
      const moved = ports.flatMap(({ portId }) => node.footprint!.reveal(portId));
      if (moved.length) updatePortWindows(new Map([[node.id, moved]]), false);
      setSelection({ nodeId: node.id, edgeId });
      keyboardPortSide = context.side ?? node.footprint.attachment(ports[0]!.portId)?.side;
      activePortId = ports.find(({ portId }) => socketRows.has(`${node.id}:${portId}`))?.portId;
    },
    restoreFocus: ({ nodeId }) => focusPortsStage(nodeId)
  });
}

function localSceneChanges(newWires: Set<string>, changedGeometryWires: Set<string>) {
  return {
    nodes: nodeById,
    occupiedNodes: () => occupiedCards(),
    patchCard(card: LocalCardPatch) {
      const incident = [...patchCard(card)];
      for (const edgeId of incident) changedGeometryWires.add(edgeId);
      return incident;
    },
    addCard(node: FixtureNode) {
      restoreLateCard?.(node);
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
}

function drainPendingPlacement(projection: LocalEnrichmentProjection): boolean {
  if (pageDisposed || !stage || !localFraming) return false;
  const before = localFraming.revision;
  const cardCount = nodes.length;
  const more = projection.drainFrame(localSceneChanges(new Set(), new Set()));
  if (nodes.length > cardCount) markPlacementDirty();
  if (localFraming.revision !== before) {
    localFraming.bounds();
    cardLayer?.batchDraw();
  }
  return more;
}

function arrangeScene(makePositions: (
  current: ReadonlyMap<string, Point>, pinned: ReadonlySet<string>, footprints: ReadonlyMap<string, { width: number; height: number }>
) => ReadonlyMap<string, Point>): boolean {
  if (pageDisposed || !stage || !localFraming || activeDrags.size) return false;
  const current = new Map(nodes.map(({ id, x, y }) => [id, { x, y }]));
  const footprints = new Map(nodes.map(node => [node.id, { width: node.width, height: cardHeight(node) }]));
  const affected = new Set<string>();
  let moved = false;
  for (const [id, point] of makePositions(current, pinnedCardIds, footprints)) {
    const node = nodeById.get(id);
    const group = cardGroups.get(id);
    if (!node || !group || pinnedCardIds.has(id) || (node.x === point.x && node.y === point.y)) continue;
    node.x = point.x;
    node.y = point.y;
    group.position(point);
    localFraming.updateCard(node);
    moved = true;
    for (const edgeId of incidentEdges.get(id) ?? []) affected.add(edgeId);
  }
  if (affected.size) {
    const changed = [...affected].map(id => edgeById.get(id)!);
    laneReservations.settle(changed, nodeById);
    for (const edge of changed) updateWireGeometry(edge);
    wireLayer?.batchDraw();
  }
  if (moved) {
    syncEdgeCardGeometry();
    localFraming.bounds();
    cardLayer?.batchDraw();
  }
  sessionLayoutWriter?.schedule();
  return true;
}

function applyEnrichment(changes: RemoteEnrichmentBatch<LocalGraph>, projection: LocalEnrichmentProjection): void {
  if (pageDisposed || !stage || !localFraming) return;

  const dirtyWires = new Set<string>();
  const newWires = new Set<string>();
  const changedGeometryWires = new Set<string>();
  const scene = localSceneChanges(newWires, changedGeometryWires);
  // Keep accepted order for first insertion, but compute each dirty route and reduce extents once.
  const before = localFraming.revision;
  projection.applyDiscoveries(changes.discoveries, scene);
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
  bindingChooser?.refresh();
  if (summary) summary.textContent = projection.summary(changes);
  if (dirtyWires.size) wireLayer?.batchDraw();
  if (changes.discoveries.length || changes.results.length || changes.finish) cardLayer?.batchDraw();
  if (nodes.length && failure && !failure.classList.contains('is-visually-hidden')) failure.hidden = true;
}

function setSelection(next: Selection, source: 'keyboard' | 'pointer' = 'pointer'): void {
  const previous = { nodeId: selectedNode, edgeId: selectedEdge };
  if (localMode) {
    const selectedIndex = next.nodeId ? nodes.findIndex(({ id }) => id === next.nodeId) : -1;
    if (selectedIndex >= 0) {
      keyboardCardIndex = selectedIndex;
      if (source === 'keyboard') {
        if (keyboardCardId !== next.nodeId) { activePortId = undefined; keyboardPortSide = undefined; }
        keyboardCardId = next.nodeId;
      } else {
        keyboardCardId = undefined;
        keyboardPortSide = undefined;
        activePortId = undefined;
      }
    } else {
      keyboardCardId = undefined;
      keyboardCardIndex = -1;
      keyboardPortSide = undefined;
      activePortId = undefined;
    }
  }
  if (previous.nodeId === next.nodeId && previous.edgeId === next.edgeId) return;
  const changed = selectionChanges(previous, next, edgeById);
  selectedNode = next.nodeId;
  selectedEdge = next.edgeId;
  syncPortsControl();
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
  const railIds = new Set<string>();
  for (const edgeId of changed.edgeIds) {
    const edge = edgeById.get(edgeId);
    if (edge) { railIds.add(edge.from.nodeId); railIds.add(edge.to.nodeId); }
  }
  for (const id of railIds) {
    const node = nodeById.get(id);
    if (node) repaintOverflowRails(node);
  }
  if (changed.edgeIds.size) wireLayer?.batchDraw();
  if (changed.nodeIds.size || changed.socketIds.size) cardLayer?.batchDraw();
}

type DrawableViewport = { width: number; height: number };
const positiveViewport = ({ width, height }: DrawableViewport) => Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
const clampCameraScale = (scale: number) => Math.max(localMode ? SESSION_LAYOUT_MIN_SCALE : 0.04, Math.min(1.6, scale));

function centerCamera(preferred?: NonNullable<ReturnType<typeof graphBounds>>): boolean {
  const bounds = preferred ?? (localFraming ? localFraming.bounds() : authoredWorldBounds);
  if (!stage || !bounds || (localMode && !viewportDrawable)) return false;
  const graphLeft = bounds.left;
  const graphTop = bounds.top;
  const graphWidth = bounds.right - bounds.left;
  const graphHeight = bounds.bottom - bounds.top;
  const fittedScale = fittedCameraScale(viewportWidth, viewportHeight, graphWidth, graphHeight);
  const scale = localMode ? clampCameraScale(fittedScale) : fittedScale;
  stage.scale({ x: scale, y: scale });
  stage.position({ x: Math.round((viewportWidth - graphWidth * scale) / 2 - graphLeft * scale), y: Math.round((viewportHeight - graphHeight * scale) / 2 - graphTop * scale) });
  stage.batchDraw();
  syncEdgeCamera();
  return true;
}

function setZoom(nextScale: number, anchor = { x: viewportWidth / 2, y: viewportHeight / 2 }): boolean {
  if (!stage) return false;
  const scale = clampCameraScale(nextScale);
  const changed = scale !== stage.scaleX();
  const world = { x: (anchor.x - stage.x()) / stage.scaleX(), y: (anchor.y - stage.y()) / stage.scaleY() };
  stage.scale({ x: scale, y: scale });
  stage.position({ x: anchor.x - world.x * scale, y: anchor.y - world.y * scale });
  stage.batchDraw();
  syncEdgeCamera();
  return changed;
}

// No 1×1 stage transform should reach storage. Early controls apply after
// the first valid viewport and after its one-time initial camera is resolved.
const queuedCameraActions: Array<'reset' | number> = [];

function applyCameraAction(action: 'reset' | number, anchor?: Point): boolean {
  if (!stage) return false;
  if (localMode && !viewportDrawable) {
    if (action === 'reset') queuedCameraActions.length = 0;
    if (queuedCameraActions.length === 64) queuedCameraActions.shift();
    queuedCameraActions.push(action);
    return false;
  }
  // A discrete camera change commits any already-displaced pan first.
  if (panOrigin) stage.stopDrag();
  return action === 'reset' ? centerCamera() : setZoom(stage.scaleX() * action, anchor);
}

function updateViewport(rect: DrawableViewport): void {
  if (!stage) return;
  if (!positiveViewport(rect)) { viewportDrawable = false; return; }
  const initial = viewportWidth === 0 || viewportHeight === 0;
  const dx = (rect.width - viewportWidth) / 2;
  const dy = (rect.height - viewportHeight) / 2;
  viewportWidth = rect.width;
  viewportHeight = rect.height;
  viewportDrawable = true;
  stage.size({ width: viewportWidth, height: viewportHeight });
  if (initial) {
    const camera = initialSessionCamera;
    const position = camera && sessionCameraPosition(camera, rect);
    if (camera && position) {
      stage.scale({ x: camera.scale, y: camera.scale });
      stage.position(position);
    } else centerCamera(initialPreviewBounds);
    initialSessionCamera = undefined;
    initialPreviewBounds = undefined;
  } else if (localMode && (dx || dy)) {
    // Only the viewport midpoint changed. Shift the live transform and any
    // settled pan baseline; do not round the centre or replay storage on BFCache.
    stage.position({ x: stage.x() + dx, y: stage.y() + dy });
    if (panOrigin) panOrigin.position = { x: panOrigin.position.x + dx, y: panOrigin.position.y + dy };
  }
  let changed = false;
  for (const action of queuedCameraActions.splice(0)) changed = applyCameraAction(action) || changed;
  if (changed || writeWhenDrawable) {
    writeWhenDrawable = false;
    markPlacementDirty();
  }
  stage.batchDraw();
  syncEdgeCamera();
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
    edgeNavigation = new EdgeNavigation({
      container: host,
      enabled: query.get('testEdgeNavigation') !== 'off',
      focusFallback: () => stageHost,
      cards: () => nodes.filter(node => cardGroups.has(node.id)).map(node => ({ id: node.id, x: node.x, y: node.y, width: node.width, height: cardHeight(node) })),
      navigate: (center, scale) => {
        if (!stage || !viewportDrawable) return;
        stage.position({ x: Math.round(viewportWidth / 2 - center.x * scale), y: Math.round(viewportHeight / 2 - center.y * scale) });
        stage.batchDraw();
        syncEdgeCamera();
        sessionLayoutWriter?.schedule();
      }
    });
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
    if (localMode) installBindingChooser(host);
    stage.on('click tap', (event) => {
      if (event.target === stage) {
        setSelection({});
      }
    });
    stage.on('wheel', (event) => {
      event.evt.preventDefault();
      const pointer = stage?.getPointerPosition();
      if (!pointer || !stage || !event.evt.deltaY) return;
      if (!event.evt.ctrlKey && Konva.isDragging()) return;
      if (scrollPortsAtPointer(event.target, event.evt, pointer)) return;
      finishPortWheel();
      const factor = 1.07;
      if (applyCameraAction(event.evt.deltaY > 0 ? 1 / factor : factor, pointer)) {
        const camera = edgeCamera();
        if (camera) edgeNavigation?.updateDuringCameraGesture(camera);
        sessionLayoutWriter?.schedule();
      }
    });
    stage.on('dragstart.edgeNavigation', (event) => {
      if (event.target === stage) edgeNavigation?.setCameraMoving(true);
    });
    stage.on('dragmove.edgeNavigation', (event) => {
      if (!stage || event.target !== stage) return;
      const camera = edgeCamera();
      if (camera) edgeNavigation?.updateDuringCameraGesture(camera);
    });
    stage.on('dragend.edgeNavigation', (event) => {
      if (event.target !== stage) return;
      edgeNavigation?.setCameraMoving(false);
      syncEdgeCamera();
    });
    if (localMode) {
      stage.on('dragstart.sessionLayout', (event) => {
        if (stage && viewportDrawable && event.target === stage) {
          finishPortWheel();
          panOrigin = { position: stage.position(), scale: stage.scaleX() };
          edgeNavigation?.setCameraMoving(true);
          sessionLayoutWriter?.setGestureActive(true);
        }
      });
      stage.on('dragmove.edgeNavigation', (event) => {
        if (!stage || event.target !== stage) return;
        const camera = edgeCamera();
        if (camera) edgeNavigation?.updateDuringCameraGesture(camera);
      });
      stage.on('dragend.sessionLayout', (event) => {
        if (event.target !== stage) return;
        const origin = panOrigin;
        panOrigin = undefined;
        edgeNavigation?.setCameraMoving(false);
        syncEdgeCamera();
        sessionLayoutWriter?.setGestureActive(activeDrags.size > 0);
        if (stage && origin && (origin.position.x !== stage.x() || origin.position.y !== stage.y())) sessionLayoutWriter?.schedule();
      });
    }
    const preventNativeWheel = (event: WheelEvent) => event.preventDefault();
    stageHost.addEventListener('wheel', preventNativeWheel, { passive: false });
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) updateViewport(rect);
    });
    observer.observe(stageHost);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelection({});
        return;
      }
      if (!localMode || document.activeElement !== stageHost || !nodes.length) return;
      if (!keyboardCardId && selectedNode) {
        keyboardCardId = selectedNode;
        keyboardCardIndex = nodes.findIndex(({ id }) => id === selectedNode);
      }
      if (!event.ctrlKey && !event.altKey && !event.metaKey && keyboardCardId) {
        const node = nodeById.get(keyboardCardId);
        const footprint = node?.footprint;
        if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && PORT_SIDES.some(side => footprint?.canScroll(side))) {
          keyboardPortSide = event.key === 'ArrowLeft' ? 'left' : 'right';
          event.preventDefault();
          setCardAccessibleMessage(`${node?.name}. ${keyboardPortSide} ports selected for scrolling.`);
          return;
        }
        if (event.key === 'PageUp' || event.key === 'PageDown') {
          const side = keyboardPortSide ?? PORT_SIDES.find(side => footprint?.canScroll(side));
          if (side && footprint?.canScroll(side)) {
            event.preventDefault();
            if (portWindowMode !== 'chooser' || !event.repeat) {
              turnPortPage(keyboardCardId, side, event.key === 'PageUp' ? 'above' : 'below', portWindowMode !== 'chooser' && event.shiftKey);
            }
            return;
          }
        }
      }
      if (event.key.toLowerCase() === 'p' && !event.ctrlKey && !event.altKey && !event.metaKey && keyboardCardId) {
        event.preventDefault();
        openBindingChooser({ nodeId: keyboardCardId });
        return;
      }
      if (event.key === 'Enter' && keyboardCardId) {
        const node = nodeById.get(keyboardCardId);
        if (node && selectedNode === keyboardCardId && titleDestination(node)) {
          event.preventDefault();
          navigateToTitle(node);
        }
        return;
      }
      if ((event.key === '[' || event.key === ']') && !event.ctrlKey && !event.altKey && !event.metaKey && keyboardCardId) {
        const node = nodeById.get(keyboardCardId);
        if (!node) return;
        const visiblePorts: Array<{ port: FixtureNode['ports'][number]; y: number }> = [];
        positionRows(node, (port, y) => visiblePorts.push({ port, y }));
        visiblePorts.sort((a, b) => a.y - b.y || (a.port.side === 'left' ? -1 : 1));
        if (!visiblePorts.length) return;
        event.preventDefault();
        const direction = event.key === ']' ? 1 : -1;
        const previousIndex = visiblePorts.findIndex(({ port }) => port.id === activePortId);
        const keyboardPortIndex = previousIndex < 0
          ? direction > 0 ? 0 : visiblePorts.length - 1
          : (previousIndex + direction + visiblePorts.length) % visiblePorts.length;
        activePortId = visiblePorts[keyboardPortIndex]!.port.id;
        keyboardPortSide = visiblePorts[keyboardPortIndex]!.port.side;
        refreshActiveCardDescription();
        return;
      }
      if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      keyboardCardIndex = (keyboardCardIndex + step + nodes.length) % nodes.length;
      const node = nodes[keyboardCardIndex]!;
      const card = cardGroups.get(node.id);
      if (card) { activePortId = undefined; setSelection({ nodeId: node.id }, 'keyboard'); refreshActiveCardDescription(); }
    };
    document.addEventListener('keydown', onKeyDown);
    if (localMode) stageHost.addEventListener('focus', () => {
      if (restoreCardFocus) return;
      if (keyboardCardIndex < 0 && selectedNode) keyboardCardIndex = nodes.findIndex(({ id }) => id === selectedNode);
      if (keyboardCardIndex < 0) keyboardCardIndex = 0;
      const node = nodes[keyboardCardIndex];
      const card = node ? cardGroups.get(node.id) : undefined;
      if (node && card) { setSelection({ nodeId: node.id }, 'keyboard'); refreshActiveCardDescription(); }
    });
    if (localMode) stageHost.addEventListener('blur', () => {
      keyboardCardId = undefined;
      refreshActiveCardDescription();
    });
    if (summary) summary.textContent = localMode ? `${nodes.length} nodes · ${edges.length} configured` : `${nodes.length} nodes · ${edges.length} edges`;
    const zoomOut = document.querySelector<HTMLButtonElement>('[data-view="zoom-out"]');
    const zoomIn = document.querySelector<HTMLButtonElement>('[data-view="zoom-in"]');
    const reset = document.querySelector<HTMLButtonElement>('[data-view="reset"]');
    const onZoomOut = () => { if (applyCameraAction(1 / 1.15)) sessionLayoutWriter?.schedule(); };
    const onZoomIn = () => { if (applyCameraAction(1.15)) sessionLayoutWriter?.schedule(); };
    const onReset = () => { if (applyCameraAction('reset')) sessionLayoutWriter?.schedule(); };
    zoomOut?.addEventListener('click', onZoomOut);
    zoomIn?.addEventListener('click', onZoomIn);
    reset?.addEventListener('click', onReset);
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      finishPortWheel();
      bindingChooser?.close(false);
      sessionLayoutWriter?.flush();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) updateViewport(stageHost.getBoundingClientRect());
    };
    const onPageHide = (event: PageTransitionEvent) => {
      finishPortWheel();
      bindingChooser?.close(false);
      sessionLayoutWriter?.flush();
      // The browser will revive this same document and stage on a cache hit.
      if (event.persisted) return;
      sessionLayoutWriter?.dispose();
      window.removeEventListener('pagehide', onPageHide, true);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      observer.disconnect();
      edgeNavigation?.dispose();
      edgeNavigation = undefined;
      stageHost.removeEventListener('wheel', preventNativeWheel);
      document.removeEventListener('keydown', onKeyDown);
      zoomOut?.removeEventListener('click', onZoomOut);
      zoomIn?.removeEventListener('click', onZoomIn);
      reset?.removeEventListener('click', onReset);
      bindingChooser?.destroy();
      portsControl?.remove();
      pageControls?.remove();
      pageButtons.length = 0;
      portIncidentEdges.clear();
      footprintRowPools.clear();
      overflowRails.clear();
      socketRows.clear();
      laneReservations.clear();
      activeDrags.clear();
      pinnedCardIds.clear();
      pendingLayoutCards = undefined;
      initialSessionCamera = undefined;
      lastValidSessionCamera = undefined;
      restoreLateCard = undefined;
      pendingSavedAnchors = undefined;
      pendingAnchorOverlaps = undefined;
      panOrigin = undefined;
      queuedCameraActions.length = 0;
      stage?.destroy();
      stage = undefined;
    };
    if (localMode) {
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('pageshow', onPageShow);
    }
    // Flush before the startup entry's non-capturing pagehide disposes the renderer.
    window.addEventListener('pagehide', onPageHide, true);
    if (failure && !localMode) failure.hidden = true;
    return true;
  } catch {
    edgeNavigation?.dispose();
    edgeNavigation = undefined;
    bindingChooser?.destroy();
    portsControl?.remove();
    pageControls?.remove();
    pageButtons.length = 0;
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
  if (nodes.length) markPlacementDirty();
  function* initialRoutes(): IterableIterator<Curve[]> {
    for (const { curves } of wireGeometry.values()) yield curves;
  }
  // Synthetic Reset keeps its authored extents; local Reset uses live scene extents.
  if (!localFraming) authoredWorldBounds = graphBounds(nodes, initialRoutes());
  if (nodes.length === 0) setAccessibleMessage('No local or referenced nodes were found in the local configuration snapshot.');
  else if (failure) failure.hidden = true;
  return true;
}

let cancelPreviewDraw: (() => void) | undefined;
let resumePreviewDraw: (() => void) | undefined;
let cancelPreviewControls: (() => void) | undefined;
let resumePreviewControls: (() => void) | undefined;

/** Require real visible-sized draws; default framing must also produce visible ink. */
function afterInitialTopologyDraw(drawn: () => void, restoredLayout: boolean): void {
  const initialStage = stage;
  const cards = cardLayer;
  const wires = wireLayer;
  let cardDrawn = false;
  let wireDrawn = false;
  const needsWire = edges.length > 0;
  let drawRecorded = false;
  let frame: number | undefined;
  const sample = document.createElement('canvas');
  sample.width = sample.height = 128;
  const sampler = sample.getContext('2d', { willReadFrequently: true });
  const visible = () => initialStage === stage && stageHost.isConnected && viewportWidth > 0 && viewportHeight > 0;

  function hasInk(layer: Konva.Layer | undefined) {
    const canvas = layer?.getNativeCanvasElement();
    if (!sampler || !canvas?.width || !canvas.height || !canvas.getClientRects().length) return false;
    // A Konva draw event does not prove any backing pixels changed. Sample a
    // bounded copy of the visible scene canvas, never the off-screen hit layer.
    sampler.clearRect(0, 0, sample.width, sample.height);
    sampler.drawImage(canvas, 0, 0, sample.width, sample.height);
    const pixels = sampler.getImageData(0, 0, sample.width, sample.height).data;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) return true;
    return false;
  }

  function detach() {
    cards?.off('.firstTopologyDraw');
    wires?.off('.firstTopologyDraw');
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    frame = undefined;
    cancelPreviewDraw = undefined;
    resumePreviewDraw = undefined;
  }

  function present() {
    if (frame !== undefined || previewFrozen || pageDisposed || !cardDrawn || (needsWire && !wireDrawn) || !visible()) return;
    frame = window.requestAnimationFrame(() => {
      frame = undefined;
      if (previewFrozen || pageDisposed || !visible()) return;
      const hasVisibleMap = hasInk(cards) && (!needsWire || hasInk(wires));
      // A restored camera may intentionally point away from the first cards
      // or cover a card whose wires are all off-screen. Do not deadlock startup.
      if (!restoredLayout && !hasVisibleMap) return;
      if (!drawRecorded && hasVisibleMap) {
        drawRecorded = true;
        performance.mark('topology:first-populated-draw');
      }
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        if (previewFrozen || pageDisposed || !visible() || (!restoredLayout && (!hasInk(cards) || (needsWire && !hasInk(wires))))) return;
        detach();
        performance.mark('topology:first-map-painted');
        drawn();
      });
    });
  }

  cancelPreviewDraw = detach;
  resumePreviewDraw = present;
  cards?.on('draw.firstTopologyDraw', () => { if (visible()) { cardDrawn = true; present(); } });
  if (needsWire) wires?.on('draw.firstTopologyDraw', () => { if (visible()) { wireDrawn = true; present(); } });
}

function initialConnectedBounds(projected: { nodes: FixtureNode[]; edges: FixtureEdge[] }, localIds: ReadonlySet<string>, width: number, height: number) {
  const byId = new Map(projected.nodes.map((node) => [node.id, node]));
  // Measure real projected pairs, including the Bezier hull; don't run a
  // second layout or let the disconnected inventory dictate a tiny zoom.
  const pairBounds = new Map<string, { nodes: [FixtureNode, FixtureNode]; curves: Curve[][] }>();
  for (const edge of projected.edges) {
    const from = byId.get(edge.from.nodeId);
    const to = byId.get(edge.to.nodeId);
    if (!from || !to || from === to || (!localIds.has(from.id) && !localIds.has(to.id))) continue;
    const key = JSON.stringify([from.id, to.id].sort());
    let pair = pairBounds.get(key);
    if (!pair) { pair = { nodes: [from, to], curves: [] }; pairBounds.set(key, pair); }
    pair.curves.push(edgeCurves(edge, byId));
  }
  let best: ReturnType<typeof graphBounds>;
  let zoom = 0.35;
  for (const pair of pairBounds.values()) {
    const bounds = graphBounds(pair.nodes, pair.curves);
    if (!bounds) continue;
    const scale = fittedCameraScale(width, height, bounds.right - bounds.left, bounds.bottom - bounds.top);
    if (scale >= zoom && (!best || scale > zoom)) { best = bounds; zoom = scale; }
  }
  return best;
}

export async function createLocalRenderer(shell: TopologyStartupShell) {
  const generation = shell.generation;
  const active = () => !pageDisposed && generation === shell.generation;
  const [placement, projection, views] = await Promise.all([
    import('./local-placement'), import('./local-projection'), import('./local-enrichment-projection')
  ]);
  let reportProgress: ((refreshSummary?: boolean) => void) | undefined;
  let live: LocalEnrichmentProjection | undefined;
  let lastPatchedBatch: RemoteEnrichmentBatch<LocalGraph> | undefined;
  let paintConfirmed = false;
  const progress: PreviewCallbacks['progress'] = (graph, batch) => {
        const { counts, finish, inventory, preview } = batch;
        if (active() && finish === 'complete' && !batch.paused) {
          // The accepted graph contains deferred names as well as mounted ones.
          // Failed/limited evidence can conceal a referenced card, so it cannot prove departure.
          if (nodes.length && pendingLayoutCards?.size && inventory.local === 'known' && inventory.state === 'complete' &&
              counts.read === counts.total && !counts.pending && !counts.partial && !counts.unsuccessful &&
              [...graph.nodes.values()].every(owner => owner.origin === 'local' ? owner.bindingsRead === 'read' : owner.inspectionState === 'read')) {
            const accepted = new Set([...graph.nodes.keys()].map(projection.localCardId));
            if (retirePendingSessionCards(pendingLayoutCards, accepted)) markPlacementDirty();
          }
          sessionLayoutWriter?.setDiscovering(false);
        }
        const summaryBatch = { discoveries: [], results: [], paused: batch.paused, counts, inventory,
          ...(preview ? { preview } : {}), ...(finish ? { finish } : {}) };
        const wasPatched = batch === lastPatchedBatch;
        lastPatchedBatch = undefined;
        reportProgress = (refreshSummary = !wasPatched) => {
          if (!active()) return;
          if (summary && refreshSummary) summary.textContent = live?.summary(summaryBatch) ?? projection.localTopologyProgressSummary(graph, summaryBatch);
          // The coordinator owns the durable terminal no-map status. Attaching
          // after empty discovery may refresh the summary, not the waiting copy.
          if (finish && graph.nodes.size === 0) return;
          const qualification = inventory.state === 'pending' ? 'HTTP inventory pending'
            : inventory.state === 'limited' ? 'HTTP inventory limited' : inventory.state === 'failed' ? 'HTTP inventory failed' : '';
          shell.update({
            discovered: graph.nodes.size, shown: nodes.length, inspected: counts.read + counts.partial,
            pending: counts.pending, unsuccessful: counts.unsuccessful, noRoute: counts.noRoute,
            coverage: [inventory.coverage, qualification].filter(Boolean).join(' · '),
            state: !shell.releaseReason ? 'discovering' : nodes.length ? 'running' : 'waiting'
          });
          shell.setControls({ showAll: paintConfirmed && live?.shouldOfferShowAll() === true, arrange: paintConfirmed });
        };
        reportProgress();
  };
    let mountedGraph: LocalGraph | undefined;
    let revealRequested = false;
    let revealFrame: number | undefined;
    const scheduleReveal = () => {
      if (!live || !active() || previewFrozen || !revealRequested || revealFrame !== undefined) return;
      revealFrame = window.requestAnimationFrame(() => {
        revealFrame = undefined;
        if (!live || !active() || previewFrozen) return;
        const more = drainPendingPlacement(live);
        reportProgress?.();
        if (more) scheduleReveal();
      });
    };
    const stopReveal = shell.on('show-all-discovered', () => {
      if (!live || !active() || !paintConfirmed) return;
      revealRequested = true;
      live.revealAll();
      scheduleReveal();
    });
    const stopArrange = shell.on('arrange-by-connections', () => {
      if (!mountedGraph || !active() || !paintConfirmed) return;
      const graph = mountedGraph;
      arrangeScene((current, pinned, footprints) => placement.arrangeDisplayedLocalGraph(graph, current, pinned, footprints,
        { viewportWidth, viewportHeight }, pendingSavedAnchors?.()));
    });
    cancelPreviewControls = () => {
      if (revealFrame !== undefined) window.cancelAnimationFrame(revealFrame);
      revealFrame = undefined;
      stopReveal();
      stopArrange();
    };
    resumePreviewControls = scheduleReveal;
    const renderer: PreviewRenderer = {
      connected(graph) {
        const { width, height } = stageHost.getBoundingClientRect();
        return placement.hasReadableLocalConnection(graph, { width, height });
      },
      mount(graph, drawn) {
        mountedGraph = graph;
        const saved = localMode ? readSessionLayout(getSessionStorage) : undefined;
        pendingLayoutCards = saved?.cards;
        initialSessionCamera = saved?.camera;
        lastValidSessionCamera = saved?.camera;
        performance.mark('topology:first-layout-start');
        const { width, height } = stageHost.getBoundingClientRect();
        const membership = placement.selectLocalGraphMembership(graph);
        const visibleGraph = membership.deferred.size ? { ...graph, nodes: new Map([...graph.nodes].filter(([id]) => membership.shown.has(id))) } : graph;
        const positions = placement.placeLocalGraph(visibleGraph, { viewportWidth: width, viewportHeight: height });
        const first = projection.projectLocalGraph(visibleGraph, positions, undefined, height);
        let restoredCards = false;
        if (pendingLayoutCards?.size) {
          const pending = pendingLayoutCards;
          const heights = new Map<string, number>();
          if (membership.deferred.size) {
            const geometry = placement.indexLocalGraphGeometry(graph, height);
            for (const id of membership.deferred) {
              const cardId = projection.localCardId(id);
              const knownHeight = geometry.heightsByNode.get(id);
              if (pending.has(cardId) && knownHeight !== undefined) heights.set(cardId, knownHeight);
            }
          }
          const reservations = () => placement.pendingLocalCardReservations(pending, heights);
          pendingSavedAnchors = reservations;
          pendingAnchorOverlaps = (node, height) => {
            const expanded = { ...placement.localCardRectangle(node), height };
            for (const anchor of reservations()) if (placement.localCardRectanglesOverlap(expanded, anchor)) return true;
            return false;
          };
          restoredCards = placement.restoreInitialLocalCards(first.nodes, pending, pinnedCardIds, heights);
          restoreLateCard = (node) => {
            const saved = pending.get(node.id);
            pending.delete(node.id);
            const displaced = placement.restoreLateLocalCard(node, saved, occupiedCards(), pinnedCardIds, reservations(),
              id => nodeById.has(id) && !activeDrags.has(id));
            if (!displaced) return;
            for (const [id, point] of displaced) {
              const group = cardGroups.get(id)!;
              group.position(point);
              moveCard(nodeById.get(id)!, group);
            }
            for (const id of displaced.keys()) settleCardLanes(nodeById.get(id)!);
          };
        }
        initialPreviewBounds = initialConnectedBounds(first, new Set([...visibleGraph.nodes.values()]
          .filter(({ origin }) => origin === 'local').map(({ id }) => projection.localCardId(id))), width, height);
        live = new views.LocalEnrichmentProjection(graph, first, {
          displayedNodeIds: membership.shown, deferredNodeIds: membership.deferred, viewportHeight: () => viewportHeight || height
        });
        sceneWirePairs = first.wirePairs;
        if (!installGraph(first.nodes, first.edges)) return false;
        if ((import.meta as ImportMeta & { env: { MODE: string } }).env.MODE === 'konva-preview-test') {
          const incident = new Set(first.edges.flatMap(edge => [edge.from.nodeId, edge.to.nodeId]));
          performance.mark('topology:initial-membership', { detail: { cards: first.nodes.length, wires: first.edges.length,
            unconnected: first.nodes.filter(card => !incident.has(card.id)).map(card => card.name) } });
        }
        performance.mark('topology:first-layout-end');
        afterInitialTopologyDraw(drawn, restoredCards || initialSessionCamera !== undefined);
        return true;
      },
      patch(batch) {
        if (live) {
          const cardCount = nodes.length;
          if (batch.localSnapshot) {
            // This is a names-only delta. Bindings and wires arrive through
            // the same result path as any other owner inspection below.
            live.applyLocalInventory(batch.localSnapshot, localSceneChanges(new Set(), new Set()));
            cardLayer?.batchDraw();
          }
          applyEnrichment(batch, live);
          if (nodes.length > cardCount) markPlacementDirty();
          lastPatchedBatch = batch;
        }
        scheduleReveal();
      }
    };
    return {
      renderer, progress,
      painted() { paintConfirmed = true; reportProgress?.(true); },
      setFrozen(frozen: boolean) {
        previewFrozen = frozen;
        if (!frozen) { resumePreviewDraw?.(); resumePreviewControls?.(); }
      },
      dispose() { pageDisposed = true; sessionLayoutWriter?.dispose(); cancelPreviewDraw?.(); cancelPreviewControls?.(); }
    };
}

export function mountSynthetic() {
  const fixture = createFixture(nodeCount);
  return installGraph(fixture.nodes, fixture.edges);
}
