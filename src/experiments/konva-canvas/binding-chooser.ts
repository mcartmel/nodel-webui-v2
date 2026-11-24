import type { FixtureEdge, FixtureNode, FixturePort, PortSide } from './fixture';
import type { OverflowDirection, TakeoffRole } from './card-footprint';

export const BINDINGS_PER_PAGE = 8;

export interface BindingChoice { id: string; label: string }
type OverflowScope = { side?: PortSide; direction?: OverflowDirection; role?: TakeoffRole };
export interface ChooserContext extends OverflowScope { nodeId: string }

export function bindingEndpointMatches(card: FixtureNode, endpoint: FixtureEdge['from'], scope: OverflowScope): boolean {
  if (endpoint.nodeId !== card.id) return false;
  if (!scope.side) return true;
  const attachment = card.footprint?.attachment(endpoint.portId);
  return attachment?.side === scope.side && 'role' in attachment &&
    (!scope.direction || scope.direction === attachment.direction) && (!scope.role || scope.role === attachment.role);
}

/** One row per native wire, never per takeoff. Event owner can be the destination. */
export function bindingChoices(
  card: FixtureNode, edges: Iterable<FixtureEdge>, nodes: ReadonlyMap<string, FixtureNode>, filter?: PortSide | OverflowScope
): BindingChoice[] {
  const choices: BindingChoice[] = [];
  const scope = typeof filter === 'string' ? { side: filter } : filter ?? {};
  const portMaps = new Map<string, ReadonlyMap<string, FixturePort>>();
  const port = ({ nodeId, portId }: FixtureEdge['from']) => {
    let ports = portMaps.get(nodeId);
    if (!ports) {
      ports = new Map(nodes.get(nodeId)?.ports.map(item => [item.id, item]));
      portMaps.set(nodeId, ports);
    }
    return ports.get(portId);
  };
  for (const edge of edges) {
    const from = bindingEndpointMatches(card, edge.from, scope);
    const to = bindingEndpointMatches(card, edge.to, scope);
    if (!from && !to) continue;
    const start = port(edge.from);
    const end = port(edge.to);
    const direction = edge.selfLoop ? 'Self connection' : from ? 'Outgoing' : 'Incoming';
    const peer = nodes.get((from ? edge.to : edge.from).nodeId)?.name ?? '';
    const owner = edge.ownerId ? nodes.get(edge.ownerId)?.name : undefined;
    const alias = edge.bindingAlias ?? (edge.bindingKind === 'event' ? end?.label : start?.label);
    const endpoint = edge.bindingKind === 'event' ? start?.label : end?.label;
    const endpointNode = nodes.get((edge.bindingKind === 'event' ? edge.from : edge.to).nodeId)?.name;
    choices.push({ id: edge.id, label: [
      `${direction} ${edge.bindingKind ?? 'binding'}`,
      from && to ? `Ports: ${start?.label ?? ''} → ${end?.label ?? ''}` : `Port: ${(from ? start : end)?.label ?? ''}`,
      alias === undefined ? '' : `Alias: ${alias}${owner ? ` (owner: ${owner})` : ''}`,
      endpoint === undefined ? '' : `Endpoint: ${endpoint}${endpointNode ? ` (${endpointNode})` : ''}`,
      peer ? `Peer: ${peer}` : ''
    ].filter(Boolean).join(' · ') });
  }
  return choices.sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

interface ChooserModel {
  name: string;
  choices: readonly BindingChoice[];
  overflowPorts?: number;
  overflowBySide: Readonly<Record<PortSide, number>>;
  overflowDirections?: Readonly<Record<OverflowDirection, number>>;
  overflowRoles?: Readonly<Record<TakeoffRole, number>>;
  canExpand: boolean;
  canCompact: boolean;
}

interface ChooserActions {
  read(context: ChooserContext): ChooserModel | undefined;
  select(context: ChooserContext, edgeId: string): void;
  resize(context: ChooserContext, mode: 'expand' | 'compact'): string;
  restoreFocus(context: ChooserContext): void;
}

/** One transient nonmodal dialog; paginating never creates an unbounded list of native controls. */
export class BindingChooser {
  private readonly panel = document.createElement('section');
  private readonly heading = document.createElement('h2');
  private readonly status = document.createElement('p');
  private readonly list = document.createElement('ol');
  private readonly scopes = document.createElement('div');
  private readonly all = this.button('All bindings', () => this.scope());
  private readonly left = this.button('Left overflow', () => this.scope('left'));
  private readonly right = this.button('Right overflow', () => this.scope('right'));
  private readonly above = this.button('Above window', () => this.scope(this.context?.side, 'above'));
  private readonly below = this.button('Below window', () => this.scope(this.context?.side, 'below'));
  private readonly aliases = this.button('Remote aliases', () => this.scope(this.context?.side, this.context?.direction, 'alias'));
  private readonly locals = this.button('Local endpoints', () => this.scope(this.context?.side, this.context?.direction, 'local'));
  private readonly pagination = document.createElement('div');
  private readonly pageText = document.createElement('p');
  private readonly feedback = document.createElement('p');
  private readonly previous = this.button('Previous page', () => this.turn(-1));
  private readonly next = this.button('Next page', () => this.turn(1));
  private readonly expand = this.button('Expand ports', () => this.resize('expand'));
  private readonly compact = this.button('Compact ports', () => this.resize('compact'));
  private readonly dismiss = this.button('Close', () => this.close());
  private page = 0;
  private pageCount = 0;
  private context: ChooserContext | undefined;
  private rendered: readonly BindingChoice[] = [];

  constructor(host: HTMLElement, private readonly actions: ChooserActions) {
    this.panel.hidden = true;
    this.panel.className = 'canvas-binding-chooser';
    this.panel.id = 'topology-binding-chooser';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-labelledby', 'topology-binding-heading');
    this.panel.setAttribute('aria-describedby', 'topology-binding-count');
    this.heading.id = 'topology-binding-heading';
    this.heading.tabIndex = -1;
    this.status.id = 'topology-binding-count';
    this.pageText.setAttribute('aria-live', 'polite');
    this.feedback.setAttribute('role', 'status');
    this.scopes.className = 'canvas-binding-actions';
    this.scopes.append(this.all, this.left, this.right, this.above, this.below, this.aliases, this.locals);
    this.pagination.className = 'canvas-binding-actions';
    this.pagination.append(this.previous, this.pageText, this.next);
    const actionsRow = document.createElement('div');
    actionsRow.className = 'canvas-binding-actions';
    actionsRow.append(this.expand, this.compact, this.dismiss);
    this.panel.append(this.heading, this.status, this.scopes, this.list, this.pagination, this.feedback, actionsRow);
    this.panel.addEventListener('keydown', this.keyDown);
    this.panel.addEventListener('focusout', this.focusOut);
    host.append(this.panel);
  }

  private button(label: string, activate: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', activate);
    return button;
  }

  open(context: ChooserContext): void {
    this.context = context;
    this.page = 0;
    this.feedback.textContent = '';
    this.refresh();
    if (!this.context) return;
    this.panel.hidden = false;
    this.heading.focus({ preventScroll: true });
    document.addEventListener('pointerdown', this.outsidePointer);
  }

  refresh(): void {
    if (!this.context) return;
    const model = this.actions.read(this.context);
    if (!model) { this.close(false); return; }
    const { name, choices, overflowPorts, canExpand, canCompact } = model;
    const { side, direction, role } = this.context;
    const scope = side ? `${side} overflow${direction ? ` ${direction}` : ''}${role ? ` · ${role === 'alias' ? 'remote aliases' : 'local endpoints'}` : ''}` : 'ports and bindings';
    this.heading.textContent = `${name} — ${scope}`;
    const count = `${choices.length} ${choices.length === 1 ? 'binding' : 'bindings'}`;
    this.status.textContent = overflowPorts === undefined ? count : `${overflowPorts} hidden ${overflowPorts === 1 ? 'port' : 'ports'} · ${count}`;
    for (const [button, side] of [[this.left, 'left'], [this.right, 'right']] as const) {
      const hidden = model.overflowBySide[side];
      button.hidden = hidden === 0;
      button.textContent = `${side === 'left' ? 'Left' : 'Right'} overflow (+${hidden})`;
      button.setAttribute('aria-label', `${side === 'left' ? 'Left' : 'Right'} overflow: ${hidden} hidden ${hidden === 1 ? 'port' : 'ports'}`);
      button.setAttribute('aria-pressed', String(this.context.side === side && !direction && !role));
    }
    for (const [button, direction] of [[this.above, 'above'], [this.below, 'below']] as const) {
      const hidden = model.overflowDirections?.[direction] ?? 0;
      button.hidden = hidden === 0;
      button.textContent = `${direction === 'above' ? 'Above' : 'Below'} window (+${hidden})`;
      button.setAttribute('aria-pressed', String(this.context.direction === direction && !this.context.role));
    }
    for (const [button, role] of [[this.aliases, 'alias'], [this.locals, 'local']] as const) {
      const hidden = model.overflowRoles?.[role] ?? 0;
      button.hidden = hidden === 0;
      button.textContent = `${role === 'alias' ? 'Remote aliases' : 'Local endpoints'} (+${hidden})`;
      button.setAttribute('aria-pressed', String(this.context.role === role));
    }
    this.scopes.hidden = !this.context.side && !model.overflowBySide.left && !model.overflowBySide.right;
    this.all.setAttribute('aria-pressed', String(this.context.side === undefined));
    this.pageCount = Math.ceil(choices.length / BINDINGS_PER_PAGE);
    this.page = Math.min(this.page, Math.max(0, this.pageCount - 1));
    const start = this.page * BINDINGS_PER_PAGE;
    const page = choices.slice(start, start + BINDINGS_PER_PAGE);
    const active = document.activeElement as HTMLElement | null;
    const focusWire = active?.dataset.bindingId;
    if (page.length !== this.rendered.length || page.some((item, index) => item.id !== this.rendered[index]?.id || item.label !== this.rendered[index]?.label)) {
      this.rendered = page;
      this.list.replaceChildren(...page.map(({ id, label }) => {
        const item = document.createElement('li');
        const button = this.button(label, () => {
          if (!this.context) return;
          this.actions.select(this.context, id);
          this.close();
        });
        button.dataset.bindingId = id;
        item.append(button);
        return item;
      }));
    }
    this.list.start = start + 1;
    this.pagination.hidden = this.pageCount < 2;
    this.previous.disabled = this.page === 0;
    this.next.disabled = this.page + 1 >= this.pageCount;
    const pageLabel = `Page ${this.page + 1} of ${this.pageCount}`;
    if (this.pageCount && this.pageText.textContent !== pageLabel) this.pageText.textContent = pageLabel;
    this.expand.hidden = !canExpand;
    this.compact.hidden = !canCompact;
    if (focusWire && !active?.isConnected) {
      const buttons = [...this.list.querySelectorAll('button')];
      (buttons.find(button => button.dataset.bindingId === focusWire) ?? buttons[0] ?? this.heading).focus({ preventScroll: true });
    } else if ((active === this.expand && !canExpand) || (active === this.compact && !canCompact)) {
      (canExpand ? this.expand : canCompact ? this.compact : this.heading).focus({ preventScroll: true });
    }
  }

  close(restore = true): void {
    if (!this.context) return;
    const context = this.context;
    this.context = undefined;
    this.panel.hidden = true;
    document.removeEventListener('pointerdown', this.outsidePointer);
    if (restore) this.actions.restoreFocus(context);
  }

  destroy(): void { this.close(false); this.panel.remove(); }

  private readonly outsidePointer = (event: PointerEvent) => {
    if (event.target instanceof Node && !this.panel.contains(event.target)) this.close(false);
  };

  private readonly focusOut = (event: FocusEvent) => {
    if (event.relatedTarget instanceof Node && !this.panel.contains(event.relatedTarget)) this.close(false);
  };

  private readonly keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault();
      this.turn(event.key === 'PageDown' ? 1 : -1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const buttons = [...this.list.querySelectorAll('button')];
      if (!buttons.length) return;
      event.preventDefault();
      const index = buttons.findIndex(button => button === document.activeElement);
      const next = index < 0 ? event.key === 'ArrowDown' ? 0 : buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
      buttons[next]?.focus();
    }
  };

  private turn(delta: number): void {
    const next = this.page + delta;
    if (next < 0 || next >= this.pageCount) return;
    this.page = next;
    this.refresh();
    (this.list.querySelector('button') ?? this.heading).focus();
  }

  private scope(side?: PortSide, direction?: OverflowDirection, role?: TakeoffRole): void {
    if (!this.context || this.context.side === side && this.context.direction === direction && this.context.role === role) return;
    this.open({ nodeId: this.context.nodeId, ...(side ? { side } : {}), ...(direction ? { direction } : {}), ...(role ? { role } : {}) });
  }

  private resize(mode: 'expand' | 'compact'): void {
    if (!this.context) return;
    this.feedback.textContent = this.actions.resize(this.context, mode);
    this.refresh();
  }
}
