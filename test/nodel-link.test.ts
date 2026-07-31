const linkMock = vi.hoisted(() => ({
  getNodeEventBinding: vi.fn(),
  getNodeUrlsForNode: vi.fn()
}));

vi.mock('../src/api/nodel-host-client', () => ({
  getNodeEventBinding: linkMock.getNodeEventBinding,
  getNodeUrlsForNode: linkMock.getNodeUrlsForNode
}));

import '../src/components/nodel-icon';
import '../src/components/nodel-link';
import { flush, waitFor } from './helpers';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function anchor() {
  return document.querySelector<HTMLAnchorElement>('nodel-link [data-nodel-link-anchor]')!;
}

describe('nodel-link', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    linkMock.getNodeEventBinding.mockReset();
    linkMock.getNodeUrlsForNode.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('preserves nested content and behaves as a standard same-tab link', async () => {
    document.body.innerHTML = '<nodel-link href="#Target" aria-label="Open target"><nodel-icon name="info"></nodel-icon><span>Documentation</span></nodel-link>';
    await flush();

    expect(anchor().getAttribute('href')).toBe('#Target');
    expect(anchor().hasAttribute('target')).toBe(false);
    expect(anchor().getAttribute('aria-label')).toBe('Open target');
    expect(anchor().querySelector('nodel-icon')).not.toBeNull();
    expect(anchor().textContent).toContain('Documentation');
    expect(document.querySelector('nodel-link')?.getAttribute('data-state')).toBe('ready');
    anchor().focus();
    expect(document.activeElement).toBe(anchor());
  });

  it('adds safe blank-target rel values while preserving authored rel tokens', async () => {
    document.body.innerHTML = '<nodel-link href="https://example.org/docs" target="_BLANK" rel="external opener">External</nodel-link>';
    await flush();

    expect(anchor().target).toBe('_BLANK');
    expect(new Set(anchor().rel.split(/\s+/))).toEqual(new Set(['external', 'noopener', 'noreferrer']));
  });

  it('rejects unsupported schemes and multiple destination attributes accessibly', async () => {
    document.body.innerHTML = '<nodel-link>No destination</nodel-link>';
    await flush();
    expect(anchor().hasAttribute('href')).toBe(false);
    expect(document.querySelector('[data-nodel-link-status]')?.textContent).toContain('not configured');

    document.body.innerHTML = '<nodel-link href="javascript:alert(1)">Unsafe</nodel-link>';
    await flush();
    expect(anchor().hasAttribute('href')).toBe(false);
    expect(anchor().getAttribute('aria-disabled')).toBe('true');
    expect(anchor().getAttribute('aria-describedby')).toContain('nodel-link-status-');
    expect(document.querySelector('[data-nodel-link-status]')?.textContent).toContain('unsupported URL scheme');

    document.body.innerHTML = '<nodel-link href="/nodes.html" node="Other">Ambiguous</nodel-link>';
    await flush();
    expect(anchor().hasAttribute('href')).toBe(false);
    expect(document.querySelector('[data-nodel-link-status]')?.textContent).toContain('multiple destination');
  });

  it('uses a Unicode-safe Network fallback while resolving and prefers a same-origin address', async () => {
    const pending = deferred<Array<{ address: string }>>();
    linkMock.getNodeUrlsForNode.mockReturnValue(pending.promise);
    document.body.innerHTML = '<nodel-link node="Display Ünit">Open display</nodel-link>';

    expect(anchor().getAttribute('href')).toBe('/nodes.html?filter=Display%20%C3%9Cnit#Network');
    expect(anchor().getAttribute('aria-busy')).toBe('true');
    expect(anchor().getAttribute('aria-disabled')).toBeNull();
    pending.resolve([
      { address: 'https://remote.example/nodes/Display/' },
      { address: `${window.location.origin}/nodes/DisplayUnit/` }
    ]);
    await waitFor(() => document.querySelector('nodel-link')?.getAttribute('data-state') === 'ready');

    expect(anchor().href).toBe(`${window.location.origin}/nodes/DisplayUnit/`);
    expect(linkMock.getNodeUrlsForNode).toHaveBeenCalledWith('Display Ünit', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it.each([
    ['no result', []],
    ['unsafe result', [{ address: 'javascript:alert(1)' }]]
  ])('keeps the Network fallback for %s', async (_label, result) => {
    linkMock.getNodeUrlsForNode.mockResolvedValue(result);
    document.body.innerHTML = '<nodel-link node="Missing Node">Open missing node</nodel-link>';
    await waitFor(() => document.querySelector('nodel-link')?.getAttribute('data-state') === 'error');

    expect(anchor().getAttribute('href')).toBe('/nodes.html?filter=Missing%20Node#Network');
    expect(anchor().getAttribute('aria-disabled')).toBeNull();
    expect(document.querySelector('[data-nodel-link-status]')?.textContent).toContain('Network node search');
  });

  it('keeps the Network fallback when exact discovery fails', async () => {
    linkMock.getNodeUrlsForNode.mockRejectedValue(new TypeError('offline'));
    document.body.innerHTML = '<nodel-link node="Fallback Node">Open fallback</nodel-link>';
    await waitFor(() => document.querySelector('nodel-link')?.getAttribute('data-state') === 'error');

    expect(anchor().getAttribute('href')).toBe('/nodes.html?filter=Fallback%20Node#Network');
    expect(document.querySelector('[data-nodel-link-status]')?.textContent).toContain('Direct address unavailable');
  });

  it('resolves an explicit event binding before resolving its target node', async () => {
    linkMock.getNodeEventBinding.mockResolvedValue({ node: 'Bound Display', event: 'Status' });
    linkMock.getNodeUrlsForNode.mockResolvedValue([{ address: 'https://display.example/nodes/BoundDisplay/' }]);
    document.body.innerHTML = '<nodel-link event-binding="DisplayStatus">Open bound display</nodel-link>';
    await waitFor(() => document.querySelector('nodel-link')?.getAttribute('data-state') === 'ready');

    expect(linkMock.getNodeEventBinding).toHaveBeenCalledWith('DisplayStatus', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(linkMock.getNodeUrlsForNode).toHaveBeenCalledWith('Bound Display', expect.anything());
    expect(anchor().href).toBe('https://display.example/nodes/BoundDisplay/');
  });

  it.each([
    ['no result', []],
    ['malformed result', [null, { address: 17 }]]
  ])('keeps an event-binding Network fallback for %s', async (_label, entries) => {
    linkMock.getNodeEventBinding.mockResolvedValue({ node: 'Bound Display' });
    linkMock.getNodeUrlsForNode.mockResolvedValue(entries);
    document.body.innerHTML = '<nodel-link event-binding="DisplayStatus">Open bound display</nodel-link>';
    await waitFor(() => document.querySelector('nodel-link')?.getAttribute('data-state') === 'error');

    expect(anchor().getAttribute('href')).toBe('/nodes.html?filter=Bound%20Display#Network');
    expect(anchor().getAttribute('aria-disabled')).toBeNull();
  });

  it('keeps an event-binding Network fallback when exact discovery fails', async () => {
    linkMock.getNodeEventBinding.mockResolvedValue({ node: 'Bound Display' });
    linkMock.getNodeUrlsForNode.mockRejectedValue(new TypeError('offline'));
    document.body.innerHTML = '<nodel-link event-binding="DisplayStatus">Open bound display</nodel-link>';
    await waitFor(() => document.querySelector('nodel-link')?.getAttribute('data-state') === 'error');

    expect(anchor().getAttribute('href')).toBe('/nodes.html?filter=Bound%20Display#Network');
  });

  it('accepts relative discovered addresses and preserves backend order for remote addresses', async () => {
    linkMock.getNodeUrlsForNode.mockResolvedValueOnce([{ address: '/nodes/Relative/' }]);
    document.body.innerHTML = '<nodel-link node="Relative">Open</nodel-link>';
    await waitFor(() => document.querySelector('nodel-link')?.getAttribute('data-state') === 'ready');
    expect(anchor().href).toBe(`${window.location.origin}/nodes/Relative/`);

    linkMock.getNodeUrlsForNode.mockResolvedValueOnce([
      { address: 'https://first.example/nodes/Remote/' },
      { address: 'https://second.example/nodes/Remote/' }
    ]);
    document.body.innerHTML = '<nodel-link node="Remote">Open</nodel-link>';
    await waitFor(() => document.querySelector('nodel-link')?.getAttribute('data-state') === 'ready');
    expect(anchor().href).toBe('https://first.example/nodes/Remote/');
  });

  it.each([
    ['missing binding', null, 'was not found'],
    ['missing target node', { node: '' }, 'has no target node']
  ])('reports %s without inferring a parent binding', async (_label, binding, message) => {
    linkMock.getNodeEventBinding.mockResolvedValue(binding);
    document.body.innerHTML = '<nodel-status><nodel-link event-binding="Missing">Open</nodel-link></nodel-status>';
    await waitFor(() => document.querySelector('nodel-link')?.getAttribute('data-state') === 'error');

    expect(anchor().hasAttribute('href')).toBe(false);
    expect(document.querySelector('[data-nodel-link-status]')?.textContent).toContain(message);
    expect(linkMock.getNodeEventBinding).toHaveBeenCalledWith('Missing', expect.anything());
  });

  it('ignores stale destination responses after attributes change', async () => {
    const first = deferred<Array<{ address: string }>>();
    const firstSignal: { value: AbortSignal | null } = { value: null };
    linkMock.getNodeUrlsForNode.mockImplementation((name: string, init?: RequestInit) => {
      if (name === 'First') {
        firstSignal.value = init?.signal ?? null;
        return first.promise;
      }
      return Promise.resolve([{ address: 'https://second.example/nodes/Second/' }]);
    });
    document.body.innerHTML = '<nodel-link node="First">Open</nodel-link>';
    document.querySelector('nodel-link')?.setAttribute('node', 'Second');
    await waitFor(() => anchor().href === 'https://second.example/nodes/Second/');
    expect(firstSignal.value?.aborted).toBe(true);

    first.resolve([{ address: 'https://first.example/nodes/First/' }]);
    await flush();
    expect(anchor().href).toBe('https://second.example/nodes/Second/');
  });

  it('ignores stale event-binding responses after attributes change', async () => {
    const first = deferred<{ node: string }>();
    linkMock.getNodeEventBinding.mockImplementation((alias: string) => alias === 'First' ? first.promise : Promise.resolve({ node: 'Second Node' }));
    linkMock.getNodeUrlsForNode.mockResolvedValue([{ address: 'https://second.example/nodes/Second/' }]);
    document.body.innerHTML = '<nodel-link event-binding="First">Open</nodel-link>';
    document.querySelector('nodel-link')?.setAttribute('event-binding', 'Second');
    await waitFor(() => anchor().href === 'https://second.example/nodes/Second/');

    first.resolve({ node: 'First Node' });
    await flush();
    expect(linkMock.getNodeUrlsForNode).not.toHaveBeenCalledWith('First Node', expect.anything());
    expect(anchor().href).toBe('https://second.example/nodes/Second/');
  });

  it('aborts resolution and ignores completion after disconnect', async () => {
    const pending = deferred<Array<{ address: string }>>();
    const signal: { value: AbortSignal | null } = { value: null };
    linkMock.getNodeUrlsForNode.mockImplementation((_name: string, init?: RequestInit) => {
      signal.value = init?.signal ?? null;
      return pending.promise;
    });
    document.body.innerHTML = '<nodel-link node="Detached">Open</nodel-link>';
    const link = document.querySelector('nodel-link')!;
    link.remove();
    expect(signal.value?.aborted).toBe(true);

    pending.resolve([{ address: 'https://detached.example/' }]);
    await flush();
    expect(link.getAttribute('data-state')).toBe('loading');
  });
});
