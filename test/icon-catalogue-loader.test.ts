// @vitest-environment jsdom

import { createHash } from 'node:crypto';
import { iconCatalogueIndexUrl, loadIconCatalogue, loadIconIndex, loadIconRecord, resetIconCatalogueCache, resolveIconArtifactUrl, resolveIconSelection, sha256Hex } from '../src/icons/catalogue-loader';
import { renderGeneratedIcon } from '../src/icons/fontawesome';
import { validateIconArtifact, validateIconCatalogue } from '../src/icons/icon-artifact';

function jsonBytes(value: unknown) { return JSON.stringify(value); }
function contentDigest(value: unknown, length: number) { return createHash('sha256').update(jsonBytes(value)).digest('hex').slice(0, length); }

const shard = {
  schemaVersion: 2, profile: 'free', family: 'classic', style: 'solid', bucket: 0,
  records: [
    { name: 'address-book', width: 16, height: 16, unicode: 'f2b9', ligatures: [], paths: ['M1'] },
    { name: 'power-off', width: 16, height: 16, unicode: 'f011', ligatures: [], paths: ['M0'] }
  ]
};
const catalogue = {
  schemaVersion: 2, profile: 'free', records: [
    { name: 'address-book', label: 'Address book', terms: ['address-book'], aliases: [], officialAliases: [], family: 'classic', style: 'solid' },
    { name: 'power-off', label: 'Power off', terms: ['power-off'], aliases: [], officialAliases: [], family: 'classic', style: 'solid' }
  ]
};
function emptyStyle(family: string, style: string) {
  const shard = {
    schemaVersion: 2, profile: 'free', family, style, bucket: 0,
    records: family === 'classic' && style === 'regular'
      ? [{ name: 'regular-default', width: 16, height: 16, unicode: 'f002', ligatures: [], paths: ['M3'] }]
      : []
  };
  return { style, sharding: { algorithm: 'fnv1a-32', bucketCount: 1, maxBytes: 131072 }, shards: [`v2/icons/${family}-${style}-0-${contentDigest(shard, 12)}.json`] };
}
const mdiShard = {
  schemaVersion: 2, profile: 'free', family: 'mdi', style: 'default', bucket: 0,
  records: [{ name: 'power', width: 24, height: 24, unicode: 'f0425', ligatures: [], paths: ['M2'] }]
};
const index = {
  schemaVersion: 2,
  profile: 'free',
  packageVersion: '0.1.2',
  sources: [
    ...['@fortawesome/fontawesome-free', '@fortawesome/free-brands-svg-icons', '@fortawesome/free-regular-svg-icons', '@fortawesome/free-solid-svg-icons'].map(packageName => ({ library: 'fontawesome', package: packageName, version: '7.3.1' })),
    { library: 'mdi', package: '@mdi/svg', version: '7.4.47' }
  ],
  default: { family: 'classic', style: 'solid' },
  aliases: { power: 'power-off' },
  families: [{
    library: 'fontawesome', family: 'classic', defaultStyle: 'solid', styles: [{
      style: 'solid',
      sharding: { algorithm: 'fnv1a-32', bucketCount: 1, maxBytes: 131072 },
      shards: [`v2/icons/classic-solid-0-${contentDigest(shard, 12)}.json`]
    }, emptyStyle('classic', 'regular')]
  }, {
    library: 'fontawesome', family: 'brands', defaultStyle: 'brands', styles: [emptyStyle('brands', 'brands')]
  }, {
    library: 'mdi', family: 'mdi', defaultStyle: 'default', styles: [{
      style: 'default', sharding: { algorithm: 'fnv1a-32', bucketCount: 1, maxBytes: 131072 },
      shards: [`v2/icons/mdi-default-0-${contentDigest(mdiShard, 12)}.json`]
    }]
  }],
  cataloguePath: `v2/icons/catalogue-${contentDigest(catalogue, 16)}.json`
};

