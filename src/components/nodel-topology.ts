import { TopologyController, type TopologyUpdate } from '../features/topology/topology-controller';
import { TopologyCanvas } from '../features/topology/topology-canvas';
import type { TopologyCanvasNode, TopologyCanvasPoint, TopologyCanvasProjection, TopologyCanvasViewport, TopologyCanvasWire } from '../features/topology/topology-canvas';
import { clearTopologyLayout, pruneTopologyLayoutPositions, readTopologyLayout, writeTopologyLayout, topologyNodeSize, type TopologyFocusRestoreState } from '../features/topology/topology-layout';
import { summarizeTopology, topologyBindingExplanation, topologyStatusCounts, type TopologyPortReveal, type TopologyScopedReveal, type TopologyStatusFacet } from '../features/topology/topology-presentation';
import { type TopologyBinding, type TopologyBindingId, type TopologyGraph, type TopologyNode, type TopologyNodeId } from '../features/topology/topology-model';
import { addTopologyWorkspaceNode, removeTopologyWorkspaceNode, resetTopologyWorkspace, topologyWorkspaceMembership, type TopologyWorkspaceSelection } from '../features/topology/topology-workspace';
import { activateTopologyPaletteEntry, topologyPalettePage, type TopologyPaletteReadability } from '../features/topology/topology-palette';
import { projectTopologyView, topologyViewBindingIds, type TopologyDisplayMode, type TopologyFocusDirection, type TopologyViewProjection } from '../features/topology/topology-view';
import { placeTopologyNodes, repairTopologyPlacementCollisions } from '../features/topology/topology-placement';
import { safeNavigationHref } from '../utils/urls';
import { ComponentLifecycle } from '../utils/component-lifecycle';
import { observeNodelVisibility } from '../data/visibility-scope';
import workspaceStyles from '../features/topology/topology-workspace.css?inline';
import './nodel-collapse';

type Selection = { type: 'node'; id: TopologyNodeId } | { type: 'binding'; id: TopologyBindingId } | null;

function projectedNodeSize(node: Pick<TopologyCanvasNode, 'id' | 'ports' | 'height'>) {
  const fallback = topologyNodeSize(node.ports.length);
  // Match the mounted X6 rectangle; unrendered inventory endpoints do not occupy space.
  return { id: node.id as TopologyNodeId, width: fallback.width, height: Math.min(420, node.height ?? fallback.height) };
}

function hasCompleteDiscovery(update: TopologyUpdate) {
  return update.phase === 'idle' && update.graph.completeness.discovery === 'complete';
}

function button(label: string, action: string, className = 'nodel-button nodel-button-ghost') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.dataset.topologyAction = action;
  element.textContent = label;
  return element;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function inventoryText(status: string, value?: readonly string[]) {
  if (status === 'success') return value?.length ? value.join(', ') : 'Available (empty)';
  if (status === 'failure') return value ? `Read failed; last known: ${value.length ? value.join(', ') : 'empty'}` : 'Could not read';
  return 'Not available';
}

export class NodelTopology extends HTMLElement {
  static observedAttributes = ['show-candidates', 'show-placeholders'];

  private lifecycle = new ComponentLifecycle();
  private controller: TopologyController | null = null;
  private canvas: TopologyCanvas | null = null;
  private stopVisibilityObserver: (() => void) | null = null;
  private update: TopologyUpdate | null = null;
  private selection: Selection = null;
  private selectedBindingOwnerId: TopologyNodeId | null = null;
  private inspectorOpen = false;
  private query = '';
  private reveal: TopologyPortReveal = 'connected';
  private expandedBrowse = false;
  private endpointBrowseNodeId: TopologyNodeId | null = null;
  private revealedEndpoints = new Set<string>();
  private endpointQuery = '';
  private endpointLimit = 50;
  private bindingQuery = '';
  private bindingLimit = 50;
  private layoutSaveTimer: number | null = null;
  private positions = new Map<TopologyNodeId, TopologyCanvasPoint>();
  private autoPositionIds = new Set<TopologyNodeId>();
  private viewport: TopologyCanvasViewport | undefined;
  private hostContext = '';
  private initialized = false;
  private statusFilters = new Set<string>(['discovered', 'partial', 'stale', 'unresolved']);
  private inspectorTab: 'overview' | 'bindings' | 'endpoints' = 'overview';
  private searchIndex = 0;
  private searchLimit = 50;
  private searchOpen = false;
  private showConnections = true;
  private showPlaceholders = true;
  private showCandidates = true;
  private scopedReveal: TopologyScopedReveal | null = null;
  private showEndpointLabels = true;
  private desktopFiltersOpen = true;
  private panelOverlay: 'filters' | 'inspector' | null = null;
  private previousFocus: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private inspectorOpener: HTMLElement | null = null;
  private connectedEndpointIds: ReadonlySet<string> = new Set();
  private evidenceWires = new Map<string, TopologyCanvasWire>();
  private renderedWireIds = new Set<string>();
  private renderedNodeIds = new Set<TopologyNodeId>();
  private selectionFramed = false;
  private initialFitDone = false;
  private cameraTouched = false;
  private graphPaintTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastGraphPaintAt = 0;
  private lastNarrowViewport = false;
  private workspace: TopologyWorkspaceSelection = { mode: 'custom', pinnedNodeIds: new Set(), omittedNodeIds: new Set() };
  private displayMode: TopologyDisplayMode = 'detailed';
  private focusDirection: TopologyFocusDirection = 'both';
  private focusHops: 1 | 2 = 1;
  private paletteQuery = '';
  private paletteHost = '';
  private paletteReadability: TopologyPaletteReadability | 'all' = 'all';
  private paletteOffset = 0;
  private projectedView: TopologyViewProjection | null = null;
  private aggregateBindingChoices: readonly TopologyBindingId[] = [];
  private aggregateWireId: string | null = null;
  private focusRestoreState: TopologyFocusRestoreState | undefined;
  private previousScopedReveal: TopologyScopedReveal | null = null;
  private focusPositions: Map<TopologyNodeId, TopologyCanvasPoint> | undefined;
  private focusLayoutKey = '';
  private focusCameraKey = '';

