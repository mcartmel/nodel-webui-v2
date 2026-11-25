import { afterEach, describe, expect, it, vi } from 'vitest';
import { BINDINGS_PER_PAGE, BindingChooser, bindingChoices } from '../src/experiments/konva-canvas/binding-chooser';
import { CardFootprint, createCardFootprint } from '../src/experiments/konva-canvas/card-footprint';
import { NODE_WIDTH, portPoint, type FixtureEdge, type FixtureNode, type FixturePort } from '../src/experiments/konva-canvas/fixture';

function card(id: string, ports: FixturePort[]): FixtureNode {
  return { id, name: id, x: 0, y: 0, width: NODE_WIDTH, ports, footprint: createCardFootprint(ports, true, 650) };
}

function scene() {
  const publisher = card('Publisher', []);
  // A fully inspected blank owner already has its rail reserved. A later
  // publisher reference is sent straight there without creating a native slot.
  const endpoint = { id: 'published', label: '<script>now</script>', direction: 'out', side: 'right', localKind: 'local-event' } as const;
  publisher.footprint!.append([endpoint]);
  publisher.ports = [endpoint];
  const subscriber = card('Subscriber', Array.from({ length: 10 }, (_, i) => ({ id: `listen-${i}`, label: `Alias ${i}`, direction: 'in', side: 'left', localKind: 'remote-event' })));
  const edges: FixtureEdge[] = subscriber.ports.map(({ id, label }) => ({
    id, ownerId: subscriber.id, bindingKind: 'event', bindingAlias: label,
    from: { nodeId: publisher.id, portId: endpoint.id }, to: { nodeId: subscriber.id, portId: id }
  }));
  const nodes = new Map([[publisher.id, publisher], [subscriber.id, subscriber]]);
  return { publisher, subscriber, edges, nodes };
}

afterEach(() => document.body.replaceChildren());

