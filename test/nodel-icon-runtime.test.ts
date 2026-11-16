import { createHash } from 'node:crypto';

import '../src/components/nodel-icon';
import '../src/components/nodel-button';
import '../src/components/nodel-control-grid';
import { resetIconCatalogueCache } from '../src/icons/catalogue-loader';
import { validateIconArtifact, validateIconCatalogue } from '../src/icons/icon-artifact';
import { installControlRuntime } from '../src/data/control-runtime';
import type { NodelActivityLogEntry } from '../src/api/nodel-types';

function jsonBytes(value: unknown) { return JSON.stringify(value); }
function contentDigest(value: unknown, length: number) { return createHash('sha256').update(jsonBytes(value)).digest('hex').slice(0, length); }

const freeDefinitions = [
  ['classic', 'solid', 'solid-icon'],
  ['classic', 'regular', 'regular-icon'],
  ['brands', 'brands', 'brand-icon']
] as const;

function artifactFixture(profile: 'free' | 'pro-local', definitions: ReadonlyArray<readonly [string, string, string]>) {
  const shards = definitions.map(([family, style, name]) => {
    const records = [{ name, width: 16, height: 16, unicode: 'f001', ligatures: [], paths: [style === 'regular' ? 'M3' : 'M0'] }];
    if (family === 'classic' && style === 'solid') records.push({ name: 'power-off', width: 16, height: 16, unicode: 'f011', ligatures: [], paths: ['M1'] });
    records.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    const body = { schemaVersion: 2, profile, family, style, bucket: 0, records };
    const path = `v2/icons/${family}-${style}-0-${contentDigest(body, 12)}.json`;
    return { body, path, family, style };
  });
  const records = shards.map(item => item.body);
  const catalogue = {
    schemaVersion: 2, profile,
    records: shards.flatMap(({ body: { family, style, records } }) => records.map(({ name }) => ({ name, label: name, family, style, terms: [name], aliases: [], officialAliases: [] })))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  };
  const index = {
    schemaVersion: 2, profile, packageVersion: '0.1.2', sources: [
      ...['@fortawesome/fontawesome-free', '@fortawesome/free-brands-svg-icons', '@fortawesome/free-regular-svg-icons', '@fortawesome/free-solid-svg-icons'].map(packageName => ({ library: 'fontawesome', package: packageName, version: '7.3.1' })),
      { library: 'mdi', package: '@mdi/svg', version: '7.4.47' },
      ...(profile === 'pro-local' ? [{ library: 'fontawesome', package: '@fortawesome/fontawesome-pro', version: '7.3.1' }] : [])
    ].sort((left, right) => left.package < right.package ? -1 : left.package > right.package ? 1 : 0),
    default: { family: 'classic', style: 'solid' }, aliases: { power: 'power-off' },
    families: shards.reduce<Array<Record<string, unknown>>>((families, item) => {
      const existing = families.find(candidate => candidate.family === item.family);
      const styleEntry = { style: item.style, sharding: { algorithm: 'fnv1a-32', bucketCount: 1, maxBytes: 131072 }, shards: [item.path] };
      if (existing) (existing.styles as unknown[]).push(styleEntry);
      else families.push({ library: 'fontawesome', family: item.family, defaultStyle: item.style, styles: [styleEntry] });
      return families;
    }, []),
    cataloguePath: `v2/icons/catalogue-${contentDigest(catalogue, 16)}.json`
  };
  const mdiShard = { schemaVersion: 2, profile, family: 'mdi', style: 'default', bucket: 0, records: [
    { name: 'lightbulb-outline', width: 24, height: 24, unicode: 'f0336', ligatures: [], paths: ['M4'] },
    { name: 'power', width: 24, height: 24, unicode: 'f0425', ligatures: [], paths: ['M2'] }
  ] };
  const mdiPath = `v2/icons/mdi-default-0-${contentDigest(mdiShard, 12)}.json`;
  index.families.push({ library: 'mdi', family: 'mdi', defaultStyle: 'default', styles: [{ style: 'default', sharding: { algorithm: 'fnv1a-32', bucketCount: 1, maxBytes: 131072 }, shards: [mdiPath] }] });
  const recordsByPath = new Map<string, unknown>(shards.map(item => [item.path, item.body]));
  recordsByPath.set(mdiPath, mdiShard);
  return { index, records, recordsByPath, catalogue };
}
const freeFixture = artifactFixture('free', freeDefinitions);
const proFixture = artifactFixture('pro-local', [...freeDefinitions, ['ornate', 'display', 'default-icon']]);
let fixture = freeFixture;

