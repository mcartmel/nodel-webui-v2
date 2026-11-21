import { Config } from '@antv/x6/es/config/index.js';
import { Graph } from '@antv/x6/es/graph/graph.js';
import type { Cell } from '@antv/x6/es/model/cell.js';
import { NodeView } from '@antv/x6/es/view/node/index.js';
import '@antv/x6/es/shape/edge.js';
import '@antv/x6/es/shape/rect.js';
import { topologyNodeHeight, topologyNodeSize } from './topology-layout';
import canvasStyles from './topology-canvas.css?inline';

export type TopologyCanvasNodeId = string & { readonly __topologyCanvasNodeId: unique symbol };
export type TopologyCanvasPortId = string & { readonly __topologyCanvasPortId: unique symbol };
export type TopologyCanvasWireId = string & { readonly __topologyCanvasWireId: unique symbol };

export interface TopologyCanvasPoint {
  x: number;
  y: number;
}

export interface TopologyCanvasPort {
  id: string;
  label: string;
  direction: 'input' | 'output';
  /** Relative vertical location between 0 and 1. Omitted positions are evenly distributed. */
  position?: number;
}

export interface TopologyCanvasNode {
  id: string;
  title: string;
  status: string;
  summary: string;
  position: TopologyCanvasPoint;
  ports: readonly TopologyCanvasPort[];
  /** Optional content-derived block height; endpoint rows otherwise size it automatically. */
  height?: number;
}

export interface TopologyCanvasWire {
  id: string;
  source: { nodeId: string; portId: string };
  target: { nodeId: string; portId: string };
  label?: string;
  status?: 'normal' | 'unresolved' | 'pending' | 'stale';
}

/** Renderer-neutral read projection. Domain ids are data only; the adapter maps them to opaque X6 ids. */
export interface TopologyCanvasProjection {
  nodes: readonly TopologyCanvasNode[];
  wires: readonly TopologyCanvasWire[];
}

export interface TopologyCanvasViewport {
  x: number;
  y: number;
  scale: number;
}

export interface TopologyCanvasFrameOptions {
  padding?: number;
  minScale?: number;
  maxScale?: number;
}

export interface TopologyCanvasCallbacks {
  onNodeSelected?(nodeId: string | null): void;
  onWireSelected?(wireId: string | null): void;
  onNodeMoved?(nodeId: string, position: TopologyCanvasPoint): void;
  onViewportChanged?(viewport: TopologyCanvasViewport): void;
  onCanvasResized?(): void;
}


const NODE_WIDTH = 248;
const MAX_NODE_HEIGHT = 420;
const MAX_CACHED_WIRE_IDS = 5000;
const PORT_RADIUS = 5;
const PORT_LABEL_TOP = 94;
const PORT_LABEL_BOTTOM = 14;
const PORT_LABEL_GAP = 18;
const PORT_LABEL_WIDTH = 100;
const MAX_INDIVIDUAL_SOCKET_COUNT = 20;
const GROUPED_SOCKET_GAP = 18;
const GROUPED_SOCKET_TOP = PORT_LABEL_TOP + PORT_LABEL_GAP + 6;
const SELECTED_SOCKET_Y = PORT_LABEL_TOP + 8;
const OUTSIDE_ANCHOR_CLEARANCE = 32;
const SVG_MARKUP = [
  { tagName: 'rect', selector: 'body' },
  { tagName: 'text', selector: 'title' },
  { tagName: 'text', selector: 'statusGlyph' },
  { tagName: 'text', selector: 'status' },
  { tagName: 'text', selector: 'summary' },
  { tagName: 'text', selector: 'overflowCount' },
  { tagName: 'path', selector: 'headerDivider' },
  { tagName: 'title', selector: 'hoverTitle' }
];

