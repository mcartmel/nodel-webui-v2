// @vitest-environment jsdom

import { createHash } from 'node:crypto';
import { iconCatalogueIndexUrl, loadIconCatalogue, loadIconRecord, resetIconCatalogueCache, resolveIconArtifactUrl, sha256Hex } from '../src/icons/catalogue-loader';
import { renderGeneratedIcon } from '../src/icons/fontawesome';

function jsonBytes(value: unknown) { return JSON.stringify(value); }
function contentDigest(value: unknown, length: number) { return createHash('sha256').update(jsonBytes(value)).digest('hex').slice(0, length); }

const shard = {
  schemaVersion: 1, profile: 'free', family: 'classic', style: 'solid', bucket: 0,
  records: [
    { name: 'address-book', width: 16, height: 16, unicode: 'f2b9', ligatures: [], paths: ['M1'] },
    { name: 'power-off', width: 16, height: 16, unicode: 'f011', ligatures: [], paths: ['M0'] }
  ]
};
const catalogue = {
  schemaVersion: 1, profile: 'free', records: [
    { name: 'address-book', label: 'Address book', terms: ['address-book'], aliases: [], officialAliases: [], family: 'classic', style: 'solid' },
    { name: 'power-off', label: 'Power off', terms: ['power-off'], aliases: [], officialAliases: [], family: 'classic', style: 'solid' }
  ]
};
const index = {
  schemaVersion: 1,
  profile: 'free',
  packageVersion: '0.1.2',
  sources: [{ package: '@fortawesome/free-solid-svg-icons', version: '7.3.1' }],
  default: { family: 'classic', style: 'solid' },
  aliases: { power: 'power-off' },
  families: [{
    family: 'classic', defaultStyle: 'solid', styles: [{
      style: 'solid',
      sharding: { algorithm: 'fnv1a-32', bucketCount: 1, maxBytes: 131072 },
      shards: [`v2/icons/classic-solid-0-${contentDigest(shard, 12)}.json`]
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