function response(body: unknown, status = 200) {
  const bytes = new TextEncoder().encode(jsonBytes(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-length': String(bytes.byteLength) }),
    arrayBuffer: async () => bytes.buffer
  } as Response;
}

describe('icon catalogue runtime loader', () => {
  beforeEach(() => {
    resetIconCatalogueCache();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses a complete schema-valid Free index and catalogue fixture', () => {
    expect(() => validateIconArtifact(index, 'free')).not.toThrow();
    expect(() => validateIconCatalogue(catalogue, 'free', index)).not.toThrow();
  });

  it('resolves root-relative manifest paths beside the deployment root', () => {
    const indexUrl = new URL(iconCatalogueIndexUrl());
    const artifactUrl = new URL(resolveIconArtifactUrl('v2/icons/classic-solid-0-aaaaaaaaaaaa.json'));
    expect(artifactUrl.origin).toBe(indexUrl.origin);
    expect(artifactUrl.pathname).toBe(new URL('../v2/icons/classic-solid-0-aaaaaaaaaaaa.json', indexUrl).pathname);
    expect(artifactUrl.pathname).not.toContain('/v2/v2/');
  });

  it('deduplicates index and shard requests and resolves Nodel aliases', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      return response(String(input).includes('nodel-icons') ? index : shard);
    });

    const records = await Promise.all([
      loadIconRecord('power'),
      loadIconRecord('power', 'classic', 'solid')
    ]);

    expect(records[0]?.name).toBe('power-off');
    expect(records[1]?.name).toBe('power-off');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not start an index request for an ineligible consumer or cache its null', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => response(String(input).includes('nodel-icons') ? index : mdiShard));
    await expect(loadIconRecord('mdi:power', undefined, undefined, () => false)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(loadIconRecord('mdi:power')).resolves.toMatchObject({ name: 'power' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not publish an index request abandoned at its initial eligibility check', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(index));
    const abandoned = loadIconIndex(() => false);
    const fresh = loadIconIndex();
    await expect(abandoned).rejects.toThrow('no eligible consumers');
    await expect(fresh).resolves.toEqual(index);
    await expect(loadIconIndex()).resolves.toEqual(index);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not detach a replacement when a reset request later abandons its retry', async () => {
    let eligible = true;
    let releaseOld!: (value: Response) => void;
    let releaseNew!: (value: Response) => void;
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise<Response>(resolve => { releaseOld = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { releaseNew = resolve; }))
      .mockResolvedValue(response(index));
    const old = loadIconIndex(() => eligible);
    resetIconCatalogueCache();
    const fresh = loadIconIndex();
    eligible = false;
    releaseOld(response({}, 503));
    await expect(old).rejects.toThrow('no eligible consumers');
    expect(loadIconIndex()).toBe(fresh);
    releaseNew(response({}, 503));
    await expect(fresh).resolves.toEqual(index);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])('rechecks each consumer after a shared delayed index, active peer=%s', async (activePeer) => {
    let release!: (value: Response) => void;
    let eligible = true;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).includes('nodel-icons')
      ? new Promise<Response>(resolve => { release = resolve; }) : response(mdiShard));
    const obsolete = loadIconRecord('mdi:power', undefined, undefined, () => eligible);
    const peer = activePeer ? loadIconRecord('mdi:power') : null;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    eligible = false;
    release(response(index));
    await expect(obsolete).resolves.toBeNull();
    if (peer) await expect(peer).resolves.toMatchObject({ name: 'power' });
    expect(fetchMock).toHaveBeenCalledTimes(activePeer ? 2 : 1);

    // The cancelled lookup did not poison the shared index or shard cache.
    eligible = true;
    await expect(loadIconRecord('mdi:power', undefined, undefined, () => eligible)).resolves.toMatchObject({ name: 'power' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not abort a shared shard when one consumer becomes ineligible', async () => {
    let release!: (value: Response) => void;
    let eligible = true;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).includes('nodel-icons')
      ? response(index) : new Promise<Response>(resolve => { release = resolve; }));
    const obsolete = loadIconRecord('mdi:power', undefined, undefined, () => eligible);
    const peer = loadIconRecord('mdi:power');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    eligible = false;
    release(response(mdiShard));
    // The callback gates request stages, not ownership of an existing request.
    await expect(obsolete).resolves.toMatchObject({ name: 'power' });
    await expect(peer).resolves.toMatchObject({ name: 'power' });
    await expect(loadIconRecord('mdi:power')).resolves.toMatchObject({ name: 'power' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => !init?.signal)).toBe(true);
  });

  describe.each(['index', 'shard'] as const)('%s retry ownership', stage => {
    it('detaches cancellation before a fresh consumer joins the pending rejection', async () => {
      let eligible = true;
      let releaseOld!: (value: Response) => void;
      let releaseNew!: (value: Response) => void;
      let attempts = 0;
      let fresh!: Promise<unknown>;
      let joined!: () => void;
      const joining = new Promise<void>(resolve => { joined = resolve; });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
        const held = stage === 'index' ? String(input).includes('nodel-icons') : String(input).includes('mdi-default');
        if (held) {
          attempts += 1;
          if (attempts === 1) return new Promise<Response>(resolve => { releaseOld = resolve; });
          if (attempts === 2) return new Promise<Response>(resolve => { releaseNew = resolve; });
        }
        return response(String(input).includes('nodel-icons') ? index : mdiShard);
      });
      const guard = vi.fn(() => {
        if (!eligible) {
          // Queue from the retry's eligibility decision: this runs before the
          // rejected fetchJson promise propagates to cached's settlement handler.
          queueMicrotask(() => {
            fresh = loadIconRecord('mdi:power');
            void fresh.catch(() => {});
            joined();
          });
        }
        return eligible;
      });
      const obsolete = loadIconRecord('mdi:power', undefined, undefined, guard);
      const rejected = expect(obsolete).rejects.toThrow('no eligible consumers');
      await vi.waitFor(() => expect(attempts).toBe(1));
      eligible = false;
      releaseOld(response({}, 503));
      await joining;
      await rejected;
      await vi.waitFor(() => expect(attempts).toBe(2));
      // Old settlement must not evict the still-pending replacement, nor clear
      // its consumer set: a late peer shares its request and its one retry.
      const peer = loadIconRecord('mdi:power');
      releaseNew(response({}, 503));
      await expect(fresh).resolves.toMatchObject({ name: 'power' });
      await expect(peer).resolves.toMatchObject({ name: 'power' });
      expect(attempts).toBe(3);
      const guardCalls = guard.mock.calls.length;
      await expect(loadIconRecord('mdi:power')).resolves.toMatchObject({ name: 'power' });
      expect(guard).toHaveBeenCalledTimes(guardCalls);
      expect(fetchMock).toHaveBeenCalledTimes(4); // three held-stage requests, one other stage
    });

    it.each(['none', 'guarded', 'direct', 'editor'] as const)('retries only for eligible attached consumers, peer=%s', async peerKind => {
      let eligible = true;
      const guard = vi.fn(() => eligible);
      let release!: (value: Response) => void;
      let attempts = 0;
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
        const url = String(input);
        const held = stage === 'index' ? url.includes('nodel-icons') : url.includes('mdi-default');
        if (held && ++attempts === 1) return new Promise<Response>(resolve => { release = resolve; });
        return response(url.includes('nodel-icons') ? index : url.includes('catalogue-') ? catalogue : mdiShard);
      });
      const obsolete = loadIconRecord('mdi:power', undefined, undefined, guard);
      const selection = resolveIconSelection('mdi:power', undefined, undefined, guard);
      await vi.waitFor(() => expect(attempts).toBe(1));
      const peer = peerKind === 'none' ? null : peerKind === 'guarded'
        ? loadIconRecord('mdi:power', undefined, undefined, () => true)
        : peerKind === 'editor' && stage === 'index' ? loadIconCatalogue()
        : peerKind === 'direct' && stage === 'index' ? loadIconIndex()
        : loadIconRecord('mdi:power');
      const settled = Promise.allSettled([obsolete, selection, ...(peer ? [peer] : [])]);
      eligible = false;
      release(response({}, 503));
      const results = await settled;
      expect(attempts).toBe(peer ? 2 : 1);
      if (!peer) expect(results[0]).toMatchObject({ status: 'rejected', reason: { message: expect.stringContaining('no eligible consumers') } });
      else expect(results[2]?.status).toBe('fulfilled');
      // Cancellation evicts the failure, but never discards successful shared
      // data. A later visible consumer can retry or reuse it normally.
      eligible = true;
      await expect(loadIconRecord('mdi:power', undefined, undefined, guard)).resolves.toMatchObject({ name: 'power' });
      expect(attempts).toBe(2);
      const guardCalls = guard.mock.calls.length;
      await expect(loadIconRecord('mdi:power')).resolves.toMatchObject({ name: 'power' });
      expect(guard).toHaveBeenCalledTimes(guardCalls);
      expect(fetchMock.mock.calls.every(([, init]) => !init?.signal)).toBe(true);
    });

    it('retains the one-retry bound for active consumers', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input =>
        stage === 'shard' && String(input).includes('nodel-icons') ? response(index) : response({}, 503));
      await expect(loadIconRecord('mdi:power')).rejects.toThrow(/503/);
      expect(fetchMock).toHaveBeenCalledTimes(stage === 'index' ? 2 : 3);
    });
  });

  it('keeps MDI names and lookups namespaced, despite colliding FA aliases', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const path = String(input);
      return response(path.includes('nodel-icons') ? index : path.includes('mdi-default') ? mdiShard : shard);
    });
    await expect(loadIconRecord('power')).resolves.toMatchObject({ name: 'power-off' });
    await expect(loadIconRecord(' mdi:power ', 'brands', 'brands')).resolves.toMatchObject({ name: 'power' });
    await expect(loadIconRecord('mdi:power-off')).resolves.toBeNull();
    await expect(loadIconRecord('unknown:power')).resolves.toBeNull();
    await expect(loadIconRecord('mdi:')).resolves.toBeNull();
    await expect(loadIconRecord('power', 'mdi', 'default')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3); // shared index, FA shard, MDI shard
  });

  it('uses a non-Solid classic manifest default when the author omits style', async () => {
    const regularDefaultIndex = {
      ...index,
      default: { family: 'classic', style: 'regular' },
      families: index.families.map(family => family.family === 'classic' ? { ...family, defaultStyle: 'regular' } : family)
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const path = String(input);
      return response(path.includes('nodel-icons') ? regularDefaultIndex : path.includes('classic-regular') ? JSON.parse(jsonBytes({
        schemaVersion: 2, profile: 'free', family: 'classic', style: 'regular', bucket: 0,
        records: [{ name: 'regular-default', width: 16, height: 16, unicode: 'f002', ligatures: [], paths: ['M3'] }]
      })) : shard);
    });
    await expect(loadIconRecord('regular-default', 'classic')).resolves.toMatchObject({ name: 'regular-default' });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([expect.stringContaining('classic-regular')]));
  });

  it('resolves a curated image name to the declared Regular default with no searchable catalogue request', async () => {
    const regularShard = {
      schemaVersion: 2, profile: 'free', family: 'classic', style: 'regular', bucket: 0,
      records: [{ name: 'image', width: 16, height: 16, unicode: 'f03e', ligatures: [], paths: ['M3'] }]
    };
    const regularPath = `v2/icons/classic-regular-0-${contentDigest(regularShard, 12)}.json`;
    const regularDefaultIndex = {
      ...index,
      default: { family: 'classic', style: 'regular' },
      families: index.families.map(family => family.family === 'classic' ? {
        ...family, defaultStyle: 'regular',
        styles: family.styles.map(style => style.style === 'regular' ? { ...style, shards: [regularPath] } : style)
      } : family)
    };
    expect(() => validateIconArtifact(regularDefaultIndex, 'free')).not.toThrow();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => response(String(input).includes('nodel-icons') ? regularDefaultIndex : regularShard));

    await expect(resolveIconSelection('image', 'classic')).resolves.toEqual({ family: 'classic', style: 'regular' });
    await expect(loadIconRecord('image', 'classic')).resolves.toMatchObject({ name: 'image', paths: ['M3'] });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('nodel-icons.json'), expect.stringContaining(regularPath)
    ]);
  });

  it('selects colliding names from one cached shard, including concurrent lookups', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => response(String(input).includes('nodel-icons') ? index : shard));
    const records = await Promise.all([loadIconRecord('address-book'), loadIconRecord('power-off')]);
    expect(records.map(record => record?.name)).toEqual(['address-book', 'power-off']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps SHA-256 verification available without Web Crypto', async () => {
    vi.stubGlobal('crypto', {});
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => response(String(input).includes('nodel-icons') ? index : shard));
    await expect(loadIconRecord('address-book')).resolves.toMatchObject({ name: 'address-book' });
    vi.unstubAllGlobals();
  });

  it('retries transient failures but retains malformed artifacts in the cache', async () => {
    const transientFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response(index))
      .mockResolvedValueOnce(response(shard));
    await expect(loadIconRecord('power')).resolves.toMatchObject({ name: 'power-off' });
    expect(transientFetch).toHaveBeenCalledTimes(3);

    resetIconCatalogueCache();
    vi.restoreAllMocks();
    const malformedFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ bad: true }));
    await expect(loadIconRecord('power')).rejects.toThrow(/schema|shape/);
    await expect(loadIconRecord('power')).rejects.toThrow(/schema|shape/);
    expect(malformedFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects catalogue and shard bytes that do not match declared content hashes', async () => {
    const tamperedShard = { ...shard, records: [{ ...shard.records[0]!, paths: ['M1'] }] };
    const shardFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => response(String(input).includes('nodel-icons') ? index : tamperedShard));
    await expect(loadIconRecord('power')).rejects.toThrow(/content hash/);
    await expect(loadIconRecord('power')).rejects.toThrow(/content hash/);
    expect(shardFetch).toHaveBeenCalledTimes(2);

    resetIconCatalogueCache();
    vi.restoreAllMocks();
    const tamperedCatalogue = { ...catalogue, records: [{ ...catalogue.records[0]!, label: 'Tampered' }] };
    const catalogueFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      return response(path.includes('nodel-icons') ? index : tamperedCatalogue);
    });
    await expect(loadIconCatalogue()).rejects.toThrow(/content hash/);
    await expect(loadIconCatalogue()).rejects.toThrow(/content hash/);
    expect(catalogueFetch).toHaveBeenCalledTimes(2);
  });

  it('rejects oversized declared and actual bodies before parsing', async () => {
    const oversized = JSON.stringify(index);
    const declared = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-length': String(256 * 1024 + 1) }),
      arrayBuffer: async () => new TextEncoder().encode(oversized).buffer
    } as Response);
    await expect(loadIconRecord('power')).rejects.toThrow(/byte limit/);
    expect(declared).toHaveBeenCalledTimes(1);

    resetIconCatalogueCache();
    vi.restoreAllMocks();
    const actual = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, headers: new Headers(),
      arrayBuffer: async () => new Uint8Array(256 * 1024 + 1).buffer
    } as Response);
    await expect(loadIconRecord('power')).rejects.toThrow(/byte limit/);
    expect(actual).toHaveBeenCalledTimes(1);
  });

  it('escapes generated path data and applies secondary opacity in documented order', () => {
    const markup = renderGeneratedIcon({ name: 'x"', width: 16, height: 16, paths: ['M0" onload="bad', 'M1'] }, 'x"');
    expect(markup).toContain('data-icon="x&quot;"');
    expect(markup).toContain('class="x&quot;"');
    expect(markup).toContain('opacity="0.4" d="M0&quot; onload=&quot;bad"');
    expect(markup.indexOf('M0')).toBeLessThan(markup.indexOf('M1'));
  });
});