function response(body: unknown, status = 200) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return { ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-length': String(bytes.byteLength) }), arrayBuffer: async () => bytes.buffer } as Response;
}

// Let blocked/stale work settle before negative assertions or opening a gate.
// Readiness assertions use vi.waitFor instead of relying on this fixed delay.
const wait = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 20));
};

function installSignalHarness() {
  const listeners: Array<(state: { loading: boolean; connected: boolean; error: string; entries: NodelActivityLogEntry[] }) => void> = [];
  const restore = installControlRuntime({
    callAction: async () => ({}),
    subscribeSignals: (_element, listener) => {
      listeners.push(listener);
      return { dispose: () => { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1); } };
    }
  });
  const emit = (alias: string, arg: unknown) => {
    for (const listener of [...listeners]) listener({
      loading: false, connected: true, error: '',
      entries: [{ source: 'local', type: 'event', alias, arg } as NodelActivityLogEntry]
    });
  };
  return { emit, listeners, restore };
}

describe('nodel-icon runtime catalogue rendering', () => {
  beforeEach(() => {
    fixture = freeFixture;
    document.body.innerHTML = '';
    resetIconCatalogueCache();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.includes('nodel-icons.json')) return response(fixture.index);
      let record = fixture.recordsByPath.get(url.replace(/^.*\//, ''));
      if (!record) {
        for (const [path, value] of fixture.recordsByPath.entries()) {
          if (url.includes(`/${path}`)) {
            record = value;
            break;
          }
        }
      }
      return response(record ?? fixture.records[0]);
    });
  });

  it('uses complete Free declarations and reserves arbitrary families for Pro-local fixtures', () => {
    expect(() => validateIconArtifact(freeFixture.index, 'free')).not.toThrow();
    expect(() => validateIconArtifact(proFixture.index, 'pro-local')).not.toThrow();
    expect(() => validateIconCatalogue(freeFixture.catalogue, 'free', freeFixture.index)).not.toThrow();
    expect(() => validateIconCatalogue(proFixture.catalogue, 'pro-local', proFixture.index)).not.toThrow();
  });

  it('renders Solid, Regular, and Brands records with effective state attributes', async () => {
    document.body.innerHTML = '<nodel-icon name="solid-icon"></nodel-icon><nodel-icon name="regular-icon" family="classic" style="regular"></nodel-icon><nodel-icon name="brand-icon" family="brands"></nodel-icon>';
    await vi.waitFor(() => expect([...document.querySelectorAll<HTMLElement>('nodel-icon')].map(icon => icon.dataset.iconState)).toEqual(['ready', 'ready', 'ready']));
    const icons = [...document.querySelectorAll<HTMLElement>('nodel-icon')];
    expect(icons.map(icon => [icon.dataset.family, icon.dataset.style, icon.dataset.iconState])).toEqual([
      ['classic', 'solid', 'ready'], ['classic', 'regular', 'ready'], ['brands', 'brands', 'ready']
    ]);
    expect(icons[1]?.querySelector('[data-icon="regular-icon"]')).not.toBeNull();
    expect(icons[2]?.querySelector('[data-icon="brand-icon"]')).not.toBeNull();
  });

  it.each([false, true])('resolves curated icons through the manifest default, initially hidden=%s', async (hidden) => {
    fixture = artifactFixture('free', [
      ['classic', 'solid', 'image'], ['classic', 'regular', 'image'], ['brands', 'brands', 'brand-icon']
    ]);
    fixture.index.default.style = 'regular';
    fixture.index.families.find(family => family.family === 'classic')!.defaultStyle = 'regular';
    expect(() => validateIconArtifact(fixture.index, 'free')).not.toThrow();

    document.body.innerHTML = `<nodel-page${hidden ? ' hidden' : ''}><nodel-icon name="image" alt="Picture"></nodel-icon></nodel-page>`;
    const icon = document.querySelector('nodel-icon') as HTMLElement;
    expect(icon.querySelector('[data-icon="image"]')).not.toBeNull();
    expect(icon.dataset.iconState).toBe('loading');
    expect(icon.dataset.style).toBe('');
    if (hidden) {
      await wait();
      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
      document.querySelector('nodel-page')?.removeAttribute('hidden');
    }

    await vi.waitFor(() => expect([icon.dataset.family, icon.dataset.style, icon.dataset.iconState]).toEqual(['classic', 'regular', 'ready']));
    expect(icon.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(icon.querySelector('path')?.getAttribute('d')).toBe('M3');
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('nodel-icons.json'), expect.stringContaining('classic-regular-')
    ]);
  });

  it('keeps the explicit Classic Solid curated fast path synchronous without fetching', async () => {
    fixture = artifactFixture('free', freeDefinitions);
    fixture.index.default.style = 'regular';
    fixture.index.families.find(family => family.family === 'classic')!.defaultStyle = 'regular';
    document.body.innerHTML = '<nodel-page hidden><nodel-icon name="image" style="solid"></nodel-icon></nodel-page>';
    const icon = document.querySelector('nodel-icon') as HTMLElement;
    expect([icon.dataset.style, icon.dataset.iconState]).toEqual(['solid', 'ready']);
    expect(icon.querySelector('[data-icon="image"]')).not.toBeNull();
    document.querySelector('nodel-page')?.removeAttribute('hidden');
    await wait();
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('switches name-only selections between FA and MDI without leaking family attributes', async () => {
    document.body.innerHTML = '<button><nodel-icon name="power" alt="Power" size="lg" tone="accent"></nodel-icon></button>';
    const icon = document.querySelector('nodel-icon') as HTMLElement;
    expect(icon.querySelector('[data-icon="power-off"]')).not.toBeNull();
    icon.setAttribute('name', 'mdi:power');
    expect(icon.dataset.iconState).toBe('loading');
    expect(icon.dataset.name).toBe('mdi:power');
    await vi.waitFor(() => {
      expect([icon.dataset.family, icon.dataset.style, icon.dataset.iconState]).toEqual(['mdi', 'default', 'ready']);
      expect(icon.querySelector('[data-icon="power"]')).not.toBeNull();
    });
    expect(icon.getAttribute('family')).toBeNull();
    expect(icon.getAttribute('style')).toBeNull();
    expect(icon.getAttribute('aria-label')).toBe('Power');
    expect(icon.dataset.size).toBe('lg');
    expect(icon.dataset.tone).toBe('accent');
    icon.setAttribute('name', 'power');
    await vi.waitFor(() => {
      expect([icon.dataset.family, icon.dataset.style, icon.dataset.iconState]).toEqual(['classic', 'solid', 'ready']);
      expect(icon.querySelector('[data-icon="power-off"]')).not.toBeNull();
    });
  });

  it('switches an actual name signal FA → MDI → FA while retaining family and style', async () => {
    const signals = installSignalHarness();
    try {
      document.body.innerHTML = '<nodel-icon name="regular-icon" signal="SelectedIcon" family="classic" style="regular"></nodel-icon>';
      const icon = document.querySelector('nodel-icon') as HTMLElement;
      await vi.waitFor(() => expect(icon.dataset.iconState).toBe('ready'));
      signals.emit('SelectedIcon', 'mdi:power');
      await vi.waitFor(() => expect(icon.querySelector('[data-icon="power"]')).not.toBeNull());
      expect([icon.dataset.family, icon.dataset.style]).toEqual(['mdi', 'default']);
      expect([icon.getAttribute('family'), icon.getAttribute('style')]).toEqual(['classic', 'regular']);
      signals.emit('SelectedIcon', 'regular-icon');
      await vi.waitFor(() => {
        expect(icon.querySelector('[data-icon="regular-icon"]')).not.toBeNull();
        expect([icon.dataset.family, icon.dataset.style, icon.dataset.iconState]).toEqual(['classic', 'regular', 'ready']);
      });
    } finally {
      signals.restore();
    }
  });

  it('recovers a deferred render after a hidden signal update and same-turn page reactivation', async () => {
    const signals = installSignalHarness();
    try {
      document.body.innerHTML = '<nodel-page hidden><nodel-icon name="regular-icon" signal="SelectedIcon"></nodel-icon></nodel-page>';
      const icon = document.querySelector('nodel-icon') as HTMLElement;
      expect(icon.dataset.iconState).toBe('loading');
      await wait();
      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
      signals.emit('SelectedIcon', 'mdi:power');
      document.querySelector('nodel-page')?.removeAttribute('hidden');
      await vi.waitFor(() => {
        expect(icon.querySelector('[data-icon="power"]')).not.toBeNull();
        expect(icon.dataset.iconState).toBe('ready');
      });
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2); // index and one MDI shard, only after reactivation
    } finally {
      signals.restore();
    }
  });

  it.each(['', 'solid'])('recovers an initially visible page hidden, name/alt signalled and shown in the same turn, style=%s', async (style) => {
    const signals = installSignalHarness();
    try {
      document.body.innerHTML = `<nodel-page><nodel-icon name="power"${style ? ` style="${style}"` : ''} alt="Power" signals="Name:name; Desc:alt"></nodel-icon></nodel-page>`;
      const page = document.querySelector('nodel-page') as HTMLElement;
      const icon = document.querySelector('nodel-icon') as HTMLElement;
      await vi.waitFor(() => expect(icon.dataset.iconState).toBe('ready'));
      expect(icon.getAttribute('aria-label')).toBe('Power');
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(style ? 0 : 2);
      vi.mocked(globalThis.fetch).mockClear();

      page.setAttribute('hidden', '');
      signals.emit('Name', 'mdi:power');
      signals.emit('Desc', 'Lighting');
      expect(icon.dataset.iconState).toBe('loading');
      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
      page.removeAttribute('hidden');
      await vi.waitFor(() => expect([icon.dataset.name, icon.dataset.family, icon.dataset.style, icon.dataset.iconState]).toEqual(['mdi:power', 'mdi', 'default', 'ready']));
      expect(icon.querySelector('[data-icon="power"]')).not.toBeNull();
      expect(icon.getAttribute('aria-label')).toBe('Lighting');
      expect(icon.getAttribute('data-nodel-auto-aria-label')).toBe('true');
      const requests = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
      expect(requests).toEqual(style ? [
        expect.stringContaining('nodel-icons.json'), expect.stringContaining('mdi-default-')
      ] : [expect.stringContaining('mdi-default-')]);
    } finally {
      signals.restore();
    }
  });

  it.each([false, true])('defers actual signals under a hidden outer page until activation, same-turn=%s', async (sameTurn) => {
    const signals = installSignalHarness();
    try {
      document.body.innerHTML = '<nodel-page id="outer"><nodel-page id="inner"><nodel-icon name="power" style="solid" alt="Power" signals="Name:name; Desc:alt"></nodel-icon></nodel-page></nodel-page>';
      const outer = document.querySelector('#outer') as HTMLElement;
      const inner = document.querySelector('#inner') as HTMLElement;
      const icon = document.querySelector('nodel-icon') as HTMLElement;
      expect(icon.dataset.iconState).toBe('ready');
      await wait();
      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();

      outer.setAttribute('hidden', '');
      signals.emit('Name', 'mdi:power');
      signals.emit('Desc', 'Lighting');
      expect(inner.hasAttribute('hidden')).toBe(false);
      expect(icon.dataset.iconState).toBe('loading');
      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
      if (!sameTurn) {
        await wait();
        expect(icon.dataset.iconState).toBe('loading');
        expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
      }

      outer.removeAttribute('hidden');
      await vi.waitFor(() => expect([icon.dataset.family, icon.dataset.style, icon.dataset.iconState]).toEqual(['mdi', 'default', 'ready']));
      expect(icon.querySelector('[data-icon="power"]')).not.toBeNull();
      expect(icon.getAttribute('aria-label')).toBe('Lighting');
      expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url))).toEqual([
        expect.stringContaining('nodel-icons.json'), expect.stringContaining('mdi-default-')
      ]);
    } finally {
      signals.restore();
    }
  });

  it('renders MDI variants inside Nodel buttons and control grids', async () => {
    document.body.innerHTML = '<nodel-button><nodel-icon name="mdi:lightbulb-outline"></nodel-icon></nodel-button><nodel-control-grid columns="2"><nodel-icon name="mdi:power"></nodel-icon></nodel-control-grid>';
    const buttonIcon = document.querySelector('nodel-button nodel-icon') as HTMLElement;
    const gridIcon = document.querySelector('nodel-control-grid nodel-icon') as HTMLElement;
    await vi.waitFor(() => {
      expect(buttonIcon.querySelector('[data-icon="lightbulb-outline"]')).not.toBeNull();
      expect(gridIcon.querySelector('[data-icon="power"]')).not.toBeNull();
      expect([buttonIcon.dataset.iconState, gridIcon.dataset.iconState]).toEqual(['ready', 'ready']);
    });
  });

  it.each(['hide', 'disconnect', 'rename'] as const)('restores the latest selection after %s before the import continuation', async (transition) => {
    document.body.innerHTML = '<nodel-page id="outer"><nodel-page><nodel-icon name="mdi:power"></nodel-icon></nodel-page></nodel-page>';
    const outer = document.querySelector('#outer') as HTMLElement;
    const inner = outer.querySelector('nodel-page') as HTMLElement;
    const icon = inner.querySelector('nodel-icon') as HTMLElement;
    if (transition === 'hide') outer.hidden = true;
    else if (transition === 'disconnect') icon.remove();
    else {
      icon.setAttribute('name', 'regular-icon');
      icon.setAttribute('style', 'regular');
    }
    if (transition === 'rename') await vi.waitFor(() => expect(icon.dataset.iconState).toBe('ready'));
    else await wait();
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url))).toEqual(transition === 'rename' ? [
      expect.stringContaining('nodel-icons.json'), expect.stringContaining('classic-regular-')
    ] : []);
    icon.setAttribute('name', 'regular-icon');
    icon.setAttribute('style', 'regular');
    if (transition === 'hide') outer.hidden = false;
    else if (transition === 'disconnect') inner.append(icon);
    await vi.waitFor(() => {
      expect(icon.dataset.iconState).toBe('ready');
      expect(icon.querySelector('[data-icon="regular-icon"]')).not.toBeNull();
    });
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
  });

  it.each(['hide', 'disconnect', 'rename'] as const)('rechecks %s after a delayed index before starting a shard', async (transition) => {
    let release!: (value: Response) => void;
    const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => String(input).includes('nodel-icons.json')
      ? new Promise<Response>(resolve => { release = resolve; }) : original(input, init));
    document.body.innerHTML = '<nodel-page id="outer"><nodel-page><nodel-icon name="mdi:power"></nodel-icon></nodel-page></nodel-page>';
    const outer = document.querySelector('#outer') as HTMLElement;
    const inner = outer.querySelector('nodel-page') as HTMLElement;
    const icon = inner.querySelector('nodel-icon') as HTMLElement;
    await vi.waitFor(() => expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1));
    if (transition === 'hide') outer.hidden = true;
    else if (transition === 'disconnect') icon.remove();
    else icon.setAttribute('name', 'regular-icon');
    if (transition === 'rename') icon.setAttribute('style', 'regular');
    release(response(fixture.index));
    if (transition === 'rename') await vi.waitFor(() => expect(icon.dataset.iconState).toBe('ready'));
    else await wait();
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url))).toEqual(transition === 'rename' ? [
      expect.stringContaining('nodel-icons.json'), expect.stringContaining('classic-regular-')
    ] : [expect.stringContaining('nodel-icons.json')]);
    if (transition !== 'rename') {
      expect(icon.dataset.iconState).toBe('loading');
      // Resume from the shared, validated index with the latest selection.
      icon.setAttribute('name', 'regular-icon');
      icon.setAttribute('style', 'regular');
      if (transition === 'hide') outer.hidden = false;
      else inner.append(icon);
    }
    await vi.waitFor(() => {
      expect(icon.dataset.iconState).toBe('ready');
      expect(icon.querySelector('[data-icon="regular-icon"]')).not.toBeNull();
    });
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
  });

  describe.each(['index', 'shard'] as const)('transient %s response', stage => {
    it.each([
      ['hide', false], ['disconnect', false], ['rename', false],
      ['hide', true], ['disconnect', true], ['rename', true]
    ] as const)('rechecks %s before retrying, active peer=%s', async (transition, activePeer) => {
      let release!: (value: Response) => void;
      let attempts = 0;
      const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
      vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
        const held = stage === 'index' ? String(input).includes('nodel-icons') : String(input).includes('mdi-default');
        if (held && ++attempts === 1) return new Promise<Response>(resolve => { release = resolve; });
        return original(input, init);
      });
      document.body.innerHTML = '<nodel-page id="outer"><nodel-page><nodel-icon id="subject" name="mdi:power"></nodel-icon></nodel-page></nodel-page>';
      const outer = document.querySelector('#outer') as HTMLElement;
      const inner = outer.querySelector('nodel-page') as HTMLElement;
      const icon = document.querySelector('#subject') as HTMLElement;
      await vi.waitFor(() => expect(attempts).toBe(1));
      if (activePeer) {
        const peer = document.createElement('nodel-icon');
        peer.id = 'peer';
        peer.setAttribute('name', 'mdi:power');
        document.body.append(peer);
        await wait();
      }
      if (transition === 'hide') outer.hidden = true;
      else if (transition === 'disconnect') icon.remove();
      else {
        icon.setAttribute('name', 'regular-icon');
        icon.setAttribute('style', 'regular');
        await wait(); // The current generation joins the index, not the old shard.
      }
      release(response({}, 503));
      const retryAllowed = activePeer || (stage === 'index' && transition === 'rename');
      if (retryAllowed) await vi.waitFor(() => expect(attempts).toBe(2));
      else await wait();
      expect(attempts).toBe(retryAllowed ? 2 : 1);
      if (activePeer) await vi.waitFor(() => expect(document.querySelector<HTMLElement>('#peer')?.dataset.iconState).toBe('ready'));
      if (transition === 'hide') outer.hidden = false;
      else if (transition === 'disconnect') inner.append(icon);
      await vi.waitFor(() => {
        expect(icon.dataset.iconState).toBe('ready');
        expect(icon.querySelector(`[data-icon="${transition === 'rename' ? 'regular-icon' : 'power'}"]`)).not.toBeNull();
      });
      expect(attempts).toBe(stage === 'shard' && transition === 'rename' && !activePeer ? 1 : 2);
      expect(vi.mocked(globalThis.fetch).mock.calls.every(([, init]) => !init?.signal)).toBe(true);
    });
  });

  it('reflects known loading defaults and replaces arbitrary-family style after manifest resolution', async () => {
    fixture = proFixture;
    const deferred: Array<(value: Response) => void> = [];
    vi.mocked(globalThis.fetch).mockImplementation(async input => {
      const url = String(input);
      if (url.includes('nodel-icons.json')) return response(fixture.index);
      return new Promise<Response>(resolve => deferred.push(resolve));
    });
    document.body.innerHTML = '<nodel-icon name="brand-icon" family="brands"></nodel-icon><nodel-icon name="default-icon" family="ornate"></nodel-icon>';
    const icons = [...document.querySelectorAll<HTMLElement>('nodel-icon')];
    expect(icons.map(icon => icon.dataset.style)).toEqual(['brands', '']);
    await vi.waitFor(() => expect(deferred).toHaveLength(2));
    deferred[0]?.(response(fixture.records[2]));
    deferred[1]?.(response(fixture.records[3]));
    await vi.waitFor(() => expect(icons.map(icon => icon.dataset.style)).toEqual(['brands', 'display']));
  });

  it('keeps accessibility and image fallback behavior for unavailable records', async () => {
    document.body.innerHTML = '<nodel-icon name="missing" alt="Missing icon"></nodel-icon>';
    const icon = document.querySelector('nodel-icon') as HTMLElement;
    await vi.waitFor(() => expect(icon.dataset.iconState).toBe('fallback'));
    expect(icon.getAttribute('role')).toBe('img');
    expect(icon.getAttribute('aria-label')).toBe('Missing icon');
    expect(icon.querySelector('[data-icon="image"]')).not.toBeNull();
  });

  it('uses accessible fallback for malformed or unknown namespaces without catalogue requests', async () => {
    document.body.innerHTML = '<nodel-icon name="unknown:power" alt="Unknown"></nodel-icon><nodel-icon name="mdi:" label="Empty"></nodel-icon>';
    await wait();
    const icons = [...document.querySelectorAll<HTMLElement>('nodel-icon')];
    expect(icons.map(icon => icon.dataset.iconState)).toEqual(['fallback', 'fallback']);
    expect(icons.map(icon => icon.getAttribute('aria-label'))).toEqual(['Unknown', 'Empty']);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('falls back for well-formed unknown MDI names and rejects unprefixed family=mdi syntax', async () => {
    document.body.innerHTML = '<nodel-icon name="mdi:adidas" alt="Unknown MDI"></nodel-icon><nodel-icon name="power" family="mdi" style="default" alt="Not public syntax"></nodel-icon>';
    const icons = [...document.querySelectorAll<HTMLElement>('nodel-icon')];
    await vi.waitFor(() => expect(icons.map(icon => icon.dataset.iconState)).toEqual(['fallback', 'fallback']));
    expect(icons.map(icon => icon.querySelector('.nodel-icon-glyph [data-icon="image"]') !== null)).toEqual([true, true]);
  });

  it('defers inactive pages and ignores stale and disconnected completions', async () => {
    const deferred: Array<(value: Response) => void> = [];
    vi.mocked(globalThis.fetch).mockImplementation(async input => {
      const url = String(input);
      if (url.includes('nodel-icons.json')) return response(fixture.index);
      return new Promise<Response>(resolve => deferred.push(resolve));
    });
    document.body.innerHTML = '<nodel-page hidden><nodel-icon name="mdi:power" family="brands" style="brands"></nodel-page>';
    const icon = document.querySelector('nodel-icon') as HTMLElement;
    expect(icon.dataset.iconState).toBe('loading');
    await wait();
    expect(deferred).toHaveLength(0);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();

    document.querySelector('nodel-page')?.removeAttribute('hidden');
    await vi.waitFor(() => expect(deferred).toHaveLength(1));
    icon.setAttribute('name', 'brand-icon');
    await vi.waitFor(() => expect(deferred).toHaveLength(2));
    deferred[1]?.(response(fixture.records[2]));
    await vi.waitFor(() => {
      expect(icon.dataset.iconState).toBe('ready');
      expect(icon.querySelector('[data-icon="brand-icon"]')).not.toBeNull();
    });
    deferred[0]?.(response([...fixture.recordsByPath.values()].find(record => (record as { family?: string }).family === 'mdi')));
    await wait();
    expect(icon.dataset.iconState).toBe('ready');
    expect(icon.querySelector('[data-icon="brand-icon"]')).not.toBeNull();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3); // index plus both library shards
  });

  it('ignores a disconnected completion and renders the latest value after reconnect', async () => {
    const deferred: Array<(value: Response) => void> = [];
    vi.mocked(globalThis.fetch).mockImplementation(async input => {
      if (String(input).includes('nodel-icons.json')) return response(fixture.index);
      return new Promise<Response>(resolve => deferred.push(resolve));
    });
    document.body.innerHTML = '<nodel-icon name="mdi:power"></nodel-icon>';
    const icon = document.querySelector('nodel-icon') as HTMLElement;
    await vi.waitFor(() => expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2));
    icon.remove();
    deferred[0]?.(response([...fixture.recordsByPath.values()].find(record => (record as { family?: string }).family === 'mdi')));
    await wait();
    expect(icon.dataset.iconState).toBe('loading');
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2); // index and MDI shard
    document.body.append(icon);
    await vi.waitFor(() => {
      expect(icon.dataset.iconState).toBe('ready');
      expect(icon.querySelector('[data-icon="power"]')).not.toBeNull();
    });
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2); // reconnect uses cached index/shard
  });
});
