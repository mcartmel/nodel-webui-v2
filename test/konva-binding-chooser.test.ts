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
    expect(choices[0]?.label).toContain('Outgoing event · Port: <script>now</script> · Alias: Alias 0 (owner: Subscriber)');
    expect(choices[0]?.label).toContain('Endpoint: <script>now</script> (Publisher) · Peer: Subscriber');
    expect(bindingChoices(subscriber, edges, nodes)[0]?.label).toMatch(/^Incoming event/);
    expect(bindingChoices(publisher, edges, nodes, 'left')).toEqual([]);
    expect(portPoint(publisher, edges[0]!.from.portId)).toEqual(portPoint(publisher, edges[1]!.from.portId));
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
    expect(document.activeElement?.textContent).toBe('Publisher — ports and bindings');
    expect(dialog.querySelectorAll('[data-binding-id]')).toHaveLength(BINDINGS_PER_PAGE);
    expect(dialog.querySelector('script')).toBeNull();
    button('Right overflow (+1)').click();
    expect(dialog.textContent).toContain('1 hidden port · 10 bindings');
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
