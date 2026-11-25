// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Konva from 'konva';
import { cardHeight, NODE_WIDTH, type FixtureNode } from '../src/experiments/konva-canvas/fixture';
import { buildLocalGraph, prepareRemoteOwnerInspection } from '../src/experiments/konva-canvas/local-graph';
import { pendingLocalCardReservations, restoreInitialLocalCards, restoreLateLocalCard } from '../src/experiments/konva-canvas/local-placement';
import { localCardId, projectLocalGraph } from '../src/experiments/konva-canvas/local-projection';
import { sessionLayoutStorageKey, type SessionCamera } from '../src/experiments/konva-canvas/session-layout';
import { javaSimpleNameKey } from '../src/experiments/konva-canvas/local-simple-name';
import type { RemoteEnrichmentBatch } from '../src/experiments/konva-canvas/remote-enrichment';
import type { LocalGraph } from '../src/experiments/konva-canvas/local-graph';
import type { LocalSnapshot } from '../src/experiments/konva-canvas/local-snapshot';
import type { TopologyStartupShell } from '../src/experiments/konva-canvas/startup-shell';

vi.mock('konva', async () => ({ default: (await import('konva/lib/index.js')).default }));

const key = () => sessionLayoutStorageKey(window.location.pathname)!;
type Layout = { version: number; camera: SessionCamera; cards: [string, number, number, boolean][] };
const layout = (): Layout => JSON.parse(window.sessionStorage.getItem(key()) ?? 'null') as Layout;
const writeLayout = (data: Pick<Layout, 'camera' | 'cards'>) => window.sessionStorage.setItem(key(), JSON.stringify({ version: 1, ...data }));
const graphFor = (...names: string[]) => buildLocalGraph({ locals: names.map(name => ({ name, readState: 'read' })) });
const idFor = (name: string) => localCardId([...graphFor(name).nodes.keys()][0]!);
const pending = (x: number, y: number, pinned = false) => ({ x, y, pinned });
const card = (id: string, x: number, y: number): FixtureNode => ({ id, name: id, x, y, width: NODE_WIDTH, ports: [] });
const batch = (state: RemoteEnrichmentBatch<LocalGraph>['inventory']['state'], finish?: 'complete', localSnapshot?: LocalSnapshot): RemoteEnrichmentBatch<LocalGraph> => ({
  discoveries: [], results: [], paused: false,
  inventory: { coverage: 'HTTP advertisements only', local: 'known', state, rows: 0, discardedRows: 0, advertised: 0, omittedAdmissions: 0 },
  counts: { total: 0, pending: 0, read: 0, partial: 0, unsuccessful: 0, unreachable: 0, unresolved: 0, invalid: 0, lookupFailed: 0, noRoute: 0 },
  ...(finish ? { finish } : {}), ...(localSnapshot ? { localSnapshot } : {})
});
const addOwner = (name: string) => batch('pending', undefined, { owners: [{ name, key: javaSimpleNameKey(name), status: 'unread', reason: 'unfinished' }] });