/** Incremental, read-only adapter for Nodel topology projections. No library model escapes this class. */
export class TopologyCanvas {
  private readonly graph: Graph;
  private readonly graphHost = document.createElement('div');
  private readonly labelMeasureContext = document.createElement('canvas').getContext('2d');
  private readonly nodeIds = new Map<string, TopologyCanvasNodeId>();
  private readonly wireIds = new Map<string, TopologyCanvasWireId>();
  private readonly portIds = new Map<string, TopologyCanvasPortId>();
  private readonly lastNodes = new Map<string, TopologyCanvasNode>();
  private readonly lastWires = new Map<string, TopologyCanvasWire>();
  private readonly lastWireLanes = new Map<string, { offset: number; count: number }>();
  private wireLanes = new Map<string, { offset: number; count: number }>();
  private readonly dragObstacleVertices = new Map<string, { nodeId: string; vertices: { x: number; y: number }[] }>();
  private localRouting = false;
  private readonly currentPositions = new Map<string, TopologyCanvasPoint>();
  private readonly domainNodes = new Map<string, string>();
  private readonly domainWires = new Map<string, string>();
  private readonly styleElement: HTMLStyleElement;
  private resizeObserver: ResizeObserver | null = null;
  private sequence = 0;
  private selectedCellId: string | null = null;
  private selectedPortKey: string | null = null;
  private selectedPortNodeId: string | null = null;
  private readonly programmaticPositions = new Set<string>();
  private applyingViewport = false;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: TopologyCanvasCallbacks = {}
  ) {
    this.container.classList.add('nodel-topology-canvas');
    this.styleElement = document.createElement('style');
    this.styleElement.textContent = canvasStyles;
    // X6 writes pixel dimensions to its mount. Keep it separate from the
    // bordered grid item whose content box supplies those dimensions.
    this.container.append(this.graphHost);

    // Suppress X6's global baseline style for this constructor only; its own behavior stays scoped.
    const previousAutoInsertCSS = Config.autoInsertCSS;
    Config.autoInsertCSS = false;
    try {
      this.graph = new Graph({
        container: this.graphHost,
        width: this.container.clientWidth || 800,
        height: this.container.clientHeight || 600,
        background: { color: 'transparent' },
        grid: false,
        mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.25, maxScale: 2.5 },
        interacting: (view) => view.cell.isEdge()
          ? { edgeMovable: false, edgeLabelMovable: false, arrowheadMovable: false, vertexMovable: false, vertexAddable: false, vertexDeletable: false, magnetConnectable: false, toolsAddable: false }
          : { nodeMovable: true, magnetConnectable: false, toolsAddable: false },
        connecting: {
          anchor: 'nodeCenter', // X6 model port layout, not a measured SVG text/socket union
          connectionPoint: 'anchor',
          allowBlank: false,
          allowLoop: true,
          allowNode: false,
          allowEdge: false,
          allowPort: false,
          allowMulti: true,
          validateMagnet: () => false,
          validateConnection: () => false
        },
        preventDefaultContextMenu: true,
        panning: { enabled: true, eventTypes: ['leftMouseDown', 'rightMouseDown'] },
        async: false
      });
    } finally {
      Config.autoInsertCSS = previousAutoInsertCSS;
    }
    this.container.prepend(this.styleElement);
    this.bindEvents();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.disposed && this.syncGraphSize()) this.callbacks.onCanvasResized?.();
      });
      this.resizeObserver.observe(this.container);
    }
  }

  update(projection: TopologyCanvasProjection): void {
    this.assertActive();
    const wantedNodes = new Set(projection.nodes.map((node) => node.id));
    const ports = new Map(projection.nodes.map(node => [node.id, new Set(node.ports.map(port => port.id))]));
    const visibleWires = projection.wires.filter(wire => ports.get(wire.source.nodeId)?.has(wire.source.portId)
      && ports.get(wire.target.nodeId)?.has(wire.target.portId));
    // Obstacle pathfinding is useful on a diagram one can read at once. On
    // larger graphs use X6's terminal-local orthogonal routing instead.
    const localRouting = wantedNodes.size > 24 || visibleWires.length > 64;
    const routerChanged = this.localRouting !== localRouting;
    this.localRouting = localRouting;
    // Let X6 coalesce view updates by cell and paint across animation frames
    // rather than blocking pending browser reads on a thousand SVG edges.
    this.graph.options.async = localRouting;
    const wantedWires = new Set(visibleWires.map((wire) => wire.id));
    this.wireLanes = this.calculateWireLanes(visibleWires);

    for (const [domainId, opaqueId] of this.wireIds) {
      if (!wantedWires.has(domainId)) {
        const edge = this.graph.getCellById(opaqueId);
        if (edge) this.graph.removeCell(edge);
        this.lastWires.delete(domainId);
        this.lastWireLanes.delete(domainId);
        this.dragObstacleVertices.delete(domainId);
        // Keep the opaque identity as a small adapter-side tombstone. Progressive
        // projections can temporarily omit a wire while resolving its endpoint;
        // if it returns, preserve both selection and physical edge identity.
      }
    }

    for (const [domainId, opaqueId] of this.nodeIds) {
      if (!wantedNodes.has(domainId)) {
        const cell = this.graph.getCellById(opaqueId);
        if (cell) this.graph.removeCell(cell);
        this.nodeIds.delete(domainId);
        this.domainNodes.delete(opaqueId);
        if (this.selectedCellId === opaqueId) this.selectCell(null);
        this.currentPositions.delete(domainId);
        for (const port of this.lastNodes.get(domainId)?.ports ?? []) this.portIds.delete(this.portKey(domainId, port.id));
        if (this.selectedPortKey && this.selectedPortKey.startsWith(`${domainId.length}:${domainId}`)) this.selectPort(null);
        this.lastNodes.delete(domainId);
      }
    }

    for (const node of projection.nodes) this.updateNode(node);
    for (const wire of visibleWires) this.updateWire(wire, routerChanged, this.wireLanes.get(wire.id) ?? { offset: 0, count: 1 });
    if (this.wireIds.size > MAX_CACHED_WIRE_IDS) {
      for (const [domainId, opaqueId] of this.wireIds) {
        if (this.wireIds.size <= MAX_CACHED_WIRE_IDS) break;
        if (wantedWires.has(domainId) || this.selectedCellId === opaqueId) continue;
        this.wireIds.delete(domainId);
        this.domainWires.delete(opaqueId);
        this.lastWires.delete(domainId);
        this.lastWireLanes.delete(domainId);
        this.dragObstacleVertices.delete(domainId);
      }
    }
  }

  getViewport(): TopologyCanvasViewport {
    const matrix = this.graph.transform.getMatrix();
    return { x: matrix.e, y: matrix.f, scale: matrix.a };
  }

  setViewport(viewport: TopologyCanvasViewport, options: { notify?: boolean } = {}): void {
    this.assertActive();
    if (![viewport.x, viewport.y, viewport.scale].every(Number.isFinite) || viewport.scale < 0.25 || viewport.scale > 2.5) return;
    const before = this.getViewport();
    if (before.x === viewport.x && before.y === viewport.y && before.scale === viewport.scale) return;
    this.applyingViewport = true;
    try {
      this.graph.transform.setMatrix({ a: viewport.scale, b: 0, c: 0, d: viewport.scale, e: viewport.x, f: viewport.y });
    } finally {
      this.applyingViewport = false;
    }
    if (options.notify !== false) this.callbacks.onViewportChanged?.(this.getViewport());
  }

  /** Fit the currently rendered nodes without moving them or clearing saved positions. */
  fitToView(padding = 56): void {
    this.frameNodes([...this.nodeIds.keys()], { padding, minScale: 0.25, maxScale: 1 });
  }

  /** Frame only the rendered nodes in `nodeIds`, clamping scale to the same range as wheel zoom/storage. */
  frameNodes(nodeIds: Iterable<string>, options: TopologyCanvasFrameOptions = {}): void {
    this.assertActive();
    const nodes = [...nodeIds].flatMap((id) => {
      const opaqueId = this.nodeIds.get(id);
      const node = opaqueId ? this.graph.getCellById(opaqueId) : null;
      return node?.isNode() ? [node] : [];
    });
    if (!nodes.length) return;
    // An inspector action can change grid tracks before ResizeObserver delivers.
    // Measure the actual canvas and size X6 before applying the camera transform.
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width <= 0 || height <= 0) return;
    this.syncGraphSize(width, height);
    const padding = Number.isFinite(options.padding) ? Math.max(0, options.padding!) : 56;
    const minimum = Number.isFinite(options.minScale) ? Math.max(0.25, Math.min(2.5, options.minScale!)) : 0.25;
    const maximum = Number.isFinite(options.maxScale) ? Math.max(minimum, Math.min(2.5, options.maxScale!)) : 1;
    const left = Math.min(...nodes.map((node) => node.position().x));
    const top = Math.min(...nodes.map((node) => node.position().y));
    const right = Math.max(...nodes.map((node) => node.position().x + node.size().width));
    const bottom = Math.max(...nodes.map((node) => node.position().y + node.size().height));
    const contentWidth = Math.max(1, right - left);
    const contentHeight = Math.max(1, bottom - top);
    const availableWidth = Math.max(1, width - padding * 2);
    const availableHeight = Math.max(1, height - padding * 2);
    const scale = Math.max(minimum, Math.min(maximum, availableWidth / contentWidth, availableHeight / contentHeight));
    this.setViewport({
      x: (width - contentWidth * scale) / 2 - left * scale,
      y: (height - contentHeight * scale) / 2 - top * scale,
      scale
    });
  }

  private syncGraphSize(width = this.container.clientWidth, height = this.container.clientHeight): boolean {
    if (width <= 0 || height <= 0 || (width === this.graph.options.width && height === this.graph.options.height)) return false;
    this.graph.resize(width, height);
    return true;
  }

  /** Frame the whole rendered relationship component containing the given node. */
  frameConnectedGroup(nodeId: string, options: TopologyCanvasFrameOptions = {}): void {
    this.assertActive();
    if (!this.nodeIds.has(nodeId)) return;
    const adjacency = new Map([...this.nodeIds.keys()].map((id) => [id, new Set<string>()]));
    for (const edge of this.graph.getEdges()) {
      const source = this.domainNodes.get(edge.getSourceCellId() ?? '');
      const target = this.domainNodes.get(edge.getTargetCellId() ?? '');
      if (!source || !target) continue;
      adjacency.get(source)?.add(target);
      adjacency.get(target)?.add(source);
    }
    const visited = new Set<string>([nodeId]);
    const pending = [nodeId];
    while (pending.length) {
      const current = pending.pop()!;
      for (const neighbor of adjacency.get(current) ?? []) if (!visited.has(neighbor)) {
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    this.frameNodes(visited, options);
  }

  resetViewport(): void {
    this.fitToView(48);
  }

  centerOnNode(nodeId: string): void {
    this.assertActive();
    const opaqueId = this.nodeIds.get(nodeId);
    const node = opaqueId ? this.graph.getCellById(opaqueId) : null;
    if (node?.isNode()) this.graph.centerCell(node);
  }

  selectNode(nodeId: string | null): void {
    this.selectDomainCell(nodeId ? this.nodeIds.get(nodeId) ?? null : null);
  }

  selectWire(wireId: string | null): void {
    this.selectDomainCell(wireId ? this.wireIds.get(wireId) ?? null : null);
  }

  /** Select a physical endpoint without exposing X6's opaque port ID. */
  selectPort(nodeId: string | null, portId?: string | null): void {
    this.assertActive();
    const previousNodeId = this.selectedPortNodeId;
    this.selectedPortKey = nodeId && portId ? this.portKey(nodeId, portId) : null;
    this.selectedPortNodeId = nodeId && portId ? nodeId : null;
    if (previousNodeId) this.updatePortLabels(previousNodeId);
    if (this.selectedPortNodeId && this.selectedPortNodeId !== previousNodeId) this.updatePortLabels(this.selectedPortNodeId);
    const affectedNodes = new Set([previousNodeId, this.selectedPortNodeId].filter((id): id is string => Boolean(id)));
    for (const id of affectedNodes) this.refreshIncidentRoutes(id);
    this.refreshSelectedPort();
  }

  /** Bring an endpoint into view while retaining its exact X6 terminal. */
  centerOnPort(nodeId: string, portId: string): void {
    this.assertActive();
    const nodeOpaqueId = this.nodeIds.get(nodeId);
    const portOpaqueId = this.portIds.get(this.portKey(nodeId, portId));
    const node = nodeOpaqueId ? this.graph.getCellById(nodeOpaqueId) : null;
    const view = node?.isNode() ? this.graph.findViewByCell(node) : null;
    const portElement = portOpaqueId && view && NodeView.isNodeView(view) ? view.findPortElem(portOpaqueId) : null;
    const bounds = portElement?.getBoundingClientRect();
    if (!bounds) return;
    const canvas = this.container.getBoundingClientRect();
    const viewport = this.getViewport();
    this.setViewport({ x: viewport.x + canvas.left + canvas.width / 2 - (bounds.left + bounds.width / 2), y: viewport.y + canvas.top + canvas.height / 2 - (bounds.top + bounds.height / 2), scale: viewport.scale });
  }

  /** Reposition existing blocks without replacing their X6 cells or changing ports. */
  setNodePositions(positions: ReadonlyMap<string, TopologyCanvasPoint>): void {
    this.assertActive();
    for (const [domainId, point] of positions) {
      if (![point.x, point.y].every(Number.isFinite)) continue;
      const previous = this.currentPositions.get(domainId);
      if (previous?.x === point.x && previous.y === point.y) continue;
      this.currentPositions.set(domainId, { ...point });
      const opaqueId = this.nodeIds.get(domainId);
      const node = opaqueId ? this.graph.getCellById(opaqueId) : null;
      if (node?.isNode()) {
        this.programmaticPositions.add(domainId);
        try { node.position(point.x, point.y); } finally { this.programmaticPositions.delete(domainId); }
      }
    }
  }

  /** Snapshot identity for lifecycle tests and adapter diagnostics; it is not mutable graph state. */
  getRenderedCounts(): { nodes: number; wires: number; ports: number } {
    return {
      nodes: this.graph.getNodes().length,
      wires: this.graph.getEdges().length,
      ports: this.graph.getNodes().reduce((total, node) => total + node.getPorts().length, 0)
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.graph.dispose();
    this.graphHost.remove();
    this.styleElement.remove();
    this.container.classList.remove('nodel-topology-canvas');
    this.nodeIds.clear();
    this.wireIds.clear();
    this.portIds.clear();
    this.lastNodes.clear();
    this.lastWires.clear();
    this.lastWireLanes.clear();
    this.wireLanes.clear();
    this.dragObstacleVertices.clear();
    this.currentPositions.clear();
    this.programmaticPositions.clear();
    this.domainNodes.clear();
    this.domainWires.clear();
    this.selectedPortKey = null;
    this.selectedPortNodeId = null;
  }

  private bindEvents(): void {
    this.graph.on('node:click', ({ node }) => {
      this.selectPort(null);
      this.selectCell(node.id);
      this.callbacks.onWireSelected?.(null);
      this.callbacks.onNodeSelected?.(this.domainNodes.get(node.id) ?? null);
    });
    this.graph.on('edge:click', ({ edge }) => {
      this.selectPort(null);
      this.selectCell(edge.id);
      this.callbacks.onNodeSelected?.(null);
      this.callbacks.onWireSelected?.(this.domainWires.get(edge.id) ?? null);
    });
    this.graph.on('blank:click', () => {
      this.selectPort(null);
      this.selectCell(null);
      this.callbacks.onNodeSelected?.(null);
      this.callbacks.onWireSelected?.(null);
    });
    this.graph.on('node:change:position', ({ node }) => {
      const id = this.domainNodes.get(node.id);
      if (!id) return;
      const position = node.getPosition();
      const next = { x: position.x, y: position.y };
      this.currentPositions.set(id, next);
      this.refreshIncidentRoutes(id);
      if (!this.programmaticPositions.has(id)) this.callbacks.onNodeMoved?.(id, next);
    });
    this.graph.on('node:moved', ({ node }) => this.invalidateRoutesCrossingNode(node.id));
    const viewportChanged = () => {
      if (!this.applyingViewport) this.callbacks.onViewportChanged?.(this.getViewport());
    };
    this.graph.on('scale', viewportChanged);
    this.graph.on('translate', viewportChanged);
    // Async X6 rendering can mount node views after selectPort has updated the
    // model. Reapply the visual selection once X6 reports the frame complete.
    this.graph.on('render:done', () => this.refreshSelectedPort());
    this.graph.on('view:mounted', ({ view }) => {
      if (!view.cell.isNode() || this.domainNodes.get(view.cell.id) !== this.selectedPortNodeId) return;
      const nodeView = view as NodeView;
      this.refreshSelectedPortNode(nodeView);
      requestAnimationFrame(() => {
        if (!this.disposed) this.refreshSelectedPortNode(nodeView);
      });
    });
  }

  private selectCell(cellId: string | null): void {
    if (this.selectedCellId) this.graph.findViewByCell(this.selectedCellId)?.container.classList.remove('is-selected');
    this.selectedCellId = cellId;
    if (cellId) this.graph.findViewByCell(cellId)?.container.classList.add('is-selected');
  }

  private selectDomainCell(cellId: string | null): void {
    this.assertActive();
    this.selectCell(cellId);
  }

  private calculateWireLanes(wires: readonly TopologyCanvasWire[]): Map<string, { offset: number; count: number }> {
    const groups = new Map<string, TopologyCanvasWire[]>();
    for (const wire of wires) {
      const endpoints = [wire.source.nodeId, wire.target.nodeId].sort();
      const key = JSON.stringify(endpoints);
      const group = groups.get(key) ?? [];
      group.push(wire);
      groups.set(key, group);
    }
    const lanes = new Map<string, { offset: number; count: number }>();
    for (const group of groups.values()) {
      group.sort((left, right) => left.id.localeCompare(right.id));
      for (let index = 0; index < group.length; index++) {
        // 64 model units remains a 16px separation even at the 0.25 zoom floor,
        // so widened 16px hit paths stay individually clickable.
        lanes.set(group[index]!.id, { offset: (index - (group.length - 1) / 2) * 64, count: group.length });
      }
    }
    return lanes;
  }

  private refreshIncidentRoutes(nodeId: string): void {
    const opaqueNodeId = this.nodeIds.get(nodeId);
    if (!opaqueNodeId) return;
    for (const edge of this.graph.getConnectedEdges(opaqueNodeId)) {
      const edgeData = edge.getData<{ domainId?: string }>();
      const wire = edgeData.domainId ? this.lastWires.get(edgeData.domainId) : undefined;
      if (!wire) continue;
      this.updateWire(wire, false, this.wireLanes.get(wire.id) ?? this.lastWireLanes.get(wire.id) ?? { offset: 0, count: 1 });
    }
  }

  /**
   * Small diagrams can afford a bounded drag-end obstacle check. Large graphs
   * deliberately skip the edge-by-node scan; incident edges still reroute on
   * each movement event through refreshIncidentRoutes.
   */
  private invalidateRoutesCrossingNode(opaqueNodeId: string): void {
    if (this.localRouting || this.graph.getNodes().length > 24 || this.graph.getEdges().length > 64) return;
    const node = this.graph.getCellById(opaqueNodeId);
    const movedNode = node?.isNode() ? node : null;
    const nodeView = movedNode ? this.graph.findViewByCell(movedNode) : null;
    const body = nodeView?.container.querySelector('rect');
    const bounds = body?.getBoundingClientRect();
    if (!movedNode || !bounds || bounds.width <= 0 || bounds.height <= 0) return;
    const boundsWithClearance = { left: bounds.left - 3, right: bounds.right + 3, top: bounds.top - 3, bottom: bounds.bottom + 3 };
    for (const edge of this.graph.getEdges()) {
      if (edge.getSourceCellId() === opaqueNodeId || edge.getTargetCellId() === opaqueNodeId) continue;
      const view = this.graph.findViewByCell(edge);
      const domainId = edge.getData<{ domainId?: string }>().domainId;
      const wire = domainId ? this.lastWires.get(domainId) : undefined;
      if (!wire || !view) continue;
      const lane = this.wireLanes.get(wire.id) ?? this.lastWireLanes.get(wire.id) ?? { offset: 0, count: 1 };
      const previousDetour = this.dragObstacleVertices.get(wire.id);
      const path = view.container.querySelector<SVGPathElement>('.connection');
      const crossesBounds = previousDetour?.nodeId === opaqueNodeId
        ? this.polylineCrossesBounds(this.baseWireVertices(wire, lane), movedNode)
        : Boolean(path && this.pathCrossesBounds(path, boundsWithClearance));
      if (!crossesBounds) {
        if (previousDetour?.nodeId === opaqueNodeId) {
          this.dragObstacleVertices.delete(wire.id);
          this.updateWire(wire, false, lane, true);
        }
        continue;
      }
      const detour = this.detourAroundNode(wire, lane, node);
      if (!detour) continue;
      this.dragObstacleVertices.set(wire.id, { nodeId: opaqueNodeId, vertices: detour });
      this.updateWire(wire, false, lane, true);
    }
  }

  private pathCrossesBounds(path: SVGPathElement, bounds: { left: number; right: number; top: number; bottom: number }): boolean {
    const length = path.getTotalLength();
    const samples = Math.min(1024, Math.max(2, Math.ceil(length / 6)));
    const transform = path.getScreenCTM();
    if (!transform) return false;
    for (let index = 0; index <= samples; index++) {
      const point = path.getPointAtLength(length * index / samples).matrixTransform(transform);
      if (point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom) return true;
    }
    return false;
  }

  private polylineCrossesBounds(points: readonly { x: number; y: number }[], node: Cell): boolean {
    if (!node.isNode()) return false;
    const position = node.getPosition();
    const size = node.size();
    const bounds = { left: position.x, right: position.x + size.width, top: position.y, bottom: position.y + size.height };
    for (let segment = 1; segment < points.length; segment++) {
      const start = points[segment - 1]!;
      const end = points[segment]!;
      const samples = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 6));
      for (let index = 0; index <= samples; index++) {
        const x = start.x + (end.x - start.x) * index / samples;
        const y = start.y + (end.y - start.y) * index / samples;
        if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) return true;
      }
    }
    return false;
  }

  private detourAroundNode(wire: TopologyCanvasWire, lane: { offset: number; count: number }, node: Cell): { x: number; y: number }[] | null {
    if (!node.isNode()) return null;
    const base = this.baseWireVertices(wire, lane);
    if (base.length < 2) return null;
    const start = base[0]!;
    const end = base[base.length - 1]!;
    const position = node.getPosition();
    const size = node.size();
    const padding = 16;
    const left = position.x - padding;
    const right = position.x + size.width + padding;
    const top = position.y - padding;
    const bottom = position.y + size.height + padding;
    const laneGap = lane.offset;
    if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
      const travelsRight = end.x >= start.x;
      if (travelsRight ? start.x > left || end.x < right : start.x < right || end.x > left) return null;
      const topRoute = top - Math.max(0, -laneGap);
      const bottomRoute = bottom + Math.max(0, laneGap);
      const topCost = Math.abs(start.y - topRoute) + Math.abs(end.y - topRoute);
      const bottomCost = Math.abs(start.y - bottomRoute) + Math.abs(end.y - bottomRoute);
      const y = topCost <= bottomCost ? topRoute : bottomRoute;
      const entryX = travelsRight ? left : right;
      const exitX = travelsRight ? right : left;
      return [start, { x: entryX, y: start.y }, { x: entryX, y }, { x: exitX, y }, { x: exitX, y: end.y }, end];
    }
    const travelsDown = end.y >= start.y;
    if (travelsDown ? start.y > top || end.y < bottom : start.y < bottom || end.y > top) return null;
    const leftRoute = left - Math.max(0, -laneGap);
    const rightRoute = right + Math.max(0, laneGap);
    const leftCost = Math.abs(start.x - leftRoute) + Math.abs(end.x - leftRoute);
    const rightCost = Math.abs(start.x - rightRoute) + Math.abs(end.x - rightRoute);
    const x = leftCost <= rightCost ? leftRoute : rightRoute;
    const entryY = travelsDown ? top : bottom;
    const exitY = travelsDown ? bottom : top;
    return [start, { x: start.x, y: entryY }, { x, y: entryY }, { x, y: exitY }, { x: end.x, y: exitY }, end];
  }

  private updateNode(node: TopologyCanvasNode): void {
    const previous = this.lastNodes.get(node.id);
    this.lastNodes.set(node.id, node);
    const height = Math.min(MAX_NODE_HEIGHT, node.height ?? topologyNodeHeight(node.ports.length));
    let opaqueId = this.nodeIds.get(node.id);
    const position = this.currentPositions.get(node.id) ?? node.position;
    if (!opaqueId) {
      opaqueId = this.nextId('node') as TopologyCanvasNodeId;
      this.nodeIds.set(node.id, opaqueId);
      this.domainNodes.set(opaqueId, node.id);
      this.currentPositions.set(node.id, { ...position });
      this.graph.addNode({
        id: opaqueId,
        shape: 'rect',
        x: position.x,
        y: position.y,
        width: topologyNodeSize(node.ports.length).width,
        height,
        markup: SVG_MARKUP,
        attrs: this.nodeAttrs(node),
        ports: this.portMetadata(node.id, node.ports, height),
        data: { domainId: node.id },
        zIndex: 2
      });
      this.refreshSelectedPort();
      return;
    }
    const cell = this.graph.getCellById(opaqueId);
    if (!cell?.isNode()) return;
    if (previous?.title !== node.title || previous.status !== node.status || previous.summary !== node.summary) cell.attr(this.nodeAttrs(node));
    const resized = cell.size().height !== height;
    if (resized) cell.resize(NODE_WIDTH, height);
    if (!resized && previous?.ports.length === node.ports.length && previous.ports.every((port, i) => {
      const next = node.ports[i]!;
      return port.id === next.id && port.label === next.label && port.direction === next.direction && port.position === next.position;
    })) return;
    const ids = new Set(node.ports.map(port => port.id));
    for (const port of previous?.ports ?? []) if (!ids.has(port.id)) this.portIds.delete(this.portKey(node.id, port.id));
    if (previous?.ports.some(port => !ids.has(port.id) && this.portKey(node.id, port.id) === this.selectedPortKey)) this.selectPort(null);
    cell.setPropByPath('ports/items', this.portMetadata(node.id, node.ports, height).items, { rewrite: true });
    this.refreshSelectedPort();
  }

  private nodeAttrs(node: TopologyCanvasNode) {
    const uncertain = /unresolved|ambiguous|stale|pending/i.test(node.status);
    const height = Math.min(MAX_NODE_HEIGHT, node.height ?? topologyNodeHeight(node.ports.length));
    const hiddenLabels = this.hiddenPortLabelCount(node.id, node.ports, height);
    const glyph = node.status.toLocaleLowerCase().includes('unresolved') ? '!' : node.status.toLocaleLowerCase().includes('ambiguous') ? '◆' : node.status.toLocaleLowerCase().includes('stale') ? '◷' : '●';
    const glyphColor = uncertain ? 'rgb(var(--nodel-warning, 146 64 14))' : 'rgb(var(--nodel-accent, 7 89 133))';
    return {
      body: {
        rx: 9, ry: 9, fill: 'rgb(var(--nodel-surface, 255 255 255))',
        stroke: uncertain ? 'rgb(var(--nodel-warning, 146 64 14))' : 'rgb(var(--nodel-border, 212 212 212))',
        strokeWidth: 2, 'stroke-dasharray': uncertain ? '5 3' : 'none',
        'aria-label': `${node.title}. ${node.status}. ${node.summary}${hiddenLabels ? `. ${hiddenLabels} additional endpoint names are available in the searchable inspector.` : ''}`
      },
      title: { refX: 16, refY: 24, text: node.title, 'aria-label': node.title, textWrap: { width: NODE_WIDTH - 64, height: 22, ellipsis: true }, fill: 'rgb(var(--nodel-fg, 23 23 23))', fontSize: 14, fontWeight: 600, textAnchor: 'start', textVerticalAnchor: 'middle' },
      statusGlyph: { refX: 16, refY: 48, text: glyph, fill: glyphColor, fontSize: 11, fontWeight: 700, textAnchor: 'start', textVerticalAnchor: 'middle' },
      status: { refX: 32, refY: 48, text: node.status, textWrap: { width: NODE_WIDTH - 72, height: 20, ellipsis: true }, fill: 'rgb(var(--nodel-muted, 82 82 82))', fontSize: 10, textAnchor: 'start', textVerticalAnchor: 'middle' },
      summary: { refX: 16, refY: 67, text: node.summary, textWrap: { width: NODE_WIDTH - 64, height: 20, ellipsis: true }, fill: 'rgb(var(--nodel-muted, 82 82 82))', fontSize: 10, textAnchor: 'start', textVerticalAnchor: 'middle' },
      overflowCount: { refX: NODE_WIDTH - 14, refY: 82, text: hiddenLabels ? `+${hiddenLabels} more · Inspector → Endpoints` : '', fill: 'rgb(var(--nodel-accent, 7 89 133))', fontSize: 9, fontWeight: 600, textAnchor: 'end', textVerticalAnchor: 'middle', 'aria-label': hiddenLabels ? `${hiddenLabels} endpoint names hidden; search them in Inspector Endpoints.` : '' },
      headerDivider: { d: `M 12 88 L ${NODE_WIDTH - 12} 88`, stroke: 'rgb(var(--nodel-border, 212 212 212))', strokeWidth: 1, fill: 'none', pointerEvents: 'none' },
      hoverTitle: { text: `${node.title}\n${node.status}\n${node.summary}` }
    };
  }

  private portMetadata(nodeId: string, ports: readonly TopologyCanvasPort[], height: number) {
    const presentation = this.portPresentation(nodeId, ports, height);
    const items = ports.map((port, index) => {
      const key = this.portKey(nodeId, port.id);
      let opaquePortId = this.portIds.get(key);
      if (!opaquePortId) {
        opaquePortId = this.nextId('port') as TopologyCanvasPortId;
        this.portIds.set(key, opaquePortId);
      }
      const visual = presentation.get(port.id)!;
      return {
        id: opaquePortId,
        group: port.direction,
        args: { dy: visual.dy },
        attrs: {
          portBody: {
            r: PORT_RADIUS, magnet: false,
            display: visual.socketVisible ? 'inline' : 'none',
            fill: port.direction === 'input' ? 'rgb(var(--nodel-surface, 255 255 255))' : 'rgb(var(--nodel-accent, 7 89 133))',
            stroke: port.direction === 'input' ? 'rgb(var(--nodel-accent, 7 89 133))' : 'rgb(var(--nodel-surface, 255 255 255))',
            strokeWidth: 2, 'aria-label': visual.socketAriaLabel
          },
          portLabel: {
            text: visual.labelText,
            display: visual.labelVisible ? 'inline' : 'none',
            'aria-label': visual.ariaLabel,
            textAnchor: port.direction === 'input' ? 'start' : 'end',
            x: port.direction === 'input' ? 12 : -12,
            y: 3,
            fill: 'rgb(var(--nodel-muted, 82 82 82))',
            fontSize: 10,
            fontWeight: 500,
            pointerEvents: 'none'
          },
          portTitle: { text: visual.title }
        },
        data: { direction: port.direction, domainId: port.id, index }
      };
    });
    return {
      groups: {
        input: { position: { name: 'left' }, markup: [{ tagName: 'title', selector: 'portTitle' }, { tagName: 'circle', selector: 'portBody' }, { tagName: 'text', selector: 'portLabel' }] },
        output: { position: { name: 'right' }, markup: [{ tagName: 'title', selector: 'portTitle' }, { tagName: 'circle', selector: 'portBody' }, { tagName: 'text', selector: 'portLabel' }] }
      },
      items
    };
  }

  private visiblePortLabelIds(nodeId: string, ports: readonly TopologyCanvasPort[], height: number): Set<string> {
    const visible = new Set<string>();
    const span = Math.max(0, height - PORT_LABEL_TOP - PORT_LABEL_BOTTOM);
    const rowCapacity = Math.max(1, Math.floor(span / (PORT_LABEL_GAP + 4)) + 1);
    for (const direction of ['input', 'output'] as const) {
      const candidates = ports.filter(port => port.direction === direction && Boolean(port.label));
      if (candidates.length > MAX_INDIVIDUAL_SOCKET_COUNT) {
        const selected = candidates.find(port => this.selectedPortKey === this.portKey(nodeId, port.id));
        if (selected) visible.add(selected.id);
        continue;
      }
      if (candidates.length <= rowCapacity) {
        for (const port of candidates) visible.add(port.id);
        continue;
      }
      const spacing = span / (candidates.length + 1);
      const yFor = (index: number) => PORT_LABEL_TOP + (index + 1) * spacing;
      const selectedIndex = candidates.findIndex(port => this.selectedPortKey === this.portKey(nodeId, port.id));
      const chosen: number[] = [];
      if (selectedIndex >= 0) chosen.push(selectedIndex);
      else chosen.push(Math.floor((candidates.length - 1) / 2));
      while (chosen.length < rowCapacity) {
        let best = -1;
        let bestDistance = -1;
        for (let index = 0; index < candidates.length; index++) {
          if (chosen.includes(index)) continue;
          const distance = Math.min(...chosen.map(existing => Math.abs(yFor(index) - yFor(existing))));
          if (distance > bestDistance) { best = index; bestDistance = distance; }
        }
        if (best < 0) break;
        chosen.push(best);
      }
      for (const index of chosen) visible.add(candidates[index]!.id);
    }
    return visible;
  }

  private portPresentation(nodeId: string, ports: readonly TopologyCanvasPort[], height: number): Map<string, {
    dy: number;
    socketVisible: boolean;
    labelVisible: boolean;
    labelText: string;
    ariaLabel: string;
    socketAriaLabel: string;
    title: string;
  }> {
    const byDirection = {
      input: ports.filter(port => port.direction === 'input'),
      output: ports.filter(port => port.direction === 'output')
    };
    const visibleLabels = this.visiblePortLabelIds(nodeId, ports, height);
    const presentation = new Map<string, { dy: number; socketVisible: boolean; labelVisible: boolean; labelText: string; ariaLabel: string; socketAriaLabel: string; title: string }>();
    for (const direction of ['input', 'output'] as const) {
      const directionPorts = byDirection[direction];
      const grouped = directionPorts.length > MAX_INDIVIDUAL_SOCKET_COUNT;
      const groupSpan = Math.max(0, height - GROUPED_SOCKET_TOP - PORT_LABEL_BOTTOM);
      const groupCapacity = grouped ? Math.max(1, Math.floor(groupSpan / GROUPED_SOCKET_GAP) + 1) : 0;
      const groups = new Map<number, TopologyCanvasPort[]>();
      if (grouped) directionPorts.forEach((port, index) => {
        const groupIndex = Math.min(groupCapacity - 1, Math.floor(index * groupCapacity / directionPorts.length));
        const members = groups.get(groupIndex) ?? [];
        members.push(port);
        groups.set(groupIndex, members);
      });
      const selectedIndex = directionPorts.findIndex(port => this.selectedPortKey === this.portKey(nodeId, port.id));
      const selectedGroups = new Set<number>();
      if (grouped && selectedIndex >= 0) selectedGroups.add(Math.min(groupCapacity - 1, Math.floor(selectedIndex * groupCapacity / directionPorts.length)));
      const rowIndex = new Map(directionPorts.map((port, index) => [port.id, index]));
      for (const port of directionPorts) {
        const index = rowIndex.get(port.id)!;
        const selected = this.selectedPortKey === this.portKey(nodeId, port.id);
        const groupIndex = grouped ? Math.min(groupCapacity - 1, Math.floor(index * groupCapacity / directionPorts.length)) : -1;
        const members = grouped ? groups.get(groupIndex)! : [];
        const remainingMembers = selectedGroups.has(groupIndex) ? members.filter(member => member.id !== directionPorts[selectedIndex]?.id) : members;
        const representative = grouped && remainingMembers[0]?.id === port.id;
        const socketVisible = !grouped || selected || representative;
        const labelVisible = selected
          ? Boolean(port.label)
          : grouped ? representative && remainingMembers.length > 0 : visibleLabels.has(port.id) && Boolean(port.label);
        const layoutPosition = port.position !== undefined && Number.isFinite(port.position)
          ? Math.max(0, Math.min(1, port.position))
          : (index + 1) / (directionPorts.length + 1);
        const groupPosition = grouped
          ? GROUPED_SOCKET_TOP + ((groupIndex + 0.5) / groupCapacity) * Math.max(0, height - GROUPED_SOCKET_TOP - PORT_LABEL_BOTTOM)
          : PORT_LABEL_TOP + layoutPosition * Math.max(0, height - PORT_LABEL_TOP - PORT_LABEL_BOTTOM);
        const requestedPosition = selected && grouped ? SELECTED_SOCKET_Y : groupPosition;
        const defaultPosition = ((index + 0.5) / directionPorts.length) * height;
        const groupedLabel = `×${remainingMembers.length}`;
        const labelText = labelVisible
          ? selected || !grouped ? this.fitPortLabel(port.label) : groupedLabel
          : '';
        const groupedNames = remainingMembers.map(member => member.label).filter(Boolean).join(', ');
        const ariaLabel = grouped && !selected && representative
          ? `${direction}: ${remainingMembers.length} endpoints grouped. Search Inspector Endpoints to choose one.`
          : port.label;
        const socketAriaLabel = grouped && !selected && representative ? ariaLabel : `${direction}: ${port.label}`;
        const title = grouped && !selected && representative
          ? `${direction}: ${remainingMembers.length} endpoints grouped: ${groupedNames}`
          : `${direction}: ${port.label}`;
        presentation.set(port.id, {
          dy: Math.round(requestedPosition - defaultPosition),
          socketVisible,
          labelVisible,
          labelText,
          ariaLabel,
          socketAriaLabel,
          title
        });
      }
    }
    return presentation;
  }

  private hiddenPortLabelCount(nodeId: string, ports: readonly TopologyCanvasPort[], height: number): number {
    const named = ports.filter(port => Boolean(port.label)).length;
    return Math.max(0, named - this.visiblePortLabelIds(nodeId, ports, height).size);
  }

  private updatePortLabels(nodeId: string): void {
    const ports = this.lastNodes.get(nodeId)?.ports;
    const opaqueId = this.nodeIds.get(nodeId);
    const node = opaqueId ? this.graph.getCellById(opaqueId) : null;
    if (!ports || !node?.isNode()) return;
    const height = Math.min(MAX_NODE_HEIGHT, node.size().height);
    const presentation = this.portPresentation(nodeId, ports, height);
    for (const port of ports) {
      const opaquePortId = this.portIds.get(this.portKey(nodeId, port.id));
      if (!opaquePortId) continue;
      const visual = presentation.get(port.id)!;
      const setIfChanged = (path: string, value: string | number) => {
        if (node.getPortProp(opaquePortId, path) !== value) node.setPortProp(opaquePortId, path, value);
      };
      setIfChanged('args/dy', visual.dy);
      setIfChanged('attrs/portBody/display', visual.socketVisible ? 'inline' : 'none');
      setIfChanged('attrs/portBody/aria-label', visual.socketAriaLabel);
      setIfChanged('attrs/portLabel/text', visual.labelText);
      setIfChanged('attrs/portLabel/display', visual.labelVisible ? 'inline' : 'none');
      setIfChanged('attrs/portLabel/aria-label', visual.ariaLabel);
      setIfChanged('attrs/portTitle/text', visual.title);
    }
    node.attr(this.nodeAttrs(this.lastNodes.get(nodeId)!));
  }

  private fitPortLabel(label: string): string {
    const context = this.labelMeasureContext;
    if (!context) return label.length > 14 ? `${label.slice(0, 13)}…` : label;
    context.font = `500 10px ${getComputedStyle(this.container).fontFamily || 'Arial, sans-serif'}`;
    if (context.measureText(label).width <= PORT_LABEL_WIDTH) return label;
    const characters = Array.from(label);
    while (characters.length > 0 && context.measureText(`${characters.join('')}…`).width > PORT_LABEL_WIDTH) characters.pop();
    return `${characters.join('').trimEnd()}…`;
  }

  private updateWire(wire: TopologyCanvasWire, routerChanged: boolean, lane: { offset: number; count: number }, forceRouterRefresh = false): void {
    const sourceNodeId = this.nodeIds.get(wire.source.nodeId);
    const targetNodeId = this.nodeIds.get(wire.target.nodeId);
    const sourcePortId = this.portIds.get(this.portKey(wire.source.nodeId, wire.source.portId));
    const targetPortId = this.portIds.get(this.portKey(wire.target.nodeId, wire.target.portId));
    if (!sourceNodeId || !targetNodeId || !sourcePortId || !targetPortId) return;
    const opaqueWireId = this.wireIds.get(wire.id) ?? this.nextId('wire') as TopologyCanvasWireId;
    const edge = this.graph.getCellById(opaqueWireId);
    const previous = this.lastWires.get(wire.id);
    const previousLane = this.lastWireLanes.get(wire.id);
    const laneChanged = previousLane?.offset !== lane.offset || previousLane.count !== lane.count;
    const vertices = this.wireVertices(wire, lane);
    this.lastWires.set(wire.id, wire);
    const currentVertices = edge?.isEdge() ? edge.getVertices() as unknown as { x: number; y: number }[] : [];
    const verticesChanged = currentVertices.length !== vertices.length || currentVertices.some((vertex, index) => vertex.x !== vertices[index]?.x || vertex.y !== vertices[index]?.y);
    if (edge && !routerChanged && !forceRouterRefresh && !laneChanged && !verticesChanged && previous?.source.portId === wire.source.portId && previous.source.nodeId === wire.source.nodeId
      && previous.target.nodeId === wire.target.nodeId && previous.target.portId === wire.target.portId
      && previous.label === wire.label && previous.status === wire.status) return;
    const sourceCell = this.graph.getCellById(sourceNodeId);
    const targetCell = this.graph.getCellById(targetNodeId);
    const sourcePort = sourceCell?.isNode() ? sourceCell.getPort(sourcePortId) : undefined;
    const targetPort = targetCell?.isNode() ? targetCell.getPort(targetPortId) : undefined;
    const sourceDirection = sourcePort?.group === 'input' ? 'left' : 'right';
    const endDirection = targetPort?.group === 'input' ? 'left' : 'right';
    const router = this.localRouting || wire.source.nodeId === wire.target.nodeId
      ? { name: 'orth' }
      : { name: 'manhattan', args: { padding: 20, step: 12, startDirections: [sourceDirection], endDirections: [endDirection] } };
    const edgeAttrs = {
      lines: { connection: true, strokeLinejoin: 'round' },
      line: {
        stroke: wire.status === 'stale' || wire.status === 'unresolved'
          ? 'rgb(var(--nodel-warning, 146 64 14))'
          : wire.status === 'pending' ? 'rgb(var(--nodel-accent, 7 89 133))' : 'rgb(var(--nodel-muted, 82 82 82))',
        strokeWidth: 2,
        strokeDasharray: wire.status === 'stale' ? '7 3' : wire.status === 'pending' ? '1 4' : wire.status === 'unresolved' ? '2 4' : 'none',
        targetMarker: { name: 'block', width: 8, height: 8 },
        'aria-label': `${wire.label ?? wire.id}${wire.status ? ` (${wire.status})` : ''}`
      },
      hoverTitle: { text: `${wire.label ?? wire.id}${wire.status ? ` (${wire.status})` : ''}` },
      wrap: {
        stroke: 'transparent',
        strokeWidth: 16,
        strokeLinecap: 'round',
        fill: 'none',
        pointerEvents: 'stroke',
        cursor: 'pointer'
      }
    };
    if (!edge) {
      // X6 removes edges with their former ports or nodes. A domain wire can
      // still exist with new terminals; recreate the cell under the same ID.
      this.wireIds.set(wire.id, opaqueWireId);
      this.domainWires.set(opaqueWireId, wire.id);
      this.graph.addEdge({
        id: opaqueWireId,
        markup: [
          { tagName: 'path', selector: 'line', groupSelector: 'lines', className: 'connection', attrs: { fill: 'none', pointerEvents: 'none' } },
          { tagName: 'path', selector: 'wrap', groupSelector: 'lines', className: 'connection-wrap', attrs: { fill: 'none', cursor: 'pointer', stroke: 'transparent', strokeLinecap: 'round' } },
          { tagName: 'title', selector: 'hoverTitle' }
        ],
        source: { cell: sourceNodeId, port: sourcePortId },
        target: { cell: targetNodeId, port: targetPortId },
        vertices,
        router,
        // Keep wires text-free; details are available via SVG title and inspector.
        connector: { name: 'rounded', args: { radius: 8 } },
        attrs: edgeAttrs,
        labels: [],
        data: { domainId: wire.id },
        zIndex: 1
      });
      this.lastWireLanes.set(wire.id, lane);
      if (this.selectedCellId === opaqueWireId) this.selectCell(opaqueWireId);
    } else if (edge.isEdge()) {
      if (edge.getSourceCellId() !== sourceNodeId || edge.getSourcePortId() !== sourcePortId) {
        edge.setSource({ cell: sourceNodeId, port: sourcePortId });
      }
      if (edge.getTargetCellId() !== targetNodeId || edge.getTargetPortId() !== targetPortId) {
        edge.setTarget({ cell: targetNodeId, port: targetPortId });
      }
      if (routerChanged || forceRouterRefresh) {
        if (forceRouterRefresh && !routerChanged) edge.setRouter({ name: router.name === 'orth' ? 'manhattan' : 'orth' });
        edge.setRouter(router);
      }
      if (verticesChanged) {
        edge.setVertices(vertices);
      }
      if (previous?.status !== wire.status || previous?.label !== wire.label) edge.attr(edgeAttrs);
      this.lastWireLanes.set(wire.id, lane);
    }
  }

  private wireVertices(wire: TopologyCanvasWire, lane: { offset: number; count: number }): { x: number; y: number }[] {
    return this.dragObstacleVertices.get(wire.id)?.vertices ?? this.baseWireVertices(wire, lane);
  }

  private baseWireVertices(wire: TopologyCanvasWire, lane: { offset: number; count: number }): { x: number; y: number }[] {
    const sourceNode = this.graph.getCellById(this.nodeIds.get(wire.source.nodeId) ?? '');
    const targetNode = this.graph.getCellById(this.nodeIds.get(wire.target.nodeId) ?? '');
    const sourcePortId = this.portIds.get(this.portKey(wire.source.nodeId, wire.source.portId));
    const targetPortId = this.portIds.get(this.portKey(wire.target.nodeId, wire.target.portId));
    if (!sourceNode?.isNode() || !targetNode?.isNode() || !sourcePortId || !targetPortId) return [];
    const sourceDirection = this.lastNodes.get(wire.source.nodeId)?.ports.find(port => port.id === wire.source.portId)?.direction;
    const targetDirection = this.lastNodes.get(wire.target.nodeId)?.ports.find(port => port.id === wire.target.portId)?.direction;
    if (!sourceDirection || !targetDirection) return [];
    const sourceLayout = sourceNode.getPortsPosition(sourceDirection)[sourcePortId]?.position;
    const targetLayout = targetNode.getPortsPosition(targetDirection)[targetPortId]?.position;
    if (!sourceLayout || !targetLayout) return [];
    const sourcePosition = sourceNode.getPosition();
    const targetPosition = targetNode.getPosition();
    const sourcePoint = { x: sourcePosition.x + sourceLayout.x, y: sourcePosition.y + sourceLayout.y };
    const targetPoint = { x: targetPosition.x + targetLayout.x, y: targetPosition.y + targetLayout.y };
    const sourceSide = sourceDirection === 'input' ? -1 : 1;
    const targetSide = targetDirection === 'input' ? -1 : 1;
    const sourceOutside = { x: sourcePoint.x + sourceSide * OUTSIDE_ANCHOR_CLEARANCE, y: sourcePoint.y };
    const targetOutside = { x: targetPoint.x + targetSide * OUTSIDE_ANCHOR_CLEARANCE, y: targetPoint.y };
    if (wire.source.nodeId === wire.target.nodeId) {
      const selfOffset = Math.abs(lane.offset);
      if (sourceSide === targetSide) {
        const sideX = sourcePoint.x + sourceSide * (OUTSIDE_ANCHOR_CLEARANCE + 32 + selfOffset);
        const laneY = sourcePoint.y + (lane.offset < 0 ? -1 : 1) * (36 + selfOffset);
        return [
          sourceOutside,
          { x: sideX, y: sourcePoint.y },
          { x: sideX, y: laneY },
          { x: sideX, y: targetPoint.y },
          targetOutside
        ];
      }
      const nodeY = sourceNode.position().y;
      const nodeHeight = sourceNode.size().height;
      const laneY = lane.offset < 0
        ? nodeY - OUTSIDE_ANCHOR_CLEARANCE - selfOffset
        : nodeY + nodeHeight + OUTSIDE_ANCHOR_CLEARANCE + selfOffset;
      return [sourceOutside, { x: sourceOutside.x, y: laneY }, { x: targetOutside.x, y: laneY }, targetOutside];
    }
    if (lane.count < 2) return [sourceOutside, targetOutside];
    const dx = targetOutside.x - sourceOutside.x;
    const dy = targetOutside.y - sourceOutside.y;
    const length = Math.hypot(dx, dy) || 1;
    const normal = { x: -dy / length, y: dx / length };
    const lanePoint = { x: (sourceOutside.x + targetOutside.x) / 2 + normal.x * lane.offset, y: (sourceOutside.y + targetOutside.y) / 2 + normal.y * lane.offset };
    return [sourceOutside, lanePoint, targetOutside];
  }

  private portKey(nodeId: string, portId: string): string {
    // Backend identifiers are kept only in this collision-safe lookup key, never in X6 selectors or markup.
    return `${nodeId.length}:${nodeId}${portId.length}:${portId}`;
  }

  private refreshSelectedPort(): void {
    for (const node of this.graph.getNodes()) {
      const view = this.graph.findViewByCell(node);
      if (view && NodeView.isNodeView(view)) this.refreshSelectedPortNode(view);
    }
  }

  private refreshSelectedPortNode(view: NodeView): void {
    const node = view.cell;
    const domainNode = this.domainNodes.get(node.id);
    for (const port of node.getPorts()) {
      const element = view.findPortElem(port.id);
      const domainPort = domainNode
        ? this.lastNodes.get(domainNode)?.ports.find(candidate => this.portIds.get(this.portKey(domainNode, candidate.id)) === port.id)?.id
        : undefined;
      element?.closest('.x6-port')?.classList.toggle('is-selected', Boolean(domainNode && domainPort && this.selectedPortKey === this.portKey(domainNode, domainPort)));
    }
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Topology canvas adapter has been disposed');
  }
}