describe('Konva overflow binding chooser', () => {
  it('lists exact event bindings and their owner even when one local endpoint hosts every wire', () => {
    const { publisher, subscriber, edges, nodes } = scene();
    expect(publisher.footprint!.overflowCount('right')).toBe(1);
    const choices = bindingChoices(publisher, edges, nodes, 'right');
    expect(choices.map(choice => choice.id)).toEqual(edges.map(edge => edge.id));
    expect(choices[0]).toMatchObject({
      id: 'listen-0', kind: 'event',
      from: { nodeName: 'Publisher', endpointName: '<script>now</script>', locality: 'local', owner: false },
      to: { nodeName: 'Subscriber', endpointName: 'Alias 0', locality: 'remote', owner: true }
    });
    expect(choices[0]?.accessibleName).toBe('Event delivery: Publisher, <script>now</script> to Subscriber, Alias 0, Owner');
    expect(bindingChoices(subscriber, edges, nodes)[0]?.accessibleName).toContain('Publisher, <script>now</script> to Subscriber, Alias 0, Owner');
    expect(bindingChoices(publisher, edges, nodes, 'left')).toEqual([]);
    expect(portPoint(publisher, edges[0]!.from.portId)).toEqual(portPoint(publisher, edges[1]!.from.portId));
  });

  it('renders typed safe flow rows with endpoint shapes and owner on the actual owner side', () => {
    const { publisher, edges, nodes } = scene();
    const host = document.createElement('div');
    document.body.append(host);
    const ui = new BindingChooser(host, {
      read: () => ({ name: 'A very long <b>Publisher</b> node', choices: bindingChoices(publisher, edges.slice(0, 1), nodes), overflowBySide: { left: 0, right: 0 }, canExpand: false, canCompact: false }),
      select: () => undefined, restoreFocus: () => undefined, resize: () => ''
    });
    ui.open({ nodeId: publisher.id });
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const button = dialog.querySelector<HTMLButtonElement>('[data-binding-id="listen-0"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe('Connection details');
    expect(dialog.querySelector('.canvas-binding-node-name')?.textContent).toBe('A very long <b>Publisher</b> node');
    const labelledBy = dialog.getAttribute('aria-labelledby')!.split(/\s+/);
    expect(labelledBy).toContain('topology-binding-heading');
    expect(labelledBy).toContain('topology-binding-node-name');
    expect(labelledBy.map(id => dialog.querySelector(`#${id}`)?.textContent).join(' ')).toBe('Connection details A very long <b>Publisher</b> node');
    expect(dialog.querySelector('#topology-binding-count')?.textContent).toBe('ports and bindings · 1 binding');
    expect(button.getAttribute('aria-label')).toBe('Event delivery: Publisher, <script>now</script> to Subscriber, Alias 0, Owner');
    expect(button.textContent).toContain('Event delivery');
    expect(button.querySelectorAll('.canvas-binding-endpoint')).toHaveLength(2);
    expect(button.querySelector('.canvas-binding-symbol-local')?.textContent).toBe('●');
    expect(button.querySelector('.canvas-binding-symbol-remote')?.textContent).toBe('○');
    expect(button.querySelector('.canvas-binding-owner')?.textContent).toBe('Owner');
    expect(button.querySelector('script, b')).toBeNull();
    ui.destroy();
  });

  it('keeps untyped synthetic rows untyped and without inferred locality or ownership', () => {
    const source = card('Synthetic source', [{ id: 'out', label: 'Output', direction: 'out', side: 'right' }]);
    const target = card('Synthetic target', [{ id: 'in', label: 'Input', direction: 'in', side: 'left' }]);
    const edge: FixtureEdge = { id: 'synthetic-wire', from: { nodeId: source.id, portId: 'out' }, to: { nodeId: target.id, portId: 'in' } };
    const choice = bindingChoices(source, [edge], new Map([[source.id, source], [target.id, target]]))[0]!;
    expect(choice.kind).toBeUndefined();
    expect(choice.from).toMatchObject({ endpointName: 'Output', owner: false });
    expect(choice.from.locality).toBeUndefined();
    expect(choice.accessibleName).toBe('Binding: Synthetic source, Output to Synthetic target, Input');
  });

  it('keeps action flow order and attaches ownership to the owner endpoint', () => {
    const owner = card('Room Controller', [{ id: 'alias', label: 'Projector Power', direction: 'out', side: 'right', localKind: 'remote-action' }]);
    const target = card('Projector', [{ id: 'power', label: 'Power On', direction: 'in', side: 'left', localKind: 'local-action' }]);
    const edge: FixtureEdge = {
      id: 'action', ownerId: owner.id, bindingKind: 'action', bindingAlias: 'Projector Power',
      from: { nodeId: owner.id, portId: 'alias' }, to: { nodeId: target.id, portId: 'power' }
    };
    const choice = bindingChoices(owner, [edge], new Map([[owner.id, owner], [target.id, target]]))[0]!;
    expect(choice).toMatchObject({
      kind: 'action',
      from: { nodeName: 'Room Controller', endpointName: 'Projector Power', locality: 'remote', owner: true },
      to: { nodeName: 'Projector', endpointName: 'Power On', locality: 'local', owner: false }
    });
  });

  it('renders a self-loop owner tag only on the remote alias endpoint', () => {
    const node = card('Loop owner', [
      { id: 'alias', label: 'Loop alias', direction: 'out', side: 'right', localKind: 'remote-action' },
      { id: 'endpoint', label: 'Loop endpoint', direction: 'in', side: 'left', localKind: 'local-action' }
    ]);
    const edge: FixtureEdge = {
      id: 'self-loop', ownerId: node.id, bindingKind: 'action', bindingAlias: 'Loop alias', selfLoop: true,
      from: { nodeId: node.id, portId: 'alias' }, to: { nodeId: node.id, portId: 'endpoint' }
    };
    const host = document.createElement('div');
    document.body.append(host);
    const ui = new BindingChooser(host, {
      read: () => ({ name: node.name, choices: bindingChoices(node, [edge], new Map([[node.id, node]])), overflowBySide: { left: 0, right: 0 }, canExpand: false, canCompact: false }),
      select: () => undefined, restoreFocus: () => undefined, resize: () => ''
    });
    ui.open({ nodeId: node.id });
    const button = host.querySelector<HTMLButtonElement>('[data-binding-id="self-loop"]')!;
    expect(button.querySelectorAll('.canvas-binding-owner')).toHaveLength(1);
    expect(button.querySelector('.canvas-binding-endpoint:first-child .canvas-binding-owner')?.textContent).toBe('Owner');
    expect(button.querySelector('.canvas-binding-endpoint:last-child .canvas-binding-owner')).toBeNull();
    ui.destroy();
  });

  it('keeps the focused exact binding visible after insertion while respecting explicit pagination', () => {
    const { publisher, subscriber, edges, nodes } = scene();
    const host = document.createElement('div');
    document.body.append(host);
    let currentEdges: FixtureEdge[] = [...edges];
    const ui = new BindingChooser(host, {
      read: () => ({ name: publisher.name, choices: bindingChoices(publisher, currentEdges, nodes), overflowBySide: { left: 0, right: 0 }, canExpand: false, canCompact: false }),
      select: () => undefined, restoreFocus: () => undefined, resize: () => ''
    });
    ui.open({ nodeId: publisher.id });
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const focused = dialog.querySelector<HTMLButtonElement>('[data-binding-id="listen-7"]')!;
    focused.focus();
    subscriber.ports = [...subscriber.ports, { id: 'new-alias', label: '0 New alias', direction: 'in', side: 'left', localKind: 'remote-event' }];
    currentEdges = [...currentEdges, {
      id: 'new-binding', ownerId: subscriber.id, bindingKind: 'event', bindingAlias: '0 New alias',
      from: { nodeId: publisher.id, portId: publisher.ports[0]!.id }, to: { nodeId: subscriber.id, portId: 'new-alias' }
    }];

    ui.refresh();
    expect(dialog.querySelector('#topology-binding-page')?.textContent).toBe('Page 2 of 2');
    expect((document.activeElement as HTMLElement).dataset.bindingId).toBe('listen-7');

    [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Previous page')!.click();
    expect(dialog.querySelector('#topology-binding-page')?.textContent).toBe('Page 1 of 2');
    expect((document.activeElement as HTMLElement).dataset.bindingId).not.toBe('listen-7');
    ui.destroy();
  });

  it('filters direction and role independently, deduplicating self bindings without merging shared fan-out', () => {
    const { publisher, subscriber, edges, nodes } = scene();
    const source = publisher.ports[0]!;
    const alias = { ...source, id: 'alias', localKind: 'remote-action' } as const;
    const visible = { ...source, id: 'visible' };
    const below = { ...source, id: 'below' };
    const sink = { id: 'sink', label: 'sink', side: 'left', direction: 'in', localKind: 'local-action' } as const;
    publisher.ports = [source, alias, visible, below, sink];
    const footprint = publisher.footprint = new CardFootprint({ left: 0, right: 1 });
    footprint.append(publisher.ports);
    footprint.reveal(visible.id);
    const selfLoop = { ...edges[0]!, id: 'self', from: { nodeId: publisher.id, portId: alias.id }, to: { nodeId: publisher.id, portId: sink.id }, selfLoop: true };
    const next = { ...edges[1]!, id: 'next', from: { nodeId: publisher.id, portId: below.id }, to: { nodeId: subscriber.id, portId: subscriber.ports[1]!.id } };
    const wires = [...edges, selfLoop, next];
    expect(bindingChoices(publisher, wires, nodes, { side: 'right', direction: 'above', role: 'local' }).map(({ id }) => id)).toEqual(edges.map(({ id }) => id));
    expect(bindingChoices(publisher, wires, nodes, { side: 'right', direction: 'above', role: 'alias' }).map(({ id }) => id)).toEqual(['self']);
    expect(bindingChoices(publisher, wires, nodes, { side: 'right', direction: 'below' }).map(({ id }) => id)).toEqual(['next']);
    expect(bindingChoices(publisher, wires, nodes, { side: 'left', direction: 'below' }).map(({ id }) => id)).toEqual(['self']);
    expect(bindingChoices(publisher, wires, nodes).filter(({ id }) => id === 'self')).toHaveLength(1);
  });

  it('supports keyboard scopes and paging, exact activation, focus return and pointer selection', () => {
    const { publisher, edges, nodes } = scene();
    const host = document.createElement('div');
    const cardControl = document.createElement('button');
    document.body.append(cardControl, host);
    const selected = vi.fn();
    const restoreFocus = vi.fn(() => cardControl.focus());
    const ui = new BindingChooser(host, {
      read: ({ side }) => ({
        name: publisher.name, choices: bindingChoices(publisher, edges, nodes, side), ...(side ? { overflowPorts: 1 } : {}),
        overflowBySide: { left: 0, right: 1 }, canExpand: true, canCompact: false
      }), select: selected, restoreFocus, resize: () => 'Not enough room to expand.'
    });
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const button = (label: string) => [...dialog.querySelectorAll('button')].find(button => button.textContent === label)!;
    const key = (target: Element | null, key: string) => target?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    ui.open({ nodeId: publisher.id });
    expect(document.activeElement?.textContent).toBe('Connection details');
    expect(dialog.querySelectorAll('[data-binding-id]')).toHaveLength(BINDINGS_PER_PAGE);
    expect(dialog.querySelector('script')).toBeNull();
    button('Right overflow (+1)').click();
    expect(dialog.textContent).toContain('right overflow · 1 hidden port · 10 bindings');
    key(document.activeElement, 'PageDown');
    expect(dialog.textContent).toContain('Page 2 of 2');
    expect(dialog.querySelectorAll('[data-binding-id]')).toHaveLength(2);
    key(document.activeElement, 'ArrowDown');
    expect((document.activeElement as HTMLElement).dataset.bindingId).toBe('listen-9');
    // The native button provides Enter/Space activation; click is the resulting action.
    (document.activeElement as HTMLButtonElement).click();
    expect(selected).toHaveBeenLastCalledWith({ nodeId: publisher.id, side: 'right' }, 'listen-9');
    expect(dialog.hidden).toBe(true);
    expect(document.activeElement).toBe(cardControl);

    ui.open({ nodeId: publisher.id, side: 'right' });
    button('Expand ports').click();
    expect(dialog.querySelector('[role="status"]')?.textContent).toBe('Not enough room to expand.');
    (dialog.querySelector('[data-binding-id="listen-0"]') as HTMLButtonElement).click();
    expect(selected).toHaveBeenLastCalledWith({ nodeId: publisher.id, side: 'right' }, 'listen-0');
    ui.open({ nodeId: publisher.id });
    key(document.activeElement, 'Escape');
    expect(selected).toHaveBeenCalledTimes(2);
    expect(restoreFocus).toHaveBeenCalledTimes(3);
    expect(dialog.hidden).toBe(true);
    ui.destroy();
  });
});