describe('session restore placement integration', () => {
  it('reserves unmounted anchors without creating cards, even if nothing in the first batch matches', () => {
    const first = card('new', 500, 500);
    const cards = [first];
    const saved = new Map([['late', pending(500, 500, true)]]);
    const pins = new Set<string>();
    expect(restoreInitialLocalCards(cards, saved, pins)).toBe(true);
    expect(cards).toEqual([first]);
    expect(first).toMatchObject({ x: 500, y: 500 - cardHeight(first) });
    expect(saved.has('late')).toBe(true);
    expect(pins.size).toBe(0);
    const late = card('late', 800, 0);
    restoreLateLocalCard(late, saved.get('late'), cards, pins);
    expect(late).toMatchObject({ x: 500, y: 500 });
    expect(pins).toEqual(new Set(['late']));
  });

  it('preserves intentional late pin overlaps, and moves conflicting autos nearest to their saved coordinates', () => {
    const pinned = card('first', 100, 200);
    const late = card('late', 4_000, 4_000);
    const pins = new Set([pinned.id]);
    restoreLateLocalCard(late, pending(110, 210, true), [pinned], pins);
    expect(late).toMatchObject({ x: 110, y: 210 });
    expect(pins).toEqual(new Set(['first', 'late']));
    const fresh = card('auto', 4_000, 4_000);
    const remaining = new Map([['other-reserved', pending(100, 200 - 2 * cardHeight(pinned), true)]]);
    restoreLateLocalCard(fresh, pending(101, 201), [late, pinned], pins,
      pendingLocalCardReservations(remaining, new Map([['other-reserved', 2 * cardHeight(pinned)]])));
    expect(fresh).toMatchObject({ x: 101, y: 210 + cardHeight(late) });
    expect(pins.has(fresh.id)).toBe(false);
  });

  it('searches side boundaries when they are closer than a vertical fallback', () => {
    const pinned = card('pin', 200, 200);
    const auto = card('auto', 4_000, 1_000);
    const saved = new Map([['pin', pending(200, 200, true)], ['auto', pending(200 + NODE_WIDTH - 1, 225)]]);
    restoreInitialLocalCards([auto, pinned], saved, new Set());
    expect(auto).toMatchObject({ x: 200 + NODE_WIDTH, y: 225 });
  });

  it('reserves a later compatible auto before repairing an earlier incompatible one', () => {
    const cards = ['pin', 'a', 'b'].map(id => card(id, 0, 0));
    restoreInitialLocalCards(cards, new Map([['pin', pending(0, 0, true)], ['a', pending(NODE_WIDTH - 1, 0)],
      ['b', pending(NODE_WIDTH, 0)]]), new Set());
    expect(cards[2]).toMatchObject({ x: NODE_WIDTH, y: 0 });
    expect(cards[1]).not.toMatchObject({ x: NODE_WIDTH, y: 0 });
  });

  it('repairs only mounted automatic cards hit by an unexpectedly larger late pin', () => {
    const old = card('already-auto', 100, 190);
    const active = card('dragging', 100, 185);
    const far = card('unaffected', 3_000, 0);
    const late = { ...card('late', 0, 0), ports: Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`, label: `p${i}`, direction: 'out' as const, side: 'right' as const
    })) };
    const pins = new Set<string>();
    const moved = restoreLateLocalCard(late, pending(100, 85, true), [old, active, far], pins, [], id => id !== active.id);
    expect(late).toMatchObject({ x: 100, y: 85 });
    expect(moved).toEqual(new Map([[old.id, { x: 100, y: 85 + cardHeight(late) }]]));
    expect(old).toMatchObject({ x: 100, y: 190 });
  });
});

describe('live canvas session integration', () => {
  let width: number;
  let height: number;
  let resize: ResizeObserverCallback;
  const resizeTo = (w: number, h: number) => {
    width = w; height = h;
    resize([{ contentRect: new DOMRect(0, 0, w, h) }] as ResizeObserverEntry[], {} as ResizeObserver);
  };
  const hide = () => document.dispatchEvent(new Event('visibilitychange'));
  const click = (view: string) => document.querySelector<HTMLButtonElement>(`[data-view="${view}"]`)!.click();

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    width = 0; height = 0;
    window.history.replaceState(null, '', '/topology-canvas.html?source=local');
    document.body.innerHTML = '<main id="diagram"><p class="canvas-failure"></p><button data-view="zoom-in"></button><button data-view="reset"></button></main>';
    window.sessionStorage.clear();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width, height));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() { /* driven by resizeTo */ }
      disconnect() { /* no native observer */ }
    });
    // Run real Konva scene/event code without rasterising pixels in jsdom.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new Proxy({
      measureText: (text: string) => ({ width: 7 * text.length }),
      getImageData: () => ({ data: new Uint8ClampedArray(128 * 128 * 4) })
    }, { get: (target, prop): unknown => (Reflect.get(target, prop) as unknown) ?? (() => undefined) }) as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(graph: LocalGraph) {
    const { createLocalRenderer } = await import('../src/experiments/konva-canvas/main');
    const Konva = (await import('konva')).default;
    const shell = { generation: 1, releaseReason: 'deadline', on: () => () => {}, update: () => {}, setControls: () => {} } as unknown as TopologyStartupShell;
    const view = await createLocalRenderer(shell);
    expect(view.renderer.mount(graph, () => {})).toBe(true);
    return { view, stage: Konva.stages.at(-1)! };
  }

  it('keeps the prior snapshot during a zero-size flush, then applies an early zoom and saves the first placements', async () => {
    const initial = { camera: { cx: 250, cy: 75, scale: 0.8 }, cards: [[idFor('First'), 40, 40, false]] as Layout['cards'] };
    writeLayout(initial);
    await mount(graphFor('First', 'Second'));
    click('zoom-in');
    hide();
    expect(layout()).toEqual({ version: 1, ...initial });
    resizeTo(900, 700);
    hide();
    expect(layout().camera).toMatchObject({ cx: 250, cy: 75 });
    expect(layout().camera.scale).toBeCloseTo(0.92);
    expect(layout().cards.map(([id]) => id)).toContain(idFor('Second'));
  });

  it('does not supersede a valid snapshot with an empty scene', async () => {
    const initial = { camera: { cx: 250, cy: 75, scale: 0.8 }, cards: [[idFor('First'), 40, 40, false]] as Layout['cards'] };
    writeLayout(initial);
    const { view } = await mount(graphFor());
    resizeTo(900, 700);
    view.progress(graphFor(), batch('complete', 'complete'));
    click('zoom-in');
    hide();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    expect(layout()).toEqual({ version: 1, ...initial });
  });

  it('saves new cards through a hidden flush, retains pending partial IDs, and prunes absent IDs only when settled and authoritative', async () => {
    const missing = idFor('Departed');
    const later = idFor('Later');
    writeLayout({ camera: { cx: 60, cy: 50, scale: 1 }, cards: [[missing, -500, -300, true], [later, 0, 0, true]] });
    const graph = graphFor('First');
    const { view, stage } = await mount(graph);
    resizeTo(900, 700);
    hide();
    const firstPos = stage.findOne(`#${idFor('First')}`)!.position();
    expect(firstPos).not.toEqual({ x: 0, y: 0 });
    expect(stage.findOne(`#${later}`)).toBeUndefined();
    view.progress(graph, batch('complete'));
    view.progress(graph, batch('limited', 'complete'));
    view.renderer.patch(addOwner('Later'));
    hide();
    expect(layout().cards).toContainEqual([missing, -500, -300, true]);
    expect(layout().cards).toContainEqual([later, 0, 0, true]);
    expect(stage.findOne(`#${later}`)!.position()).toEqual({ x: 0, y: 0 });
    expect(stage.findOne(`#${idFor('First')}`)!.position()).toEqual(firstPos);
    for (const incomplete of [buildLocalGraph({ locals: [{ name: 'ambiguous', readState: 'unread', readFailure: 'identity-unresolved' }] }),
      buildLocalGraph({ locals: [{ name: 'Owner', readState: 'read', actions: [{ alias: 'Call', node: 'Unassessed', endpoint: 'Go' }] }] })]) {
      view.progress(incomplete, batch('complete', 'complete'));
      click('zoom-in');
      hide();
      expect(layout().cards).toContainEqual([missing, -500, -300, true]);
    }
    view.progress(graphFor('First', 'Later'), batch('complete', 'complete'));
    hide();
    expect(layout().cards.map(([id]) => id)).not.toContain(missing);
    expect(layout().cards).toContainEqual([later, 0, 0, true]);
  });

  it('retains the live world centre across resize and BFCache and saves Reset at a supported scale', async () => {
    writeLayout({ camera: { cx: 80, cy: 35, scale: 0.8 }, cards: [[idFor('First'), -75_000, 0, true], [idFor('Second'), 75_000, 0, true]] });
    const { stage } = await mount(graphFor('First', 'Second'));
    resizeTo(1200, 800);
    click('zoom-in');
    const { x, y } = stage.position();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    const latest = layout().camera;
    // Mutate stored data while away; the retained stage must win on pageshow.
    writeLayout({ camera: { cx: -500, cy: 400, scale: 1 }, cards: [] });
    width = 800; height = 600;
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(stage.position()).toEqual({ x: x - 200, y: y - 100 });
    expect((400 - stage.x()) / stage.scaleX()).toBeCloseTo(latest.cx);
    expect((300 - stage.y()) / stage.scaleY()).toBeCloseTo(latest.cy);
    click('reset');
    hide();
    const fit = layout().camera;
    expect(fit.scale).toBe(stage.scaleX());
    expect(fit.scale).toBeLessThan(0.04);
    for (const xWorld of [-75_000, 75_000 + NODE_WIDTH]) {
      const screenX = stage.x() + xWorld * fit.scale;
      expect(screenX).toBeGreaterThanOrEqual(0);
      expect(screenX).toBeLessThanOrEqual(width);
      expect((xWorld - fit.cx) * fit.scale + width / 2).toBeCloseTo(screenX);
    }
    expect(layout().cards).toContainEqual([idFor('First'), -75_000, 0, true]);
    expect(layout().cards).toContainEqual([idFor('Second'), 75_000, 0, true]);
  });

  it('coalesces mount, repeated discovery inserts and camera gestures while the pass is active', async () => {
    const graph = graphFor('First');
    const { view } = await mount(graph);
    resizeTo(900, 700);
    const save = vi.spyOn(Storage.prototype, 'setItem');
    for (let index = 0; index < 6; index++) {
      vi.advanceTimersByTime(200);
      view.renderer.patch(addOwner(`New ${index}`));
      click('zoom-in');
    }
    expect(save).toHaveBeenCalledTimes(1);
    hide();
    expect(save).toHaveBeenCalledTimes(2);
    expect(layout().cards).toHaveLength(7);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not enqueue writes during drag or pan frames even when discovery makes the session dirty', async () => {
    const graph = graphFor('First');
    const { stage, view } = await mount(graph);
    resizeTo(900, 700);
    hide();
    const before = layout();
    const card = stage.findOne(`#${idFor('First')}`)!;
    const cardStart = card.position();
    const stageStart = stage.position();
    const save = vi.spyOn(Storage.prototype, 'setItem');
    card.fire('dragstart', { target: card });
    card.position({ x: cardStart.x + 150, y: cardStart.y + 90 });
    card.fire('dragmove', { target: card });
    stage.fire('dragstart', { target: stage });
    stage.position({ x: stageStart.x + 100, y: stageStart.y + 60 });
    stage.fire('dragmove', { target: stage });
    hide();
    expect(save).not.toHaveBeenCalled();
    view.renderer.patch(addOwner('Late card'));
    vi.advanceTimersByTime(1500);
    hide();
    expect(save).not.toHaveBeenCalled();
    expect(layout().camera).toEqual(before.camera);
    expect(layout().cards).toContainEqual([idFor('First'), cardStart.x, cardStart.y, false]);
    card.fire('dragend', { target: card });
    stage.fire('dragend', { target: stage });
    hide();
    expect(layout().camera).not.toEqual(before.camera);
    expect(layout().cards).toContainEqual([idFor('First'), cardStart.x + 150, cardStart.y + 90, true]);
  });

  it('keeps the traced logical port across slot recycling and enrichment, then narrows to one wire', async () => {
    const graph = buildLocalGraph({ locals: [
      { name: 'Gate', readState: 'read' },
      { name: 'Frontend', readState: 'read', events: [
        { alias: 'Preset', node: 'Gate', endpoint: 'Gate1Output' },
        { alias: 'Switch', node: 'Gate', endpoint: 'Gate1Output' },
        ...Array.from({ length: 10 }, (_, index) => ({ alias: `Aux${index}`, node: 'Gate', endpoint: `Unused${index}` }))
      ] },
      { name: 'Later', readState: 'unread' }
    ] });
    const { stage, view } = await mount(graph);
    resizeTo(900, 540);
    stage.position({ x: 0, y: 0 }).scale({ x: 0.5, y: 0.5 });
    const gate = stage.findOne<Konva.Group>(`#${idFor('Gate')}`)!;
    gate.position({ x: 380, y: 200 });
    const status = () => document.querySelector('.canvas-failure')?.textContent;
    const ring = () => gate.find('Circle').find(shape => shape.getAttr('accessibleDescription') === 'Gate1Output')!;
    const slot = ring();
    const point = slot.getAbsolutePosition();
    const rect = gate.findOne<Konva.Rect>('Rect')!;
    // jsdom has no hit canvas raster. Keep the real Stage transform, DOM
    // listener order and Konva click handling, but supply the card hit here.
    vi.spyOn(stage, 'getIntersection').mockImplementation(p => p.x >= point.x - 4 ? rect : null);
    const pointer = (type: string, x = point.x + 2, y = point.y) => stage.container().dispatchEvent(Object.assign(
      new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }),
      { isPrimary: true, pointerId: 1, pointerType: 'touch' }
    ));
    const mouse = new MouseEvent('mouseup', { button: 0 });
    const beforeWires = stage.find('.topology-wire');
    const wireLayer = beforeWires[0]!.getLayer()!;
    const overlay = wireLayer.findOne('.connection-selection-paint')!;
    expect(overlay.isListening()).toBe(false);

    pointer('pointerdown');
    pointer('pointerup');
    rect.fire('tap', { evt: mouse }, true); // compatibility tap must not clear the trace
    expect(slot.getAttr('connectionSelected')).toBe(true);
    expect(status()).toContain('Gate1Output, 2 event connections selected.');
    expect(stage.find('.topology-wire')).toEqual(beforeWires);

    pointer('pointerdown', 0, 0); // new press on the separate page control
    gate.findOne<Konva.Group>('.overflow-rail-right')!.findOne('.overflow-page-hit')!.fire('click', { evt: mouse }, true);
    expect(ring()).toBeUndefined();
    expect(slot.getAttr('connectionSelected')).toBe(false);
    const rail = gate.findOne<Konva.Group>('.overflow-rail-right-above')!;
    expect(rail.findOne('.overflow-takeoff-local')!.getAttr('connectionSelected')).toBe(true);
    expect(status()).toContain('2 event connections selected.');

    const owner = [...graph.nodes.values()].find(node => node.name === 'Later')!;
    view.renderer.patch({ ...batch('pending'), results: [{ owner, lookupState: 'found', source: 'local', issues: [], attempts: [],
      ...prepareRemoteOwnerInspection(owner, { events: { Later: { node: 'Gate', event: 'Gate1Output' } } }) }] });
    expect(status()).toContain('Gate1Output, 3 event connections selected.');
    expect(wireLayer.getChildren().at(-1)).toBe(overlay);
    expect(stage.find('.topology-wire').slice(0, beforeWires.length)).toEqual(beforeWires);

    rail.findOne('.overflow-page-hit')!.fire('click', { evt: mouse }, true);
    expect(ring()).toBe(slot);
    expect(slot.getAttr('connectionSelected')).toBe(true);
    const switchWire = projectLocalGraph(graph).edges.find(edge => edge.bindingAlias === 'Switch')!;
    wireLayer.findOne(`#${switchWire.id}`)!.fire('click', { evt: mouse }, true);
    expect(status()).toContain('Event delivery selected');
    expect(stage.find('Circle').filter(shape => shape.getAttr('connectionSelected'))).toHaveLength(2);
    expect(slot.getAttr('connectionSelected')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(status()).toBe('Connection selection cleared.');
    pointer('pointerdown');
    pointer('pointercancel');
    pointer('pointerup');
    expect(stage.find('Circle').filter(shape => shape.getAttr('connectionSelected'))).toHaveLength(0);

    const key = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
    pointer('pointerdown', 0, 0);
    stage.container().focus();
    for (let i = 0; i < 3 && !stage.container().getAttribute('aria-label')?.startsWith('Gate.'); i++) key('ArrowRight');
    key(']');
    expect(stage.container().getAttribute('aria-label')).toContain('Port: Gate1Output. Space traces this port.');
    expect(key(' ')).toBe(false);
    expect(status()).toContain('Gate1Output, 3 event connections selected.');
  });
});