  connectedCallback() {
    const scope = this.lifecycle.connect();
    if (!scope || this.initialized) return;
    this.initialized = true;
    this.renderShell();
    this.bindEvents();
    this.updateViewportHeight();
    window.addEventListener('resize', this.updateViewportHeight);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.updateViewportHeight);
      if (this.parentElement) this.resizeObserver.observe(this.parentElement);
    }
    this.hostContext = window.location.origin;
    try {
      const layout = readTopologyLayout(this.hostContext);
      this.positions = new Map(layout.positions);
      this.autoPositionIds = new Set(layout.autoPositionedNodeIds ?? []);
      this.viewport = layout.viewport;
      this.initialFitDone = Boolean(layout.viewport);
      this.workspace = { mode: layout.workspaceMode ?? 'custom', pinnedNodeIds: new Set(layout.pinnedNodeIds), omittedNodeIds: new Set(layout.omittedNodeIds) };
      if (['detailed', 'overview', 'compact', 'focus', 'all-nodes'].includes(String(layout.preferences?.viewMode))) this.displayMode = layout.preferences?.viewMode as TopologyDisplayMode;
      if (layout.preferences?.focusDirection === 'upstream' || layout.preferences?.focusDirection === 'downstream' || layout.preferences?.focusDirection === 'both') this.focusDirection = layout.preferences.focusDirection;
      if (layout.preferences?.focusHops === 2) this.focusHops = 2;
      this.focusRestoreState = layout.focusRestoreState;
      if (this.displayMode === 'focus' && layout.focusRestoreState) this.selection = { type: 'node', id: layout.focusRestoreState.selectedNodeId };
      else if (layout.selectedSelection) this.selection = layout.selectedSelection.type === 'node'
        ? { type: 'node', id: layout.selectedSelection.id as TopologyNodeId } : { type: 'binding', id: layout.selectedSelection.id as TopologyBindingId };
      else if (layout.selectedNodeId) this.selection = { type: 'node', id: layout.selectedNodeId };
    } catch { /* Browser storage may be unavailable. */ }
    this.controller = new TopologyController((update) => this.acceptUpdate(update));
    this.stopVisibilityObserver = observeNodelVisibility(this, (visible) => {
      if (visible) this.controller?.start();
      else this.controller?.stop();
    }, { suspendOnConnectivity: true });
  }

  disconnectedCallback() {
    this.flushLayout();
    this.lifecycle.disconnect();
    this.stopVisibilityObserver?.();
    this.stopVisibilityObserver = null;
    this.controller?.dispose();
    this.controller = null;
    this.canvas?.dispose();
    this.canvas = null;
    this.unbindEvents();
    window.removeEventListener('resize', this.updateViewportHeight);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.graphPaintTimeout !== null) clearTimeout(this.graphPaintTimeout);
    this.graphPaintTimeout = null;
    this.initialized = false;
  }

  attributeChangedCallback(name: string) {
    if (name === 'show-candidates') this.showCandidates = this.hasAttribute('show-candidates');
    if (name === 'show-placeholders' && this.hasAttribute('show-placeholders')) this.showPlaceholders = true;
    if (this.update) this.render();
  }

  private renderShell() {
    this.replaceChildren();
    this.classList.add('nodel-topology', 'w-full', 'min-w-0');
    this.lastNarrowViewport = this.isNarrowViewport();
    const style = element('style'); style.textContent = workspaceStyles;
    const titlebar = element('header', 'nodel-topology-heading');
    titlebar.append(element('h1', 'text-lg font-semibold', 'Network topology'));
    const toolbar = element('div', 'nodel-topology-toolbar');
    const searchWrap = element('div', 'nodel-topology-search');
    const filter = element('input', 'nodel-field min-w-0 w-full');
    filter.type = 'search'; filter.placeholder = 'Find nodes, endpoints or bindings'; filter.setAttribute('aria-label', 'Find topology items'); filter.setAttribute('aria-controls', 'nodel-topology-search-results'); filter.setAttribute('aria-expanded', 'false'); filter.dataset.topologyFilter = '';
    const searchResults = element('div', 'nodel-topology-search-results'); searchResults.id = 'nodel-topology-search-results'; searchResults.dataset.topologySearchResults = ''; searchResults.hidden = true; searchResults.setAttribute('role', 'listbox');
    searchWrap.append(filter, searchResults);
    const inspect = button('Inspector', 'toggle-inspector'); inspect.setAttribute('aria-controls', 'nodel-topology-inspector'); inspect.setAttribute('aria-expanded', 'false'); inspect.dataset.topologyInspectorToggle = '';
    const filtersToggle = button('Filters', 'toggle-filters'); filtersToggle.setAttribute('aria-controls', 'nodel-topology-filters'); filtersToggle.setAttribute('aria-expanded', String(!this.isNarrowViewport())); filtersToggle.dataset.topologyFiltersToggle = '';
    const zoom = element('div', 'nodel-topology-zoom-controls'); zoom.setAttribute('aria-label', 'Canvas zoom');
    const zoomOut = button('−', 'zoom-out'); zoomOut.setAttribute('aria-label', 'Zoom out'); zoomOut.title = 'Zoom out';
    const zoomIn = button('+', 'zoom-in'); zoomIn.setAttribute('aria-label', 'Zoom in'); zoomIn.title = 'Zoom in';
    const zoomReadout = element('span', 'nodel-topology-zoom-level', '100%'); zoomReadout.setAttribute('aria-live', 'polite'); zoomReadout.setAttribute('aria-atomic', 'true');
    zoom.append(zoomOut, zoomReadout, zoomIn);
    const revealSelect = element('select', 'nodel-field'); revealSelect.dataset.topologyReveal = ''; revealSelect.setAttribute('aria-label', 'Endpoint visibility');
    for (const [value, label] of [['connected', 'Configured + revealed'], ['compact', 'Compact'], ['expanded', 'Expanded']] as const) {
      const option = element('option'); option.value = value; option.textContent = label; revealSelect.append(option);
    }
    revealSelect.value = this.expandedBrowse ? 'expanded' : this.reveal;
    const modeSelect = element('select', 'nodel-field'); modeSelect.dataset.topologyMode = ''; modeSelect.setAttribute('aria-label', 'Topology view');
    for (const [value, label] of [['detailed','Relationships'],['overview','Overview'],['compact','Compact'],['focus','Focus'],['all-nodes','All Nodes']] as const) { const option = element('option'); option.value = value; option.textContent = label; modeSelect.append(option); }
    modeSelect.value = this.displayMode;
    const focusControls = element('span', 'nodel-topology-focus-controls'); focusControls.dataset.topologyFocusControls = ''; focusControls.hidden = this.displayMode !== 'focus';
    const direction = element('select', 'nodel-field'); direction.dataset.topologyFocusDirection = ''; direction.setAttribute('aria-label', 'Focus direction');
    for (const [value, label] of [['both','Both branches'],['upstream','Upstream'],['downstream','Downstream']] as const) { const option = element('option'); option.value = value; option.textContent = label; direction.append(option); }
    direction.value = this.focusDirection;
    const hops = element('select', 'nodel-field'); hops.dataset.topologyFocusHops = ''; hops.setAttribute('aria-label', 'Focus depth');
    for (const [value, label] of [['1','1 hop'],['2','2 hops']] as const) { const option = element('option'); option.value = value; option.textContent = label; hops.append(option); }
    hops.value = String(this.focusHops); focusControls.append(direction, hops);
    const status = element('div', 'nodel-topology-status'); status.dataset.topologyStatus = '';
    const statusMessage = element('div', 'nodel-topology-status-message'); statusMessage.dataset.topologyStatusMessage = ''; statusMessage.setAttribute('role', 'status'); statusMessage.setAttribute('aria-live', 'polite'); status.append(statusMessage);
    const workspace = element('div', 'nodel-topology-workspace min-w-0 w-full');
    const sidebar = element('aside', 'nodel-topology-sidebar'); sidebar.id = 'nodel-topology-filters'; sidebar.setAttribute('aria-label', 'Find and filter topology'); sidebar.dataset.topologySidebar = '';
    sidebar.hidden = this.isNarrowViewport();
    const sidebarHead = element('div', 'nodel-topology-sidebar-head'); sidebarHead.append(element('h2', 'font-semibold', 'Find & filter'), button('Close', 'close-filters')); sidebar.append(sidebarHead);
    const palette = element('section', 'nodel-topology-palette'); palette.dataset.topologyPalette = '';
    palette.append(element('h3', 'font-semibold', 'Node inventory'));
    const paletteSearch = element('input', 'nodel-field w-full'); paletteSearch.type = 'search'; paletteSearch.placeholder = 'Search every discovered node'; paletteSearch.dataset.topologyPaletteQuery = ''; paletteSearch.setAttribute('aria-label', 'Search node inventory');
    const hostFilter = element('input', 'nodel-field w-full'); hostFilter.placeholder = 'Filter by host'; hostFilter.dataset.topologyPaletteHost = ''; hostFilter.setAttribute('aria-label', 'Filter node inventory by host');
    const readability = element('select', 'nodel-field w-full'); readability.dataset.topologyPaletteReadability = ''; readability.setAttribute('aria-label', 'Filter node inventory by read status');
    for (const [value,label] of [['all','All read statuses'],['advertised-only','Advertised only'],['pending','Pending'],['readable','Readable'],['partial','Partial'],['unreadable','Unreadable']] as const) { const option=element('option'); option.value=value; option.textContent=label; readability.append(option); }
    const paletteEntries = element('div', 'nodel-topology-palette-entries'); paletteEntries.dataset.topologyPaletteEntries = '';
    const palettePager = element('div', 'nodel-topology-palette-pager'); palettePager.dataset.topologyPalettePager = '';
    palette.append(paletteSearch,hostFilter,readability,paletteEntries,palettePager); sidebar.append(palette);
    const facets = element('fieldset', 'nodel-topology-facets'); facets.append(element('legend', 'text-xs font-semibold uppercase tracking-wide text-nodel-muted', 'Node status'));
    for (const [key, label] of [['discovered', 'Discovered'], ['partial', 'Partial'], ['stale', 'Stale'], ['unresolved', 'Unresolved']] as const) {
      const row = element('label', 'nodel-topology-facet'); const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.dataset.topologyFacet = key; checkbox.checked = true;
      row.append(checkbox, element('span', '', label), element('span', 'nodel-topology-facet-count', '0')); facets.append(row);
    }
    sidebar.append(facets);
    const toggles = element('fieldset', 'nodel-topology-toggles'); toggles.append(element('legend', 'text-xs font-semibold uppercase tracking-wide text-nodel-muted', 'Display'));
    for (const [key, label, checked] of [['connections', 'Connections', true], ['labels', 'Endpoint labels', true], ['placeholders', 'All unresolved references', this.showPlaceholders], ['candidates', 'Ambiguous references', this.showCandidates]] as const) {
      const row = element('label', 'nodel-topology-facet'); const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.dataset.topologyDisplay = key; checkbox.checked = checked; row.append(checkbox, element('span', '', label)); toggles.append(row);
    }
    sidebar.append(toggles, element('p', 'nodel-topology-filter-note text-xs text-nodel-muted', 'Status choices combine with OR. Display controls do not alter topology evidence. To find one unresolved or ambiguous reference, open Inspector → Bindings and select it.'));
    const canvasHost = element('div', 'nodel-topology-graph min-w-0 w-full'); canvasHost.dataset.topologyCanvas = ''; canvasHost.setAttribute('role', 'region'); canvasHost.setAttribute('aria-label', 'Network topology diagram'); canvasHost.tabIndex = 0;
    const emptyState = element('div', 'nodel-topology-empty'); emptyState.dataset.topologyEmpty = ''; emptyState.hidden = true; emptyState.setAttribute('role', 'status');
    canvasHost.append(emptyState);
    const inspector = element('aside', 'nodel-topology-inspector'); inspector.id = 'nodel-topology-inspector'; inspector.dataset.topologyInspector = ''; inspector.setAttribute('aria-label', 'Topology inspector'); inspector.setAttribute('aria-live', 'polite'); inspector.hidden = true;
    const inspectorHead = element('div', 'nodel-topology-inspector-head'); inspectorHead.append(element('h2', 'font-semibold', 'Inspector'), button('Close', 'close-inspector'));
    const tabs = element('div', 'nodel-topology-inspector-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [key, label] of [['overview','Overview'],['bindings','Bindings'],['endpoints','Endpoints']] as const) { const tab = button(label, `inspector-tab-${key}`); tab.id = `nodel-topology-tab-${key}`; tab.setAttribute('role','tab'); tab.setAttribute('aria-controls', 'nodel-topology-inspector-panel'); tab.dataset.topologyInspectorTab=key; tabs.append(tab); }
    const inspectorContent = element('div', 'nodel-topology-inspector-content'); inspectorContent.id = 'nodel-topology-inspector-panel'; inspectorContent.dataset.topologyInspectorContent = ''; inspectorContent.setAttribute('role', 'tabpanel');
    inspector.append(inspectorHead, tabs, inspectorContent); workspace.append(sidebar, canvasHost, inspector);
    const diagnostics = document.createElement('nodel-collapse'); diagnostics.className = 'nodel-topology-drawer'; diagnostics.setAttribute('label', 'Diagnostics'); diagnostics.setAttribute('preview', 'No diagnostics');
    const diagnosticContent = element('div', 'nodel-topology-drawer-content'); diagnosticContent.dataset.topologyDiagnosticsContent = ''; diagnostics.append(diagnosticContent);
    toolbar.append(filtersToggle, searchWrap, modeSelect, focusControls, revealSelect, button('Refresh', 'refresh'), button('Auto Layout', 'auto-layout'), button('Reset', 'reset'), button('Fit displayed', 'fit'), button('Fit selection', 'fit-selection'), button('Fit component', 'fit-component'), button('Centre', 'center'), zoom, inspect);
    this.append(style, titlebar, toolbar, status, workspace, diagnostics);
    this.syncWorkspacePanels();
  }

  private bindEvents() {
    this.addEventListener('input', this.handleInput);
    this.addEventListener('change', this.handleChange);
    this.addEventListener('click', this.handleClick);
    this.addEventListener('keydown', this.handleKeyDown);
  }

  private unbindEvents() {
    this.removeEventListener('input', this.handleInput);
    this.removeEventListener('change', this.handleChange);
    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('keydown', this.handleKeyDown);
  }

  private handleInput = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches('[data-topology-filter]')) {
      this.query = target.value;
      this.searchIndex = 0;
      this.searchLimit = 50;
      this.searchOpen = Boolean(this.query.trim());
      this.renderSearchResults();
    }
    if (target instanceof HTMLInputElement && target.matches('[data-topology-endpoint-filter]')) {
      this.endpointQuery = target.value;
      this.endpointLimit = 50;
      this.renderInspector();
    }
    if (target instanceof HTMLInputElement && target.matches('[data-topology-binding-filter]')) {
      this.bindingQuery = target.value;
      this.bindingLimit = 50;
      this.renderInspector();
    }
    if (target instanceof HTMLInputElement && target.matches('[data-topology-palette-query]')) { this.paletteQuery = target.value; this.paletteOffset = 0; this.renderPalette(); }
    if (target instanceof HTMLInputElement && target.matches('[data-topology-palette-host]')) { this.paletteHost = target.value; this.paletteOffset = 0; this.renderPalette(); }
  };

  private handleChange = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.matches('[data-topology-mode]')) {
      const nextMode = target.value as TopologyDisplayMode;
      if (this.displayMode === 'focus' && nextMode !== 'focus') this.exitTemporaryFocus();
      else if (this.displayMode !== 'focus' && nextMode === 'focus' && !this.enterTemporaryFocus()) {
        target.value = this.displayMode;
        return;
      }
      this.displayMode = nextMode;
      const controls = this.querySelector<HTMLElement>('[data-topology-focus-controls]'); if (controls) controls.hidden = this.displayMode !== 'focus';
      this.render();
      this.persistLayout();
    }
    if (target instanceof HTMLSelectElement && target.matches('[data-topology-focus-direction]')) { this.focusDirection = target.value as TopologyFocusDirection; this.persistLayout(); this.render(); }
    if (target instanceof HTMLSelectElement && target.matches('[data-topology-focus-hops]')) { this.focusHops = target.value === '2' ? 2 : 1; this.persistLayout(); this.render(); }
    if (target instanceof HTMLSelectElement && target.matches('[data-topology-palette-readability]')) { this.paletteReadability = target.value as TopologyPaletteReadability | 'all'; this.paletteOffset = 0; this.renderPalette(); }
    if (target instanceof HTMLSelectElement && target.matches('[data-topology-reveal]')) {
      if (target.value === 'expanded') {
        this.expandedBrowse = true;
        this.reveal = 'connected';
        this.endpointBrowseNodeId = this.contextNodeId() ?? this.graph().nodes[0]?.id ?? null;
        this.inspectorTab = 'endpoints';
        this.inspectorOpen = true;
        this.inspectorOpener = target;
      } else {
        this.expandedBrowse = false;
        this.reveal = target.value as TopologyPortReveal;
      }
      if (target.value === 'expanded' && this.isNarrowViewport()) this.openOverlay('inspector', target);
      this.render();
    }
    if (target instanceof HTMLSelectElement && target.matches('[data-topology-endpoint-node]')) {
      this.endpointBrowseNodeId = (target.value || null) as TopologyNodeId | null;
      this.endpointLimit = 50;
      this.renderInspector();
    }
    if (target instanceof HTMLInputElement && target.matches('[data-topology-candidates]')) {
      this.showCandidates = target.checked;
      this.render();
    }
    if (target instanceof HTMLInputElement && target.matches('[data-topology-placeholders]')) {
      this.showPlaceholders = target.checked;
      this.render();
    }
    if (target instanceof HTMLInputElement && target.matches('[data-topology-facet]')) {
      const facet = target.dataset.topologyFacet;
      if (facet) {
        if (target.checked) this.statusFilters.add(facet);
        else this.statusFilters.delete(facet);
      }
      this.render();
    }
    if (target instanceof HTMLInputElement && target.matches('[data-topology-display]')) {
      switch (target.dataset.topologyDisplay) {
        case 'connections': this.showConnections = target.checked; break;
        case 'labels': this.showEndpointLabels = target.checked; break;
        case 'placeholders': this.showPlaceholders = target.checked; break;
        case 'candidates': this.showCandidates = target.checked; break;
      }
      this.render();
    }
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches('[data-topology-filter]')) {
      const options = this.searchMatches();
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); this.searchOpen = true;
        const nextIndex = this.searchIndex + (event.key === 'ArrowDown' ? 1 : -1);
        if (event.key === 'ArrowDown' && nextIndex >= this.searchLimit && nextIndex < options.length) this.searchLimit += 50;
        this.searchIndex = Math.max(0, Math.min(Math.min(options.length - 1, this.searchLimit - 1), nextIndex));
        this.renderSearchResults();
      } else if (event.key === 'Enter' && options.length) {
        event.preventDefault(); this.selectSearchResult(options[this.searchIndex] ?? options[0]!);
      } else if (event.key === 'Escape') {
        if (this.searchOpen) { this.searchOpen = false; this.renderSearchResults(); }
        else if (this.panelOverlay) this.closeOverlay();
      }
    } else if (event.key === 'Escape' && this.panelOverlay) {
      this.closeOverlay();
    }
  };

  private handleClick = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest<HTMLElement>('[data-topology-action], [data-topology-select-type], [data-topology-reveal-endpoint], [data-topology-endpoint-more], [data-topology-search-index], [data-topology-search-more], [data-topology-palette-action], [data-topology-palette-remove], [data-topology-palette-page]');
    if (!control || !this.contains(control)) return;
    if (control.dataset.topologySelectType) {
      const keepsAggregateHighlight = control.dataset.topologySelectType === 'binding'
        && this.aggregateBindingChoices.includes(control.dataset.topologySelectId as TopologyBindingId);
      this.aggregateBindingChoices = [];
      if (!keepsAggregateHighlight) this.aggregateWireId = null;
      const type = control.dataset.topologySelectType;
      const id = control.dataset.topologySelectId;
      if (this.selection?.type !== type || this.selection.id !== id) this.scopedReveal = null;
      this.selection = type === 'node' ? { type: 'node', id: id as TopologyNodeId }
        : type === 'binding' ? { type: 'binding', id: id as TopologyBindingId } : null;
      this.selectedBindingOwnerId = type === 'binding' ? this.graph().bindings.find((binding) => binding.id === id)?.ownerId ?? null : null;
      if (this.inspectorTab === 'endpoints') this.endpointBrowseNodeId = type === 'node' ? id as TopologyNodeId : this.contextNodeId();
      this.inspectorOpen = true;
      this.syncFocusSelection();
      this.render();
      this.centerSelection();
      return;
    }
    if (control.hasAttribute('data-topology-palette-action')) {
      const id = control.dataset.topologyPaletteId as TopologyNodeId;
      const entry = topologyPalettePage(this.graph(), this.update?.nodeStatuses ?? new Map(), this.renderedNodeIds,
        { query: this.paletteQuery, host: this.paletteHost, readability: this.paletteReadability, offset: this.paletteOffset }).entries.find(item => item.id === id);
      if (entry) activateTopologyPaletteEntry(entry, (nodeId, action) => {
        if (action === 'add') { this.workspace = addTopologyWorkspaceNode(this.workspace, nodeId); this.persistLayout(); this.render(); }
        else { this.selectFromCanvas('node', nodeId, control); }
      });
      return;
    }
    if (control.hasAttribute('data-topology-palette-remove')) {
      const id = control.dataset.topologyPaletteId as TopologyNodeId;
      this.workspace = removeTopologyWorkspaceNode(this.workspace, id);
      if (this.revealIncludesNode(this.scopedReveal, id)) this.scopedReveal = null;
      if (this.revealIncludesNode(this.previousScopedReveal, id)) this.previousScopedReveal = null;
      this.persistLayout(); this.render(); return;
    }
    if (control.hasAttribute('data-topology-palette-page')) { this.paletteOffset = Math.max(0, this.paletteOffset + Number(control.dataset.topologyPalettePage) * 50); this.renderPalette(); return; }
    if (control.hasAttribute('data-topology-search-index')) {
      const result = this.searchMatches()[Number(control.dataset.topologySearchIndex)];
      if (result) this.selectSearchResult(result);
      return;
    }
    if (control.hasAttribute('data-topology-search-more')) { this.searchLimit += 50; this.renderSearchResults(); return; }
    if (control.dataset.topologyRevealEndpoint) {
      const id = control.dataset.topologyRevealEndpoint;
      const wasRevealed = this.revealedEndpoints.has(id) || this.scopedReveal?.endpointIds?.has(id);
      if (wasRevealed) {
        this.revealedEndpoints.delete(id);
        if (this.scopedReveal?.endpointIds?.has(id)) {
          this.scopedReveal = { ...this.scopedReveal, endpointIds: new Set([...this.scopedReveal.endpointIds].filter((endpointId) => endpointId !== id)) };
        }
        this.canvas?.selectPort(null);
      } else this.revealedEndpoints.add(id);
      this.render();
      if (!wasRevealed) {
        const endpoint = this.graph().endpoints.find(item => item.id === id);
        if (endpoint && typeof this.canvas?.selectPort === 'function') { this.canvas.selectPort(endpoint.nodeId, endpoint.id); this.canvas.centerOnPort(endpoint.nodeId, endpoint.id); }
      }
      return;
    }
    if (control.hasAttribute('data-topology-endpoint-more')) {
      if (control.dataset.topologyEndpointMore === 'bindings') this.bindingLimit += 50;
      else this.endpointLimit += 50;
      this.renderInspector();
      return;
    }
    if (control.dataset.topologyAction === 'toggle-inspector') {
      if (this.inspectorOpen) this.closeInspector();
      else {
        this.inspectorOpen = true;
        this.inspectorOpener = control;
        if (this.isNarrowViewport()) this.openOverlay('inspector', control);
        this.renderInspector();
      }
      return;
    }
    if (control.dataset.topologyAction === 'toggle-filters') {
      if (this.isNarrowViewport()) this.openOverlay('filters', control);
      else {
        this.desktopFiltersOpen = !this.desktopFiltersOpen;
        this.syncWorkspacePanels();
      }
      return;
    }
    if (control.dataset.topologyAction === 'close-filters') { this.closeOverlay(); return; }
    if (control.dataset.topologyAction === 'close-inspector') { this.closeInspector(); return; }
    if (control.dataset.topologyInspectorTab) {
      this.inspectorTab = control.dataset.topologyInspectorTab as typeof this.inspectorTab;
      if (this.inspectorTab === 'endpoints') this.endpointBrowseNodeId = this.contextNodeId() ?? this.endpointBrowseNodeId ?? this.graph().nodes[0]?.id ?? null;
      this.renderInspector(); return;
    }
    if (control.dataset.topologyAction === 'refresh') void this.controller?.refresh();
    if (control.dataset.topologyAction === 'auto-layout') { void this.autoLayout(); return; }
    if (control.dataset.topologyAction === 'show-binding-connection' && this.selection?.type === 'binding') {
      this.showBindingConnection(this.selection.id);
      return;
    }
    if (control.dataset.topologyAction === 'center') this.centerSelection();
    if (control.dataset.topologyAction === 'zoom-in') this.zoomViewport(1.2);
    if (control.dataset.topologyAction === 'zoom-out') this.zoomViewport(1 / 1.2);
    if (control.dataset.topologyAction === 'fit') this.fitVisible();
    if (control.dataset.topologyAction === 'fit-selection') this.fitSelection();
    if (control.dataset.topologyAction === 'fit-component') this.fitComponent();
    if (control.dataset.topologyAction === 'reset') {
      this.positions.clear(); this.viewport = undefined;
      this.workspace = resetTopologyWorkspace(); this.displayMode = 'detailed'; this.clearTemporaryFocus();
      this.autoPositionIds.clear();
      clearTopologyLayout(this.hostContext);
      this.selection = null;
      this.selectedBindingOwnerId = null;
      this.aggregateWireId = null; this.aggregateBindingChoices = [];
      this.scopedReveal = null;
      this.inspectorOpen = false;
      this.inspectorOpener = null;
      if (this.panelOverlay === 'inspector') this.closeOverlay(false);
      this.selectionFramed = false;
      this.initialFitDone = false;
      this.cameraTouched = false;
      this.render();
      this.persistLayout();
    }
  };

  private acceptUpdate(update: TopologyUpdate) {
    this.update = update;
    if (this.hostContext !== update.hostContext) {
      this.hostContext = update.hostContext;
      this.displayMode = 'detailed'; this.clearTemporaryFocus(); this.scopedReveal = null;
      this.selection = null; this.selectedBindingOwnerId = null; this.aggregateWireId = null; this.aggregateBindingChoices = [];
      this.focusDirection = 'both'; this.focusHops = 1;
      try {
        const layout = readTopologyLayout(this.hostContext);
        this.positions = new Map(layout.positions);
        this.autoPositionIds = new Set(layout.autoPositionedNodeIds ?? []);
        this.viewport = layout.viewport;
        this.workspace = { mode: layout.workspaceMode ?? 'custom', pinnedNodeIds: new Set(layout.pinnedNodeIds), omittedNodeIds: new Set(layout.omittedNodeIds) };
        if (['detailed', 'overview', 'compact', 'focus', 'all-nodes'].includes(String(layout.preferences?.viewMode))) this.displayMode = layout.preferences?.viewMode as TopologyDisplayMode;
        if (layout.preferences?.focusDirection === 'upstream' || layout.preferences?.focusDirection === 'downstream' || layout.preferences?.focusDirection === 'both') this.focusDirection = layout.preferences.focusDirection;
        if (layout.preferences?.focusHops === 2) this.focusHops = 2;
        this.focusRestoreState = layout.focusRestoreState;
        if (this.displayMode === 'focus' && layout.focusRestoreState) this.selection = { type: 'node', id: layout.focusRestoreState.selectedNodeId };
        else this.selection = layout.selectedSelection ? layout.selectedSelection.type === 'node'
          ? { type: 'node', id: layout.selectedSelection.id as TopologyNodeId } : { type: 'binding', id: layout.selectedSelection.id as TopologyBindingId }
          : layout.selectedNodeId ? { type: 'node', id: layout.selectedNodeId } : null;
        this.initialFitDone = Boolean(layout.viewport);
        this.cameraTouched = false;
      } catch { this.positions = new Map(); this.autoPositionIds.clear(); this.viewport = undefined; this.workspace = resetTopologyWorkspace(); this.initialFitDone = false; this.cameraTouched = false; }
    }
    if (this.pruneChurnedPositions(update)) this.persistLayout();
    // The controller first publishes an empty loading snapshot. Absence only
    // confirms removal after an exhaustive, settled discovery, not at startup
    // or when a discovery source fails.
    if (hasCompleteDiscovery(update)) {
      const focusId = this.focusRestoreState?.selectedNodeId;
      if (this.displayMode === 'focus' && focusId && !update.graph.nodes.some(({ id }) => id === focusId)) this.exitTemporaryFocus();
      if (this.selection?.type === 'node' && !update.graph.nodes.some(({ id }) => id === this.selection?.id)) {
        this.selection = null; this.scopedReveal = null; this.persistLayout();
      }
    }
    if (this.selection?.type === 'binding') {
      const present = update.graph.bindings.find((binding) => binding.id === this.selection?.id);
      if (present) this.selectedBindingOwnerId = present.ownerId;
      else if (this.hasDefinitivelyRemovedBinding(update)) {
        this.selection = null; this.selectedBindingOwnerId = null; this.scopedReveal = null;
      }
    }
    if (!this.selection) this.selectionFramed = false;
    this.render(true);
  }

  private hasDefinitivelyRemovedBinding(update: TopologyUpdate) {
    const graph = update.graph;
    if (update.phase !== 'idle') return false;
    const ownerId = this.selectedBindingOwnerId;
    if (!ownerId) return graph.completeness.discovery === 'complete' && graph.completeness.assignments === 'complete'
      && graph.nodes.filter((node) => node.discovery === 'advertised')
        .every((node) => node.assignmentEvidence.status === 'success' && !node.assignmentEvidence.cached);
    const owner = graph.nodes.find((node) => node.id === ownerId);
    if (!owner) return graph.completeness.discovery === 'complete';
    return owner.assignmentEvidence.status === 'success' && !owner.assignmentEvidence.cached;
  }

  private graph(): TopologyGraph { return this.update?.graph ?? {
    nodes: [], endpoints: [], bindings: [], discoveryEvidence: { status: 'absent', source: 'not-started' },
    completeness: { discovery: 'unknown', schema: 'unknown', assignments: 'unknown' }
  }; }

  private render(fromPublication = false) {
    if (!this.isConnected || !this.update) return;
    const modeControl = this.querySelector<HTMLSelectElement>('[data-topology-mode]'); if (modeControl) modeControl.value = this.displayMode;
    const focusControls = this.querySelector<HTMLElement>('[data-topology-focus-controls]'); if (focusControls) focusControls.hidden = this.displayMode !== 'focus';
    const directionControl = this.querySelector<HTMLSelectElement>('[data-topology-focus-direction]'); if (directionControl) directionControl.value = this.focusDirection;
    const hopsControl = this.querySelector<HTMLSelectElement>('[data-topology-focus-hops]'); if (hopsControl) hopsControl.value = String(this.focusHops);
    const autoLayoutControl = this.querySelector<HTMLButtonElement>('[data-topology-action="auto-layout"]');
    if (autoLayoutControl) { autoLayoutControl.disabled = this.displayMode === 'focus'; autoLayoutControl.title = this.displayMode === 'focus' ? 'Auto Layout is disabled in temporary Focus view' : ''; }
    const graph = this.graph();
    const summary = summarizeTopology(this.update, graph.nodes.length, graph.bindings.length);
    this.renderStatusStrip(summary, this.update, graph);
    const now = performance.now();
    if (fromPublication && this.canvas && graph.nodes.length > 50 && this.update.phase === 'loading'
      && now - this.lastGraphPaintAt < 120) {
      if (this.graphPaintTimeout === null) {
        const wait = Math.max(1, 120 - (now - this.lastGraphPaintAt));
        this.graphPaintTimeout = setTimeout(() => {
          this.graphPaintTimeout = null;
          if (this.isConnected) this.render();
        }, wait);
      }
      return;
    }
    if (this.graphPaintTimeout !== null) clearTimeout(this.graphPaintTimeout);
    this.graphPaintTimeout = null;
    const filters = {
      query: '',
      showCandidates: this.showCandidates,
      showPlaceholders: this.showPlaceholders,
      statuses: [...this.statusFilters] as TopologyStatusFacet[],
      showConnections: this.showConnections,
      showLabels: this.showEndpointLabels,
      showUnresolved: this.showPlaceholders,
      showAmbiguous: this.showCandidates
    };
    const fullFilters = { ...filters, statuses: ['discovered', 'partial', 'stale', 'unresolved'] as TopologyStatusFacet[], showCandidates: true, showPlaceholders: true, showUnresolved: true, showAmbiguous: true, showConnections: true, showLabels: true };
    const layoutPresentation = projectTopologyView(graph, this.positions, fullFilters, { mode: 'all-nodes' }, this.revealedEndpoints, this.update.nodeStatuses);
    const selectedNodeId = this.focusRestoreState?.selectedNodeId;
    let membership = this.workspaceMembership();
    // Focus may start from a search of an unplaced node. Reopen that anchor
    // on reload without adding it to the underlying workspace membership.
    if (this.displayMode === 'focus' && selectedNodeId && !membership.displayedNodeIds.has(selectedNodeId)
      && !this.workspace.omittedNodeIds.has(selectedNodeId)) {
      membership = { ...membership, displayedNodeIds: new Set([...membership.displayedNodeIds, selectedNodeId]) };
    }
    const viewOptions = { mode: this.displayMode, workspaceMembership: membership, ...(selectedNodeId ? { selectedNodeId } : {}), focusDirection: this.focusDirection, focusHops: this.focusHops, portReveal: this.expandedBrowse ? 'connected' as const : this.reveal };
    const presentation = projectTopologyView(graph, this.positions, filters, viewOptions, this.revealedEndpoints, this.update.nodeStatuses, this.scopedReveal ?? undefined);
    const visibleNodes = presentation.projection.nodes;
    if (this.displayMode !== 'focus') {
      this.ensurePositions(layoutPresentation.projection.nodes, layoutPresentation.projection.wires, visibleNodes);
    } else if (selectedNodeId && visibleNodes.length) {
      const focusNodes = visibleNodes.map(projectedNodeSize);
      const focusKey = JSON.stringify([selectedNodeId, this.focusDirection, this.focusHops,
        focusNodes.map(node => [node.id, node.height]),
        presentation.projection.wires.map(wire => [wire.source.nodeId, wire.target.nodeId])]);
      if (focusKey !== this.focusLayoutKey) {
        const focusWires = presentation.projection.wires.map(wire => ({ source: wire.source.nodeId as TopologyNodeId, target: wire.target.nodeId as TopologyNodeId }));
        this.focusPositions = placeTopologyNodes(focusNodes, focusWires, { mode: 'auto' });
        this.focusLayoutKey = focusKey;
      }
    }
    const activePositions = this.displayMode === 'focus' ? this.focusPositions : this.positions;
    presentation.projection.nodes = visibleNodes.map((node) => {
      const position = activePositions?.get(node.id as TopologyNodeId) ?? node.position;
      return position === node.position ? node : { ...node, position };
    });
    this.projectedView = presentation;
    const canvasHost = this.querySelector<HTMLElement>('[data-topology-canvas]');
    if (canvasHost && !this.canvas) {
      this.canvas = new TopologyCanvas(canvasHost, {
        onNodeSelected: (id) => this.selectFromCanvas('node', id, canvasHost),
        onWireSelected: (id) => this.selectFromCanvas('binding', id, canvasHost),
        onNodeMoved: (id, point) => {
          this.selectionFramed = false;
          const nodeId = id as TopologyNodeId;
          if (this.displayMode === 'focus') {
            this.focusPositions?.set(nodeId, point);
            return;
          }
          this.positions.set(nodeId, point); this.autoPositionIds.delete(nodeId);
          this.workspace = addTopologyWorkspaceNode(this.workspace, nodeId); this.persistLayout();
        },
        onViewportChanged: (viewport) => { this.selectionFramed = false; this.viewport = viewport; this.cameraTouched = true; this.initialFitDone = true; this.persistLayout(); this.updateZoomReadout(viewport.scale); },
        onCanvasResized: () => { if (this.selectionFramed) this.centerSelection(); }
      });
      if (this.viewport) this.canvas.setViewport(this.viewport, { notify: false });
    }
    const emptyState = this.querySelector<HTMLElement>('[data-topology-empty]');
    const confirmedEmpty = graph.nodes.length === 0 && this.update.coverage === 'complete' && this.update.phase === 'idle' && graph.completeness.discovery === 'complete';
    if (emptyState) {
      emptyState.hidden = !confirmedEmpty;
      emptyState.textContent = confirmedEmpty ? 'No network nodes were discovered. Refresh to check again.' : '';
    }
    const knownEndpointIds = new Set(graph.endpoints.map(({ id }) => id));
    this.connectedEndpointIds = new Set(graph.bindings.flatMap((binding) =>
      (binding.assignment === 'complete' || binding.assignmentFreshness === 'stale')
        && binding.sourceEndpointId && binding.targetEndpointId
        && knownEndpointIds.has(binding.sourceEndpointId) && knownEndpointIds.has(binding.targetEndpointId)
        ? [binding.sourceEndpointId, binding.targetEndpointId] : []));
    this.evidenceWires = new Map(layoutPresentation.projection.wires.map((wire) => [wire.id, wire]));
    this.renderedWireIds = new Set(presentation.projection.wires.map(({ id }) => id));
    this.renderedNodeIds = new Set(presentation.projection.nodes.map(({ id }) => id as TopologyNodeId));
    const projection = this.showEndpointLabels ? presentation.projection : {
      ...presentation.projection,
      nodes: presentation.projection.nodes.map((node) => ({ ...node, ports: node.ports.map((port) => ({ ...port, label: '' })) }))
    };
    this.canvas?.update(projection);
    // update() preserves existing X6 coordinates for routine projections.
    // Apply only the active view's positions to the mounted cells before fitting.
    this.canvas?.setNodePositions(new Map(projection.nodes.map(({ id, position }) => [id, position])));
    this.syncCanvasSelection();
    this.renderInspector();
    this.frameInitialEvidence(presentation.projection, layoutPresentation.projection.wires, graph);
    if (this.displayMode === 'focus' && visibleNodes.length && this.focusLayoutKey && this.focusCameraKey !== this.focusLayoutKey) {
      this.fitVisible(); this.focusCameraKey = this.focusLayoutKey;
    }
    this.renderFacetCounts(graph);
    this.renderSearchResults();
    this.renderPalette();
    const zoomLevel = this.querySelector<HTMLElement>('.nodel-topology-zoom-level');
    if (zoomLevel) zoomLevel.textContent = `${Math.round((this.canvas?.getViewport().scale ?? 1) * 100)}%`;
    // Leave discovery a scheduling window even when projection took longer than the throttle interval.
    this.lastGraphPaintAt = performance.now();
  }

  private renderStatusStrip(summary: ReturnType<typeof summarizeTopology>, update: TopologyUpdate, graph: TopologyGraph) {
    const status = this.querySelector<HTMLElement>('[data-topology-status]');
    if (!status) return;
    status.className = `nodel-topology-status flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border px-3 py-2 text-sm bg-nodel-surface${summary.tone === 'danger' ? ' border-nodel-danger text-nodel-danger' : summary.tone === 'warning' ? ' border-nodel-warning text-nodel-fg' : ' border-nodel-border text-nodel-fg'}`;
    status.querySelector('[data-topology-status-message]')?.replaceChildren(this.renderStatusMessage(summary.tone, update, graph));
    const diagnosticsDisclosure = this.querySelector<HTMLElement>('nodel-collapse');
    const diagnosticCount = update.diagnostics.length + update.diagnosticsOmitted;
    const diagnosticPreview = diagnosticCount ? `${diagnosticCount} item${diagnosticCount === 1 ? '' : 's'} · ${summary.heading}` : 'No diagnostics';
    const diagnosticsWereOpen = diagnosticsDisclosure?.querySelector<HTMLDetailsElement>('[data-collapse-details]')?.open ?? false;
    const diagnosticContent = element('div', 'mt-2 max-h-64 max-w-2xl overflow-auto text-xs');
    if (update.stale) diagnosticContent.append(element('p', 'mb-2', 'Some data is stale or pending confirmation.'));
    if (update.lastSuccessAt !== undefined) diagnosticContent.append(element('p', 'mb-2', `Last complete refresh: ${new Date(update.lastSuccessAt).toLocaleString()}.`));
    const diagnosticsList = element('ul', 'list-disc space-y-1 pl-5');
    for (const item of update.diagnostics) diagnosticsList.append(element('li', 'break-all', `${item.source}${item.nodeName ? ` · ${item.nodeName}` : ''}: ${item.message}`));
    if (update.diagnosticsOmitted > 0) diagnosticsList.append(element('li', '', `${update.diagnosticsOmitted} additional diagnostic${update.diagnosticsOmitted === 1 ? '' : 's'} omitted.`));
    if (!diagnosticCount) diagnosticsList.append(element('li', '', 'No diagnostic messages.'));
    diagnosticContent.append(diagnosticsList);
    diagnosticsDisclosure?.setAttribute('preview', diagnosticPreview);
    if (diagnosticsDisclosure) {
      const collapseContent = diagnosticsDisclosure.querySelector<HTMLElement>('.nodel-collapse-content');
      collapseContent?.replaceChildren(diagnosticContent);
      if (diagnosticsWereOpen) diagnosticsDisclosure.setAttribute('open', '');
      else diagnosticsDisclosure.removeAttribute('open');
    }
  }

  private updateViewportHeight = () => {
    if (!this.isConnected) return;
    const narrow = this.isNarrowViewport();
    if (narrow !== this.lastNarrowViewport) {
      this.lastNarrowViewport = narrow;
      // A docked inspector does not implicitly open a modal on a narrow screen.
      // Preserve the selection; the next toggle opens it as a real overlay.
      const focusWasInside = document.activeElement?.closest('[data-topology-inspector], [data-topology-sidebar]');
      if (narrow) this.inspectorOpen = false;
      this.panelOverlay = null;
      this.previousFocus = null;
      this.syncWorkspacePanels();
      if (focusWasInside?.hasAttribute('hidden')) {
        this.querySelector<HTMLElement>(focusWasInside.matches('[data-topology-inspector]')
          ? '[data-topology-inspector-toggle]' : '[data-topology-filters-toggle]')?.focus({ preventScroll: true });
      }
    }
    const top = Math.max(0, this.getBoundingClientRect().top);
    const available = Math.max(320, Math.floor(window.innerHeight - top - 24));
    this.style.setProperty('--topology-available-height', `${available}px`);
  };

  private syncWorkspacePanels() {
    const workspace = this.querySelector<HTMLElement>('.nodel-topology-workspace');
    const sidebar = this.querySelector<HTMLElement>('[data-topology-sidebar]');
    const inspector = this.querySelector<HTMLElement>('[data-topology-inspector]');
    if (!workspace || !sidebar || !inspector) return;
    const narrow = this.isNarrowViewport();
    const overlay = narrow ? this.panelOverlay : null;
    const sidebarVisible = narrow ? overlay === 'filters' : this.desktopFiltersOpen;
    const inspectorVisible = narrow ? overlay === 'inspector' : this.inspectorOpen;
    this.classList.toggle('has-overlay', overlay !== null);
    for (const [panel, visible, modal] of [[sidebar, sidebarVisible, overlay === 'filters'], [inspector, inspectorVisible, overlay === 'inspector']] as const) {
      panel.hidden = !visible;
      if (modal) { panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); }
      else { panel.removeAttribute('role'); panel.removeAttribute('aria-modal'); }
    }
    this.querySelector('[data-topology-filters-toggle]')?.setAttribute('aria-expanded', String(sidebarVisible));
    const toggle = this.querySelector('[data-topology-inspector-toggle]');
    if (toggle) {
      toggle.textContent = inspectorVisible ? 'Hide inspector' : 'Inspector';
      toggle.setAttribute('aria-expanded', String(inspectorVisible));
    }
    if (narrow) workspace.style.gridTemplateColumns = 'minmax(0, 1fr)';
    else if (sidebarVisible && inspectorVisible) workspace.style.gridTemplateColumns = '13rem minmax(0, 1fr) minmax(19rem, 22rem)';
    else if (sidebarVisible) workspace.style.gridTemplateColumns = '13rem minmax(0, 1fr)';
    else if (inspectorVisible) workspace.style.gridTemplateColumns = 'minmax(0, 1fr) minmax(19rem, 22rem)';
    else workspace.style.gridTemplateColumns = 'minmax(0, 1fr)';
  }

  private isNarrowViewport() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches;
  }

  private openOverlay(which: 'filters' | 'inspector', opener: HTMLElement) {
    this.panelOverlay = which;
    this.previousFocus = opener;
    this.inspectorOpen = which === 'inspector';
    this.syncWorkspacePanels();
    const panel = this.querySelector<HTMLElement>(which === 'filters' ? '[data-topology-sidebar]' : '[data-topology-inspector]');
    panel?.querySelector<HTMLElement>('button, input, select')?.focus({ preventScroll: true });
  }

  private closeOverlay(restoreFocus = true) {
    if (!this.panelOverlay) return;
    if (this.panelOverlay === 'inspector') {
      this.inspectorOpen = false;
      this.inspectorOpener = null;
    }
    const previous = this.previousFocus;
    this.panelOverlay = null;
    this.previousFocus = null;
    this.syncWorkspacePanels();
    if (restoreFocus) previous?.focus({ preventScroll: true });
  }

  private closeInspector() {
    const opener = this.inspectorOpener ?? (this.panelOverlay === 'inspector' ? this.previousFocus : null);
    this.inspectorOpen = false;
    this.inspectorOpener = null;
    if (this.panelOverlay === 'inspector') this.closeOverlay(false);
    else this.syncWorkspacePanels();
    opener?.focus({ preventScroll: true });
  }

  private selectFromCanvas(type: 'node' | 'binding', id: string | null, opener: HTMLElement) {
       if (!id) {
        if (this.selection?.type !== type && !this.aggregateWireId) return;
        const hadScopedReveal = this.scopedReveal !== null;
        this.selection = null;
        this.aggregateWireId = null;
        this.aggregateBindingChoices = [];
        this.selectedBindingOwnerId = null;
        this.scopedReveal = null;
        this.selectionFramed = false;
        this.closeInspector();
        if (hadScopedReveal) this.render();
        return;
      }
    if (type === 'binding') {
      const members = this.projectedView ? topologyViewBindingIds(this.projectedView, id) : [];
      if (members.length > 1) {
        this.aggregateBindingChoices = members; this.aggregateWireId = id; this.selection = null; this.selectedBindingOwnerId = null;
        this.scopedReveal = null;
        this.inspectorTab = 'bindings'; this.inspectorOpen = true; this.inspectorOpener = opener;
        if (this.isNarrowViewport()) this.openOverlay('inspector', opener);
        this.render(); return;
      }
    }
    this.aggregateWireId = null;
    this.aggregateBindingChoices = [];
    if (this.selection?.type !== type || this.selection.id !== id) this.scopedReveal = null;
    this.selection = type === 'node' ? { type, id: id as TopologyNodeId } : { type, id: id as TopologyBindingId };
    this.selectedBindingOwnerId = type === 'binding' ? this.graph().bindings.find((binding) => binding.id === id)?.ownerId ?? null : null;
    if (this.inspectorTab === 'endpoints') {
      if (type === 'node') this.endpointBrowseNodeId = id as TopologyNodeId;
      else this.inspectorTab = 'bindings';
    }
    this.inspectorOpen = true;
    this.syncFocusSelection();
    this.persistLayout();
    this.inspectorOpener = opener;
    if (this.isNarrowViewport()) this.openOverlay('inspector', opener);
    this.render();
    this.centerSelection();
  }

  private searchMatches() {
    const needle = this.query.trim().toLocaleLowerCase();
    if (!needle) return [] as Array<{ type: 'node' | 'binding' | 'endpoint'; id: string; title: string; detail: string; nodeId: TopologyNodeId }>;
    const graph = this.graph();
    const matches: Array<{ type: 'node' | 'binding' | 'endpoint'; id: string; title: string; detail: string; nodeId: TopologyNodeId }> = [];
    for (const node of graph.nodes) if (`${node.id} ${node.name} ${node.host ?? ''} ${node.addresses.map((address) => address.displayAddress).join(' ')}`.toLocaleLowerCase().includes(needle)) {
      matches.push({ type: 'node', id: node.id, title: node.name, detail: node.discovery === 'placeholder' ? 'Unresolved node' : 'Node', nodeId: node.id });
    }
    for (const endpoint of graph.endpoints) if (`${endpoint.id} ${endpoint.name} ${endpoint.kind}`.toLocaleLowerCase().includes(needle)) {
      const node = graph.nodes.find((candidate) => candidate.id === endpoint.nodeId);
      matches.push({ type: 'endpoint', id: endpoint.id, title: endpoint.name, detail: `${endpoint.kind} · ${node?.name ?? 'unknown node'}`, nodeId: endpoint.nodeId });
    }
    for (const binding of graph.bindings) if (`${binding.id} ${binding.alias} ${binding.configuredNode ?? ''} ${binding.configuredEndpoint ?? ''}`.toLocaleLowerCase().includes(needle)) {
      matches.push({ type: 'binding', id: binding.id, title: binding.alias, detail: `${binding.kind} · ${binding.configuredNode ?? 'unassigned'}${binding.configuredEndpoint ? ` / ${binding.configuredEndpoint}` : ''}`, nodeId: binding.ownerId });
    }
    return matches;
  }

  private renderSearchResults() {
    const input = this.querySelector<HTMLInputElement>('[data-topology-filter]');
    const results = this.querySelector<HTMLElement>('[data-topology-search-results]');
    if (!input || !results) return;
    const matches = this.searchMatches();
    const open = this.searchOpen && Boolean(this.query.trim());
    results.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    results.replaceChildren();
    input.removeAttribute('aria-activedescendant');
    if (!open) return;
    if (!matches.length) { results.append(element('p', 'p-3 text-sm text-nodel-muted', 'No matching nodes, endpoints, or bindings.')); return; }
    matches.slice(0, this.searchLimit).forEach((match, index) => {
      const graph = this.graph();
      const binding = match.type === 'binding' ? graph.bindings.find(({ id }) => id === match.id) : undefined;
      const relatedIds = new Set([match.nodeId, binding?.targetNodeId,
        ...[binding?.sourceEndpointId, binding?.targetEndpointId].map((id) => graph.endpoints.find((endpoint) => endpoint.id === id)?.nodeId)]);
      const related = [...relatedIds].filter((id): id is TopologyNodeId => Boolean(id)).map((id) => graph.nodes.find((node) => node.id === id)).filter((node): node is TopologyNode => Boolean(node));
      const hiddenByFacet = related.some((node) => !this.nodeFacets(node, this.update?.nodeStatuses.get(node.id)).some((facet) => this.statusFilters.has(facet)));
      const hiddenByDisplay = related.some((node) => node.discovery === 'placeholder' && !this.showPlaceholders)
        || Boolean(binding && (!this.showConnections || (binding.referenceResolution !== 'resolved' || binding.assignment !== 'complete') && !this.showPlaceholders || binding.referenceResolution === 'ambiguous' && !this.showCandidates));
      const disclosure = hiddenByFacet ? ' · hidden by status filter; select to show' : hiddenByDisplay ? ' · hidden by display control; select to inspect' : '';
      const row = button(`${match.title} · ${match.detail}${disclosure}`, '', 'nodel-topology-search-result');
      row.dataset.topologySearchIndex = String(index); row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === this.searchIndex));
      row.id = `nodel-topology-search-result-${index}`;
      if (index === this.searchIndex) input.setAttribute('aria-activedescendant', row.id);
      results.append(row);
    });
    if (matches.length > this.searchLimit) {
      const more = button(`Show more results (${matches.length - this.searchLimit} remaining)`, '', 'nodel-topology-search-result');
      more.dataset.topologySearchMore = ''; more.setAttribute('role', 'option'); results.append(more);
    }
  }

  private selectSearchResult(result: { type: 'node' | 'binding' | 'endpoint'; id: string; nodeId: TopologyNodeId }) {
    this.searchOpen = false;
    this.query = '';
    this.aggregateWireId = null;
    this.aggregateBindingChoices = [];
    this.canvas?.selectPort(null);
    const input = this.querySelector<HTMLInputElement>('[data-topology-filter]'); if (input) input.value = '';
    const graph = this.graph();
    if (result.type === 'endpoint') { this.inspectorTab = 'endpoints'; this.endpointBrowseNodeId = result.nodeId; }
    else if (this.inspectorTab === 'endpoints') {
      if (result.type === 'binding') this.inspectorTab = 'bindings';
      else this.endpointBrowseNodeId = result.nodeId;
    }
    const binding = result.type === 'binding' ? graph.bindings.find(({ id }) => id === result.id) : undefined;
    this.scopedReveal = binding && this.evidenceWires.has(binding.id)
      ? { bindingId: binding.id }
      : { nodeIds: new Set([result.nodeId]), ...(result.type === 'endpoint' ? { endpointIds: new Set([result.id]) } : {}) };
    this.selection = result.type === 'binding' ? { type: 'binding', id: result.id as TopologyBindingId } : { type: 'node', id: result.nodeId };
    this.selectedBindingOwnerId = result.type === 'binding' ? binding?.ownerId ?? null : null;
    this.inspectorOpen = true;
    this.syncFocusSelection();
    this.persistLayout();
    const opener = input ?? this.querySelector<HTMLElement>('[data-topology-inspector-toggle]');
    this.inspectorOpener = opener;
    if (this.isNarrowViewport() && opener) this.openOverlay('inspector', opener);
    this.render();
    this.centerSelection();
    if (result.type === 'endpoint' && typeof this.canvas?.selectPort === 'function') { this.canvas.selectPort(result.nodeId, result.id); this.canvas.centerOnPort(result.nodeId, result.id); }
    if (!this.isNarrowViewport()) this.querySelector<HTMLInputElement>('[data-topology-filter]')?.focus({ preventScroll: true });
  }

  private revealIncludesNode(reveal: TopologyScopedReveal | null, nodeId: TopologyNodeId) {
    if (!reveal) return false;
    if (reveal.nodeIds?.has(nodeId)) return true;
    const binding = this.graph().bindings.find(({ id }) => id === reveal.bindingId);
    if (binding?.ownerId === nodeId || binding?.targetNodeId === nodeId) return true;
    return this.graph().endpoints.some(({ id, nodeId: ownerId }) => ownerId === nodeId
      && (reveal.endpointIds?.has(id) || binding?.sourceEndpointId === id || binding?.targetEndpointId === id));
  }

  private renderFacetCounts(graph: TopologyGraph) {
    const counts = topologyStatusCounts(graph, this.update?.nodeStatuses);
    for (const [key, count] of Object.entries(counts)) {
      const facet = this.querySelector<HTMLInputElement>(`[data-topology-facet="${key}"]`);
      if (facet) facet.checked = this.statusFilters.has(key);
      const badge = facet?.closest('label')?.querySelector<HTMLElement>('.nodel-topology-facet-count'); if (badge) badge.textContent = String(count);
    }
    const displays = { connections: this.showConnections, labels: this.showEndpointLabels,
      placeholders: this.showPlaceholders, candidates: this.showCandidates };
    for (const [key, checked] of Object.entries(displays)) {
      const control = this.querySelector<HTMLInputElement>(`[data-topology-display="${key}"]`);
      if (control) control.checked = checked;
    }
  }

  private contextNodeId() {
    if (this.selection?.type === 'node') return this.selection.id;
    if (this.selection?.type === 'binding') return this.graph().bindings.find((binding) => binding.id === this.selection?.id)?.ownerId ?? this.endpointBrowseNodeId;
    return this.endpointBrowseNodeId;
  }

  private renderEndpointBrowser(host: HTMLElement) {
    const graph = this.graph();
    const contextId = this.contextNodeId() ?? graph.nodes[0]?.id ?? null;
    if (!this.endpointBrowseNodeId && contextId) this.endpointBrowseNodeId = contextId;
    const nodeId = this.endpointBrowseNodeId ?? contextId;
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    const nodePicker = element('select', 'nodel-field w-full');
    nodePicker.dataset.topologyEndpointNode = '';
    nodePicker.setAttribute('aria-label', 'Choose node endpoints');
    for (const candidate of graph.nodes) {
      const option = element('option'); option.value = candidate.id;
      option.textContent = `${candidate.name}${candidate.discovery === 'placeholder' ? ' · unresolved' : ''}`;
      option.selected = candidate.id === nodeId;
      nodePicker.append(option);
    }
    nodePicker.disabled = !graph.nodes.length;
    host.append(nodePicker);
    if (!node) {
      host.append(element('p', 'mt-2 text-sm text-nodel-muted', 'No known nodes are available for endpoint browsing yet.'));
      return;
    }
    host.append(element('h3', 'mt-2 break-all font-semibold', node.name));
    const activeInput = document.activeElement instanceof HTMLInputElement && host.contains(document.activeElement) ? document.activeElement : null;
    const caret = activeInput?.selectionStart ?? 0;
    const selectionEnd = activeInput?.selectionEnd ?? caret;
    const search = element('input', 'nodel-field w-full');
    search.type = 'search'; search.value = this.endpointQuery; search.placeholder = `Search ${node.name} endpoints`;
    search.setAttribute('aria-label', `Search endpoints on ${node.name}`); search.dataset.topologyEndpointFilter = '';
    host.append(search);
    const matching = graph.endpoints.filter((endpoint) => endpoint.nodeId === node.id
      && `${endpoint.id} ${endpoint.name} ${endpoint.kind}`.toLocaleLowerCase().includes(this.endpointQuery.toLocaleLowerCase()));
    const page = matching.slice(0, this.endpointLimit);
    if (!page.length) host.append(element('p', 'mt-2 text-sm text-nodel-muted', this.endpointQuery ? 'No endpoints match this search.' : 'No endpoint evidence is available.'));
    for (const endpoint of page) {
      const revealed = this.revealedEndpoints.has(endpoint.id) || Boolean(this.scopedReveal?.endpointIds?.has(endpoint.id));
      const connected = this.connectedEndpointIds.has(endpoint.id);
      const action = button(`${connected ? 'Configured · ' : ''}${revealed ? 'Remove manual reveal' : connected ? 'Already visible from a configured binding' : 'Reveal'} ${endpoint.name} (${endpoint.kind})`, '', 'nodel-button nodel-button-ghost mt-1 w-full whitespace-normal break-all text-left');
      action.dataset.topologyRevealEndpoint = endpoint.id; action.setAttribute('aria-pressed', String(revealed));
      if (connected && !revealed) action.disabled = true;
      host.append(action);
    }
    if (matching.length > page.length) { const more = button(`Load more (${matching.length - page.length} remaining)`, ''); more.dataset.topologyEndpointMore = ''; host.append(more); }
    if (activeInput) {
      const replacement = host.querySelector<HTMLInputElement>('[data-topology-endpoint-filter]');
      replacement?.focus({ preventScroll: true }); replacement?.setSelectionRange(caret, selectionEnd);
    }
  }

  private nodeFacets(node: TopologyNode, status?: { readability: string; stale: boolean }) {
    const evidence = [node.actionInventory, node.eventInventory, node.schemaEvidence, node.assignmentEvidence];
    return [
      ...(node.discovery !== 'placeholder' ? ['discovered'] : []),
      ...(node.discovery === 'placeholder' || (status && (status.readability === 'partial' || status.readability === 'unreadable')) || evidence.some((item) => item.status === 'failure' || item.status === 'absent') ? ['partial'] : []),
      ...(status?.stale || evidence.some((item) => item.status === 'failure' && item.value !== undefined) ? ['stale'] : []),
      ...(node.discovery === 'placeholder' || this.graph().bindings.some((binding) => binding.ownerId === node.id && binding.configuredNode && binding.configuredEndpoint && binding.referenceResolution !== 'resolved') ? ['unresolved'] : [])
    ];
  }

  private renderStatusMessage(tone: 'neutral' | 'warning' | 'danger', update: TopologyUpdate, graph: TopologyGraph) {
    const state = update.phase === 'loading' ? 'Reading'
      : update.phase === 'paused' ? 'Paused'
        : update.coverage === 'failed' ? 'Failed'
          : update.coverage === 'partial' ? 'Partial'
            : update.coverage === 'unknown' ? 'Unknown'
              : update.stale ? 'Complete · stale evidence' : 'Complete';
    const icon = update.phase === 'loading' ? '◌'
      : update.phase === 'paused' ? 'Ⅱ'
        : update.coverage === 'failed' ? '×'
          : update.coverage === 'partial' || update.stale ? '!'
            : update.coverage === 'unknown' ? '?' : '✓';
    const bindingsComplete = graph.completeness.discovery === 'complete'
      && graph.completeness.schema === 'complete' && graph.completeness.assignments === 'complete';
    const discovered = graph.nodes.filter((node) => node.discovery === 'advertised').length;
    const unresolved = graph.nodes.filter((node) => node.discovery === 'placeholder').length;
    const discoveredCount = `${discovered} node${discovered === 1 ? '' : 's'} discovered`;
    const unresolvedCount = unresolved ? ` · ${unresolved} unresolved reference${unresolved === 1 ? '' : 's'}` : '';
    const discoveryKnown = graph.completeness.discovery !== 'unknown' || graph.discoveryEvidence.status !== 'absent';
    const nodeCount = discoveryKnown || discovered || unresolved ? `${discoveredCount}${unresolvedCount}` : 'nodes unknown';
    const bindingCount = bindingsComplete ? `${graph.bindings.length} binding${graph.bindings.length === 1 ? '' : 's'}`
      : graph.bindings.length ? `${graph.bindings.length} known binding${graph.bindings.length === 1 ? '' : 's'}` : 'bindings unknown';
    const message = element('div', 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    message.append(element('span', tone === 'neutral' ? 'font-semibold text-nodel-accent' : tone === 'danger' ? 'font-semibold text-nodel-danger' : 'font-semibold text-nodel-warning', icon));
    message.lastElementChild?.setAttribute('aria-hidden', 'true');
    message.append(element('strong', '', state));
    message.append(element('span', 'text-nodel-muted', `${nodeCount} · ${bindingCount}`));
    if (update.phase === 'loading') message.append(element('span', 'text-xs text-nodel-muted', `${update.progress.completed}/${update.progress.total || '…'} checks`));
    return message;
  }

  private renderInspector() {
    this.syncWorkspacePanels();
    const panel = this.querySelector<HTMLElement>('[data-topology-inspector]');
    const host = this.querySelector<HTMLElement>('[data-topology-inspector-content]');
    if (!host || !panel || panel.hidden || !this.update) return;
    for (const tab of panel.querySelectorAll<HTMLElement>('[data-topology-inspector-tab]')) tab.setAttribute('aria-selected', String(tab.dataset.topologyInspectorTab === this.inspectorTab));
    const activeInput = document.activeElement instanceof HTMLInputElement && host.contains(document.activeElement)
      ? document.activeElement : null;
    const inputSelector = activeInput?.matches('[data-topology-binding-filter]') ? '[data-topology-binding-filter]'
      : activeInput?.matches('[data-topology-endpoint-filter]') ? '[data-topology-endpoint-filter]' : null;
    const caret = activeInput?.selectionStart ?? 0;
    const selectionEnd = activeInput?.selectionEnd ?? caret;
    const scrollTop = host.scrollTop;
    const activeControl = document.activeElement instanceof HTMLElement && host.contains(document.activeElement) ? document.activeElement : null;
    const focusDescriptor = activeControl?.dataset.topologySelectId ? ['select', activeControl.dataset.topologySelectId]
      : activeControl?.dataset.topologyRevealEndpoint ? ['endpoint', activeControl.dataset.topologyRevealEndpoint]
        : activeControl?.dataset.topologyEndpointNode !== undefined ? ['node', activeControl.dataset.topologyEndpointNode]
        : activeControl?.dataset.topologyEndpointMore !== undefined ? ['more', activeControl.dataset.topologyEndpointMore]
          : null;
    const restoreInputFocus = () => {
      host.scrollTop = scrollTop;
      if (inputSelector) {
        const replacement = host.querySelector<HTMLInputElement>(inputSelector);
        replacement?.focus({ preventScroll: true }); replacement?.setSelectionRange(caret, selectionEnd);
      } else if (focusDescriptor) {
        const selector = focusDescriptor[0] === 'select' ? '[data-topology-select-id]'
          : focusDescriptor[0] === 'endpoint' ? '[data-topology-reveal-endpoint]'
            : focusDescriptor[0] === 'node' ? '[data-topology-endpoint-node]' : '[data-topology-endpoint-more]';
        const replacement = [...host.querySelectorAll<HTMLElement>(selector)].find((control) =>
          (focusDescriptor[0] === 'select' ? control.dataset.topologySelectId
            : focusDescriptor[0] === 'endpoint' ? control.dataset.topologyRevealEndpoint
              : focusDescriptor[0] === 'node' ? (control as HTMLSelectElement).value : control.dataset.topologyEndpointMore) === focusDescriptor[1]);
        replacement?.focus({ preventScroll: true });
      }
    };
    host.replaceChildren();
    if (this.inspectorTab === 'endpoints') { this.renderEndpointBrowser(host); restoreInputFocus(); return; }
    if (this.aggregateBindingChoices.length) {
      host.append(element('h3', 'mt-3 font-semibold', 'Overview relationship bundle'));
      host.append(element('p', 'text-sm text-nodel-muted', `${this.aggregateBindingChoices.length} configured bindings share this relationship. Choose an individual binding to inspect it; the bundle is not a binding.`));
      for (const id of this.aggregateBindingChoices) {
        const binding = this.graph().bindings.find(item => item.id === id);
        if (!binding) continue;
        const choose = button(`${binding.alias} · ${binding.kind} · ${binding.assignment}`, '', 'nodel-button nodel-button-ghost mt-1 whitespace-normal break-all text-left');
        choose.dataset.topologySelectType = 'binding'; choose.dataset.topologySelectId = id; host.append(choose);
      }
      restoreInputFocus(); return;
    }
    if (!this.selection) { host.append(element('p', 'text-sm text-nodel-muted', 'Select a node or binding to inspect its evidence, relationships, and endpoints.')); restoreInputFocus(); return; }
    const graph = this.graph();
    if (this.selection.type === 'node') {
      const node = graph.nodes.find((candidate) => candidate.id === this.selection?.id);
      if (!node) {
        restoreInputFocus();
        return;
      }
      host.append(element('h3', 'mt-3 break-all text-lg font-semibold', node.name));
      host.append(element('p', 'text-sm text-nodel-muted', `${node.discovery === 'placeholder' ? 'Unresolved reference' : 'Discovered node'}${node.host ? ` · ${node.host}` : ''}`));
      if (node.duplicate) host.append(element('p', 'mt-1 text-sm text-nodel-muted', `Logical name groups ${node.duplicate.routeCount} routes (${node.duplicate.names.join(', ')}); evidence route: ${node.evidenceRouteId ?? 'disputed'}.`));
      if (node.conflicts?.length) host.append(element('p', 'mt-1 text-sm text-nodel-warning', `Route evidence disputed: ${node.conflicts.join(', ')}. No administration link is selected.`));
      if (this.inspectorTab === 'bindings') {
        const related = graph.bindings.filter((binding) => binding.ownerId === node.id || binding.targetNodeId === node.id);
        const query = this.bindingQuery.toLocaleLowerCase().trim();
        const matching = related.filter((binding) => !query || `${binding.id} ${binding.alias} ${binding.kind} ${binding.configuredNode ?? ''} ${binding.configuredEndpoint ?? ''} ${binding.assignment} ${binding.referenceResolution}`.toLocaleLowerCase().includes(query));
        const search = element('input', 'nodel-field w-full'); search.type = 'search'; search.value = this.bindingQuery; search.placeholder = 'Search this node’s bindings'; search.setAttribute('aria-label', 'Search bindings'); search.dataset.topologyBindingFilter = ''; host.append(search);
        const appendGroup = (label: string, items: readonly TopologyBinding[]) => {
          host.append(element('h4', 'mt-4 font-medium', `${label} (${items.length})`));
          if (!items.length) host.append(element('p', 'text-sm text-nodel-muted', 'None'));
          for (const item of items.slice(0, this.bindingLimit)) {
            const select = button(`${item.alias} · ${item.kind} · ${item.assignment} · ${item.referenceResolution}`, '', 'nodel-button nodel-button-ghost mt-1 whitespace-normal break-all text-left');
            select.dataset.topologySelectType = 'binding'; select.dataset.topologySelectId = item.id; host.append(select);
          }
          if (items.length > this.bindingLimit) {
            const more = button(`Load more ${label.toLocaleLowerCase()} (${items.length - this.bindingLimit} remaining)`, '');
            more.dataset.topologyEndpointMore = 'bindings'; host.append(more);
          }
        };
        appendGroup('Owned bindings', matching.filter((binding) => binding.ownerId === node.id));
        appendGroup('Incoming bindings', matching.filter((binding) => binding.targetNodeId === node.id && binding.ownerId !== node.id));
        restoreInputFocus();
        return;
      }
      this.appendCameraControls(host);
      const readStatus = this.update.nodeStatuses.get(node.id);
      host.append(element('p', 'mt-2 text-sm text-nodel-muted', `Browser read status: ${readStatus ? `${readStatus.readability}${readStatus.stale ? ' (stale)' : ''}` : node.discovery === 'advertised' ? 'advertised only' : 'unreadable'}`));
      host.append(element('h4', 'mt-4 font-medium', 'Actions'), element('p', 'break-words text-sm', inventoryText(node.actionInventory.status, node.actionInventory.value)));
      host.append(element('h4', 'mt-3 font-medium', 'Events'), element('p', 'break-words text-sm', inventoryText(node.eventInventory.status, node.eventInventory.value)));
      host.append(element('h4', 'mt-3 font-medium', 'Remote binding schema'), element('p', 'break-words text-sm', inventoryText(node.schemaEvidence.status, node.schemaEvidence.value ? [...node.schemaEvidence.value.actions, ...node.schemaEvidence.value.events] : undefined)));
      const assignments = node.assignmentEvidence.value;
      const knownAssignmentCount = assignments ? Object.keys(assignments.actions).length + Object.keys(assignments.events).length : undefined;
      host.append(element('h4', 'mt-3 font-medium', 'Assignments'), element('p', 'break-words text-sm', node.assignmentEvidence.status === 'success'
        ? `${knownAssignmentCount ?? 0} configured alias row${knownAssignmentCount === 1 ? '' : 's'}${node.assignmentEvidence.lastSuccessAt ? ` · read ${new Date(node.assignmentEvidence.lastSuccessAt).toLocaleString()}` : ''}`
        : node.assignmentEvidence.value ? `Latest read failed; showing ${knownAssignmentCount ?? 0} last-known alias rows.` : 'Unavailable'));
      for (const address of node.addresses) {
        host.append(element('h4', 'mt-3 font-medium', 'Discovered address'), element('p', 'break-all text-sm', address.displayAddress));
      }
      const legacyRouteHref = !node.evidenceRouteId && !node.duplicate ? node.addresses.find(({ adminHref }) => Boolean(adminHref))?.adminHref : undefined;
      const adminHref = node.conflicts?.length ? null : safeNavigationHref(node.adminHref ?? legacyRouteHref ?? '');
      if (adminHref) { const link = element('a', 'mt-1 inline-block text-sm underline', 'Open node administration'); link.href = adminHref; link.rel = 'noopener noreferrer'; host.append(link); }
      const related = graph.bindings.filter((binding) => binding.ownerId === node.id || binding.targetNodeId === node.id);
      const endpointsById = new Map(graph.endpoints.map((endpoint) => [endpoint.id, endpoint]));
      const outgoing = related.filter((binding) => {
        const source = binding.sourceEndpointId ? endpointsById.get(binding.sourceEndpointId) : undefined;
        return source ? source.nodeId === node.id : binding.ownerId === node.id && binding.kind === 'actions';
      });
      const incoming = related.filter((binding) => {
        const target = binding.targetEndpointId ? endpointsById.get(binding.targetEndpointId) : undefined;
        return target ? target.nodeId === node.id : binding.ownerId === node.id && binding.kind === 'events';
      });
      const appendAliasGroup = (label: string, items: readonly TopologyBinding[]) => {
        host.append(element('h4', 'mt-4 font-medium', label));
        if (!items.length) host.append(element('p', 'text-sm text-nodel-muted', 'None'));
        for (const item of items) {
          const select = button(`${item.alias} · ${item.kind}`, '', 'nodel-button nodel-button-ghost mt-1 whitespace-normal break-all text-left');
          select.dataset.topologySelectType = 'binding';
          select.dataset.topologySelectId = item.id;
          host.append(select);
        }
      };
      appendAliasGroup(`Outgoing aliases (${outgoing.length})`, outgoing);
      appendAliasGroup(`Incoming aliases (${incoming.length})`, incoming);
      restoreInputFocus();
      return;
    }
    const binding = graph.bindings.find((candidate) => candidate.id === this.selection?.id);
    if (!binding) {
      host.append(element('h3', 'mt-3 break-all text-lg font-semibold', 'Selected binding'));
      host.append(element('p', 'mt-2 text-sm text-nodel-muted', 'This alias is temporarily absent while owner assignments are being refreshed. Selection and its scoped reveal are retained until a complete fresh read confirms removal.'));
      restoreInputFocus();
      return;
    }
    const owner = graph.nodes.find((node) => node.id === binding.ownerId)?.name ?? 'Unknown node';
    host.append(element('h3', 'mt-3 break-all text-lg font-semibold', binding.alias));
    this.appendCameraControls(host);
    host.append(element('p', 'text-sm', `${binding.kind} binding on ${owner}`));
    host.append(element('p', 'mt-2 text-sm text-nodel-muted', `Declaration: ${binding.declared} · assignment: ${binding.assignment} · resolution: ${binding.referenceResolution}`));
    host.append(element('p', 'mt-2 text-sm text-nodel-muted', `Assignment row: ${binding.assignmentRow}`));
    host.append(element('p', 'mt-2 text-sm text-nodel-muted', topologyBindingExplanation(binding)));
    host.append(element('p', 'mt-2 break-words text-sm', `Configured target: ${binding.configuredNode ?? 'none'}${binding.configuredEndpoint ? ` / ${binding.configuredEndpoint}` : ''}`));
    host.append(element('p', 'mt-2 text-sm', `Direction: ${binding.kind === 'actions' ? 'owner alias calls target action' : 'target event flows to owner alias'}`));
    if (!this.renderedWireIds.has(binding.id)) {
      if (this.evidenceWires.has(binding.id)) {
        host.append(element('p', 'mt-3 text-sm text-nodel-warning', this.showConnections
          ? 'This connection is hidden by current display controls or status filters.'
          : 'Connections are hidden by the Connections display control.'));
        host.append(button('Reveal this connection', 'show-binding-connection'));
      } else {
        host.append(element('p', 'mt-3 text-sm text-nodel-muted', 'This binding has no drawable wire in the current evidence. Its owner and any configured target remain inspectable above.'));
      }
    }
    restoreInputFocus();
  }

  private persistLayout() {
    if (!this.hostContext) return;
    if (this.layoutSaveTimer !== null) window.clearTimeout(this.layoutSaveTimer);
    this.layoutSaveTimer = window.setTimeout(() => this.flushLayout(), 180);
  }

  private flushLayout() {
    if (this.layoutSaveTimer !== null) window.clearTimeout(this.layoutSaveTimer);
    this.layoutSaveTimer = null;
    if (!this.hostContext) return;
    this.pruneChurnedPositions(this.update);
    const persistedViewport = this.displayMode === 'focus' ? this.focusRestoreState?.previousViewport : this.viewport;
    writeTopologyLayout(this.hostContext, { positions: this.positions, autoPositionedNodeIds: this.autoPositionIds, ...(persistedViewport ? { viewport: persistedViewport } : {}),
      pinnedNodeIds: this.workspace.pinnedNodeIds, omittedNodeIds: this.workspace.omittedNodeIds,
      workspaceMode: this.workspace.mode, preferences: { viewMode: this.displayMode, focusDirection: this.focusDirection, focusHops: this.focusHops },
      ...(this.displayMode === 'focus' && this.focusRestoreState ? { focusRestoreState: this.focusRestoreState } : {}),
      ...(this.displayMode === 'focus' && this.focusRestoreState ? { selectedSelection: { type: 'node' as const, id: this.focusRestoreState.selectedNodeId } }
        : this.selection ? { selectedSelection: { type: this.selection.type, id: this.selection.id } } : {}),
      ...((this.displayMode === 'focus' ? this.focusRestoreState?.selectedNodeId : this.selection?.type === 'node' ? this.selection.id : undefined)
        ? { selectedNodeId: (this.displayMode === 'focus' ? this.focusRestoreState?.selectedNodeId : this.selection?.type === 'node' ? this.selection.id : undefined)! } : {}) });
  }

  private pruneChurnedPositions(update: TopologyUpdate | null) {
    if (!update || !hasCompleteDiscovery(update)) return false;
    const activeIds = new Set(update.graph.nodes.map((node) => node.id));
    this.autoPositionIds = new Set([...this.autoPositionIds].filter((id) => activeIds.has(id)));
    const previousSize = this.positions.size;
    this.positions = pruneTopologyLayoutPositions(this.positions, activeIds);
    return this.positions.size !== previousSize;
  }

  private ensurePositions(inventoryNodes: readonly TopologyCanvasNode[], wires: readonly TopologyCanvasWire[], visibleNodes: readonly TopologyCanvasNode[]) {
    const visibleSizes = new Map(visibleNodes.map((node) => [node.id, projectedNodeSize(node)]));
    const nodes = inventoryNodes.map((node) => visibleSizes.get(node.id) ?? projectedNodeSize(node));
    const missing = nodes.some(({ id }) => !this.positions.has(id));
    const placed = missing ? placeTopologyNodes(nodes, wires.map(wire => ({ source: wire.source.nodeId as TopologyNodeId, target: wire.target.nodeId as TopologyNodeId })), {
      mode: 'incremental', existingPositions: this.positions
    }) : this.positions;
    let changed = false;
    for (const node of nodes) {
      if (this.positions.has(node.id)) continue;
      const point = placed.get(node.id);
      if (!point) continue;
      this.positions.set(node.id, point); this.autoPositionIds.add(node.id); changed = true;
    }
    const repaired = repairTopologyPlacementCollisions([...visibleSizes.values()], this.positions, this.autoPositionIds);
    for (const [id, point] of repaired) if (this.positions.get(id)?.x !== point.x || this.positions.get(id)?.y !== point.y) {
      this.positions.set(id, point); changed = true;
    }
    if (changed) this.persistLayout();
  }

  private autoLayout() {
    const projection = this.projectedView?.projection;
    if (!projection || this.displayMode === 'focus') return;
    const nodes = projection.nodes.map(projectedNodeSize);
    const wires = projection.wires.map(wire => ({ source: wire.source.nodeId as TopologyNodeId, target: wire.target.nodeId as TopologyNodeId }));
    const pinnedNodeIds = new Set([...this.positions.keys()].filter(id => !this.autoPositionIds.has(id)));
    const visibleIds = new Set(nodes.map(node => node.id));
    const hiddenPositions = new Map([...this.positions].filter(([id]) => !visibleIds.has(id)));
    const hiddenAutomatic = new Set([...this.autoPositionIds].filter(id => !visibleIds.has(id)));
    const visibleLayout = placeTopologyNodes(nodes, wires, { mode: 'auto', existingPositions: this.positions, pinnedNodeIds });
    this.positions = new Map([...hiddenPositions, ...visibleLayout]);
    this.autoPositionIds = new Set([...hiddenAutomatic, ...nodes.map(node => node.id).filter(id => !pinnedNodeIds.has(id))]);
    this.persistLayout(); this.render(); this.fitVisible();
  }

  private workspaceMembership() { return topologyWorkspaceMembership(this.graph(), this.workspace); }

  private renderPalette() {
    const host = this.querySelector<HTMLElement>('[data-topology-palette-entries]');
    const pager = this.querySelector<HTMLElement>('[data-topology-palette-pager]');
    if (!host || !pager || !this.update) return;
    const hosts = [...new Set(this.graph().nodes.filter(node => node.discovery === 'advertised').map(node => node.host ?? '').filter(Boolean))].sort();
    const hostInput = this.querySelector<HTMLInputElement>('[data-topology-palette-host]');
    if (hostInput && !hostInput.list) { const list = element('datalist'); list.id = 'nodel-topology-hosts'; for (const item of hosts) { const option=element('option'); option.value=item; list.append(option); } hostInput.setAttribute('list', list.id); hostInput.after(list); }
    const page = topologyPalettePage(this.graph(), this.update.nodeStatuses, this.renderedNodeIds,
      { query: this.paletteQuery, host: this.paletteHost, readability: this.paletteReadability, offset: this.paletteOffset, limit: 50 });
    host.replaceChildren();
    for (const entry of page.entries) {
      const row = element('div', 'nodel-topology-palette-row');
      const label = element('span', 'min-w-0 break-all', `${entry.name} · ${entry.host || 'host unknown'} · ${entry.readability}`);
      const action = button(entry.present ? 'Centre' : 'Place', 'palette', 'nodel-button nodel-button-ghost'); action.dataset.topologyPaletteAction = ''; action.dataset.topologyPaletteId = entry.id;
      const remove = entry.present ? button('Remove', 'palette-remove', 'nodel-button nodel-button-ghost') : null;
      if (remove) { remove.dataset.topologyPaletteRemove = ''; remove.dataset.topologyPaletteId = entry.id; }
      row.append(label, action); if (remove) row.append(remove); host.append(row);
    }
    pager.replaceChildren();
    pager.append(element('span', 'text-xs text-nodel-muted', `${page.total ? page.offset + 1 : 0}–${page.offset + page.entries.length} of ${page.total}`));
    if (page.hasPrevious) { const previous=button('Previous', '', 'nodel-button nodel-button-ghost'); previous.dataset.topologyPalettePage='-1'; pager.append(previous); }
    if (page.hasNext) { const next=button('Next', '', 'nodel-button nodel-button-ghost'); next.dataset.topologyPalettePage='1'; pager.append(next); }
  }

  private exitTemporaryFocus() {
    const restore = this.focusRestoreState;
    if (restore) {
      this.displayMode = restore.previousMode;
      this.selection = restore.previousSelectionType && restore.previousSelectionId
        ? { type: restore.previousSelectionType, id: restore.previousSelectionId as TopologyNodeId & TopologyBindingId }
        : null;
      this.selectedBindingOwnerId = this.selection?.type === 'binding'
        ? this.graph().bindings.find(binding => binding.id === this.selection?.id)?.ownerId ?? null : null;
      this.scopedReveal = this.previousScopedReveal;
      this.viewport = restore.previousViewport;
      if (restore.previousViewport) this.canvas?.setViewport(restore.previousViewport, { notify: false });
    }
    this.selectionFramed = false;
    this.clearTemporaryFocus();
    this.persistLayout();
  }

  private clearTemporaryFocus() {
    this.focusRestoreState = undefined;
    this.previousScopedReveal = null;
    this.focusPositions = undefined;
    this.focusLayoutKey = '';
    this.focusCameraKey = '';
  }

  private syncFocusSelection() {
    if (this.displayMode !== 'focus' || !this.focusRestoreState) return;
    const selectedNodeId = this.selection?.type === 'node' ? this.selection.id
      : this.selection?.type === 'binding' ? this.graph().bindings.find(binding => binding.id === this.selection?.id)?.ownerId : undefined;
    if (selectedNodeId && selectedNodeId !== this.focusRestoreState.selectedNodeId) {
      this.focusRestoreState = { ...this.focusRestoreState, selectedNodeId };
      this.focusLayoutKey = '';
      this.persistLayout();
    }
  }

  private enterTemporaryFocus() {
    const visible = this.workspaceMembership().displayedNodeIds;
    const previousSelection = this.selection;
    const graph = this.graph();
    const requested = previousSelection?.type === 'node' ? previousSelection.id
      : graph.bindings.find(binding => binding.id === previousSelection?.id)?.ownerId;
    const selectedNodeId = graph.nodes.find(({ id }) => id === requested)?.id ?? [...visible][0] ?? graph.nodes[0]?.id;
    if (!selectedNodeId) return false;
    if (!previousSelection || selectedNodeId !== requested) this.selection = { type: 'node', id: selectedNodeId };
    const previousViewport = this.canvas?.getViewport() ?? this.viewport;
    this.previousScopedReveal = this.scopedReveal;
    this.aggregateWireId = null; this.aggregateBindingChoices = [];
    this.focusRestoreState = {
      selectedNodeId,
      previousMode: this.displayMode === 'focus' ? 'detailed' : this.displayMode,
      ...(previousSelection ? { previousSelectionType: previousSelection.type, previousSelectionId: previousSelection.id } : {}),
      ...(previousViewport ? { previousViewport } : {})
    };
    this.focusLayoutKey = '';
    this.focusCameraKey = '';
    return true;
  }

  private showBindingConnection(id: TopologyBindingId) {
    const wire = this.evidenceWires.get(id);
    const binding = this.graph().bindings.find((candidate) => candidate.id === id);
    if (!wire || !binding) return;
    this.scopedReveal = { bindingId: binding.id };
    this.render();
    this.centerSelection();
    this.querySelector<HTMLElement>('[data-topology-inspector-content] [data-topology-action="center"]')?.focus({ preventScroll: true });
  }

  private syncCanvasSelection() {
    if (this.aggregateWireId) this.canvas?.selectWire(this.aggregateWireId);
    else if (this.selection?.type === 'binding') this.canvas?.selectWire(this.selection.id);
    else this.canvas?.selectNode(this.selection?.id ?? null);
  }

  private centerSelection() {
    if (!this.canvas || !this.selection) return;
    let nodeIds: string[];
    if (this.selection.type === 'node') nodeIds = [this.selection.id];
    else {
      const wire = this.evidenceWires.get(this.selection.id);
      const owner = this.graph().bindings.find((binding) => binding.id === this.selection?.id)?.ownerId;
      nodeIds = wire ? [...new Set([wire.source.nodeId, wire.target.nodeId])] : owner ? [owner] : [];
    }
    // Frame only rendered cards. If a filter hides a terminal, the inspector
    // can explicitly reveal the wire without silently changing that filter.
    if (!nodeIds.some((id) => this.renderedNodeIds.has(id as TopologyNodeId))) return;
    this.canvas.frameNodes(nodeIds, { padding: 24, maxScale: 1 });
    this.selectionFramed = true;
  }

  private selectionNodeIds(): string[] {
    if (!this.selection) return [];
    if (this.selection.type === 'node') return [this.selection.id];
    const wire = this.evidenceWires.get(this.selection.id);
    const owner = this.graph().bindings.find(binding => binding.id === this.selection?.id)?.ownerId;
    return wire ? [...new Set([wire.source.nodeId, wire.target.nodeId])] : owner ? [owner] : [];
  }

  private fitSelection() {
    const ids = this.selectionNodeIds().filter(id => this.renderedNodeIds.has(id as TopologyNodeId));
    if (!ids.length) return;
    this.selectionFramed = false;
    this.canvas?.frameNodes(ids, { padding: 48, minScale: 0.25, maxScale: 2.5 });
  }

  private fitComponent() {
    if (this.selection?.type === 'node') {
      this.selectionFramed = false;
      this.canvas?.frameConnectedGroup(this.selection.id, { padding: 48, minScale: 0.25, maxScale: 2.5 });
      return;
    }
    this.fitSelection();
  }

  private frameInitialEvidence(projection: TopologyCanvasProjection, evidenceWires: readonly TopologyCanvasWire[], graph: TopologyGraph) {
    if (!this.canvas || this.initialFitDone || this.viewport || this.cameraTouched || this.update?.phase === 'loading') return;
    const visible = new Set(projection.nodes.map(({ id }) => id));
    const adjacency = new Map([...visible].map((id) => [id, new Set<string>()]));
    for (const wire of evidenceWires) {
      if (!visible.has(wire.source.nodeId) || !visible.has(wire.target.nodeId)) continue;
      adjacency.get(wire.source.nodeId)?.add(wire.target.nodeId);
      adjacency.get(wire.target.nodeId)?.add(wire.source.nodeId);
    }
    const visited = new Set<string>();
    const groups: string[][] = [];
    for (const start of [...visible].sort()) {
      if (visited.has(start) || !adjacency.get(start)?.size) continue;
      const queue = [start]; const group: string[] = []; visited.add(start);
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const id = queue[cursor]!; group.push(id);
        for (const neighbor of [...(adjacency.get(id) ?? [])].sort()) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor); queue.push(neighbor);
        }
      }
      groups.push(group);
    }
    groups.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
    const connectedGroup = groups[0];
    if (connectedGroup?.length) {
      const options = { padding: 36, minScale: 0.5, maxScale: 1.25 };
      const connectedIds = new Set(connectedGroup);
      const visibleWireIds = new Set(projection.wires.map(({ id }) => id));
      const hasVisibleRelationship = evidenceWires.some((wire) => connectedIds.has(wire.source.nodeId)
        && connectedIds.has(wire.target.nodeId) && visibleWireIds.has(wire.id));
      if (connectedGroup.length <= 12 && hasVisibleRelationship) {
        this.canvas.frameConnectedGroup(connectedGroup[0]!, options);
      } else {
        this.canvas.frameNodes(connectedGroup.slice(0, 8), options);
      }
      this.initialFitDone = true;
      return;
    }
    if (graph.nodes.length === 0 && graph.completeness.discovery === 'complete'
      && this.update?.coverage === 'complete' && this.update.phase === 'idle') return;
    if (this.update?.phase === 'idle' && this.update.coverage === 'complete'
      && graph.completeness.discovery === 'complete' && projection.nodes.length) {
      this.canvas.frameNodes(projection.nodes.slice(0, 6).map(({ id }) => id), { padding: 72, minScale: 0.5, maxScale: 1.1 });
      this.initialFitDone = true;
    }
  }

  private fitVisible() {
    // The adapter sees only the current projection, so its fit operation cannot
    // move nodes, clear saved positions, or include filtered-out cells.
    this.selectionFramed = false;
    this.canvas?.fitToView();
  }

  private zoomViewport(factor: number) {
    if (!this.canvas) return;
    const host = this.querySelector<HTMLElement>('[data-topology-canvas]');
    if (!host || host.clientWidth <= 0 || host.clientHeight <= 0) return;
    const current = this.canvas.getViewport();
    const scale = Math.max(0.25, Math.min(2.5, current.scale * factor));
    const ratio = scale / current.scale;
    const centerX = host.clientWidth / 2;
    const centerY = host.clientHeight / 2;
    const viewport = {
      x: centerX - (centerX - current.x) * ratio,
      y: centerY - (centerY - current.y) * ratio,
      scale
    };
    this.selectionFramed = false;
    this.canvas.setViewport(viewport);
    this.viewport = viewport;
    this.cameraTouched = true;
    this.initialFitDone = true;
    this.updateZoomReadout(scale);
    this.persistLayout();
  }

  private updateZoomReadout(scale: number) {
    const zoomLevel = this.querySelector<HTMLElement>('.nodel-topology-zoom-level');
    if (zoomLevel) zoomLevel.textContent = `${Math.round(scale * 100)}%`;
  }

  private appendCameraControls(host: HTMLElement) {
    const controls = element('div', 'mt-3 flex flex-wrap gap-2');
    controls.setAttribute('aria-label', 'Canvas navigation');
    controls.append(button('Center selection', 'center'), button('Zoom in', 'zoom-in'), button('Zoom out', 'zoom-out'));
    host.append(controls);
  }
}

if (!customElements.get('nodel-topology')) customElements.define('nodel-topology', NodelTopology);
