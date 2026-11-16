// @vitest-environment node

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import freeFixture from './fixtures/icon-free-adapter.json';
import proFixture from './fixtures/icon-pro-adapter.json';
import { generateFreeIconAssets } from '../scripts/generate-icon-assets.mjs';
import { fnv1a32 as nodeFNV, generateIconArtifacts, maxIconIndexBytes, normalizeIconRecord, validateIconArtifact, validateIconArtifactFiles, validateIconCatalogue, validateIconShard } from '../scripts/icon-artifact.mjs';
import { fnv1a32, MAX_ICON_INDEX_BYTES, validateIconArtifact as validateRuntimeArtifact, validateIconCatalogue as validateRuntimeCatalogue, validateIconShard as validateRuntimeShard } from '../src/icons/icon-artifact';

type Fixture = { packageVersion: string; profile: 'free' | 'pro-local'; sources: Array<{ library: string; package: string; version: string }>; aliases: Record<string, string>; families: Array<{ library: string; family: string; defaultStyle: string; styles: Array<{ style: string; icons: Array<Record<string, unknown>> }> }> };
const free = freeFixture as Fixture;
const pro = proFixture as Fixture;
const withSolidIcons = (icons: Array<Record<string, unknown>>) => ({
  ...free, aliases: {},
  families: free.families.map(family => family.family === 'classic' ? { ...family, styles: family.styles.map(style => style.style === 'solid' ? { ...style, icons } : style) } : family)
});

describe('icon artifact generator', () => {
  it('keeps library versions independent and agrees with the browser on source ownership', () => {
    const artifact = generateIconArtifacts({ ...free, sources: free.sources.map(source => source.library === 'fontawesome' ? { ...source, version: '6.9.0' } : source) });
    expect(() => validateIconArtifact(artifact.index)).not.toThrow();
    expect(() => validateRuntimeArtifact(artifact.index)).not.toThrow();
    const index = artifact.index;
    const families = index.families as Array<Record<string, unknown>>;
    const sources = index.sources as Array<Record<string, unknown>>;
    const malformed = [
      { ...index, schemaVersion: 1 },
      { ...index, sources: sources.filter(source => source.library !== 'mdi') },
      { ...index, sources: sources.map(source => source.library === 'mdi' ? { ...source, library: 'fontawesome' } : source) },
      { ...index, sources: sources.map(source => source.package === '@mdi/svg' ? { ...source, package: '@mdi/private-svg' } : source) },
      { ...index, sources: sources.map(source => source.package === '@fortawesome/fontawesome-free' ? { ...source, library: 'mdi' } : source) },
      { ...index, sources: sources.map(source => source.package === '@fortawesome/fontawesome-free' ? { ...source, package: '@fortawesome/fontawesome-pro' } : source) },
      { ...index, families: families.map(family => family.family === 'mdi' ? { ...family, library: 'fontawesome' } : family) },
      { ...index, families: families.map(family => family.family === 'classic' ? { ...family, library: 'mdi' } : family) },
      { ...index, families: families.map(family => family.family === 'mdi' ? { ...family, family: 'another-mdi' } : family) },
      { ...index, families: families.map(family => family.family === 'mdi' ? { ...family, defaultStyle: 'solid' } : family) },
      { ...index, families: families.map(family => family.family === 'mdi' ? { ...family, styles: [] } : family) },
      { ...index, families: [...families, families[0]] },
      { ...index, default: { family: 'mdi', style: 'default' } },
      { ...index, cataloguePath: 'https://outside.invalid/icons.json' }
    ];
    for (const value of malformed) {
      expect(() => validateIconArtifact(value)).toThrow();
      expect(() => validateRuntimeArtifact(value)).toThrow();
    }
    expect(() => generateIconArtifacts({ ...free, sources: free.sources.map(source => source.library === 'mdi' ? { ...source, version: '8.0.0' } : source) })).toThrow(/source\/version/);
  });

  it('normalizes MDI independently of FA tuples and preserves profile glyph parity', () => {
    const publicArtifact = generateIconArtifacts(free);
    const privateArtifact = generateIconArtifacts(pro);
    const shard = (artifact: ReturnType<typeof generateIconArtifacts>) => {
      const path = [...artifact.files.keys()].find(path => path.includes('/mdi-default-'))!;
      return { path, body: JSON.parse(artifact.files.get(path)!.toString()) };
    };
    const first = shard(publicArtifact); const second = shard(privateArtifact);
    expect(first.path).not.toBe(second.path);
    expect(first.body.schemaVersion).toBe(2);
    expect(first.body.records).toEqual(second.body.records);
    expect(first.body.records[0]).toMatchObject({ name: 'power', width: 24, height: 24, unicode: 'f0425', ligatures: [], paths: ['M0 0Z'] });
    const expected = { profile: 'free', family: 'mdi', style: 'default', bucket: 0 };
    for (const shard of [{ ...first.body, schemaVersion: 1 }, { ...first.body, profile: 'pro-local' }]) {
      expect(() => validateIconShard(shard, expected)).toThrow(/envelope/);
      expect(() => validateRuntimeShard(shard, expected)).toThrow(/envelope/);
    }
    const obsoleteCatalogue = { ...JSON.parse(publicArtifact.catalogue), schemaVersion: 1 };
    expect(() => validateIconCatalogue(obsoleteCatalogue, { expectedProfile: 'free' })).toThrow(/catalogue/);
    expect(() => validateRuntimeCatalogue(obsoleteCatalogue, 'free')).toThrow(/catalogue/);
    const mdi = (JSON.parse(publicArtifact.catalogue) as { records: Array<{ family: string }> }).records.find(record => record.family === 'mdi');
    expect(mdi).toMatchObject({ name: 'power', aliases: [], officialAliases: ['switch'], terms: ['power', 'switch'] });
    const invalid = structuredClone(free);
    invalid.families[1]!.styles[0]!.icons[0]!.source = { package: '@fortawesome/free-solid-svg-icons', version: '7.3.1' };
    expect(() => generateIconArtifacts(invalid)).toThrow(/source/);
  });

  it('rejects malformed original ligatures in both shard validators', () => {
    const artifact = generateIconArtifacts(free);
    const path = [...artifact.files.keys()].find(path => path.includes('/classic-solid-'))!;
    const shard = JSON.parse(artifact.files.get(path)!.toString()) as { bucket: number; records: Array<Record<string, unknown>> };
    const expected = { profile: 'free', family: 'classic', style: 'solid', bucket: shard.bucket };
    for (const ligatures of [null, undefined, {}, '', 0, true, [null], ['z', 'a'], ['same', 'same']]) {
      const malformed = { ...shard, records: [{ ...shard.records[0], ligatures }] };
      expect(() => validateIconShard(malformed, expected)).toThrow(/record/);
      expect(() => validateRuntimeShard(malformed, expected)).toThrow(/record/);
    }
    for (const ligatures of [[], [1, 'alias']]) {
      const valid = { ...shard, records: [{ ...shard.records[0], ligatures }] };
      expect(() => validateIconShard(valid, expected)).not.toThrow();
      expect(() => validateRuntimeShard(valid, expected)).not.toThrow();
    }
  });

  it('consumes the pinned official Free metadata package for search terms', async () => {
    const outputRoot = await mkdtemp(`${tmpdir()}/nodel-free-icons-`);
    try {
      const artifact = await generateFreeIconAssets({ outputRoot });
      const records = JSON.parse(artifact.catalogue).records as Array<{ name: string; terms: string[] }>;
      expect(records.find(record => record.name === '0')?.terms).toContain('nada');
      expect(artifact.index.sources).toEqual([
        { library: 'fontawesome', package: '@fortawesome/fontawesome-free', version: '7.3.1' },
        { library: 'fontawesome', package: '@fortawesome/free-brands-svg-icons', version: '7.3.1' },
        { library: 'fontawesome', package: '@fortawesome/free-regular-svg-icons', version: '7.3.1' },
        { library: 'fontawesome', package: '@fortawesome/free-solid-svg-icons', version: '7.3.1' },
        { library: 'mdi', package: '@mdi/svg', version: '7.4.47' }
      ]);
      expect(artifact.index.default).toEqual({ family: 'classic', style: 'solid' });
      expect(records.filter(record => (record as { family?: string }).family === 'mdi')).toHaveLength(7205);
      const report = JSON.parse(await readFile(`${outputRoot}/generation-report.json`, 'utf8'));
      expect(report.mdi).toMatchObject({ source: { package: '@mdi/svg', version: '7.4.47' }, counts: { metadata: 7447, included: 7205, excluded: 242 }, exclusions: { count: 242, reasons: { 'Brand / Logo': 242 } } });
      expect(records.some(record => record.name === 'owl' && (record as { family?: string }).family === 'mdi')).toBe(true);
      const mdiRecords = records.filter(record => (record as { family?: string }).family === 'mdi');
      for (const name of report.mdi.exclusions.names) expect(mdiRecords.some(record => record.name === name)).toBe(false);
      validateIconArtifactFiles(artifact.files.get('v2/nodel-icons.json')!, artifact.files);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it('is deterministic and preserves aliases, metadata, and multi-path records', () => {
    const first = generateIconArtifacts(free);
    const second = generateIconArtifacts({ ...free, families: [...free.families].reverse().map(family => ({ ...family, styles: [...family.styles].reverse().map(style => ({ ...style, icons: [...style.icons].reverse() })) })) });
    expect([...first.files.entries()].map(([path, bytes]) => [path, bytes.toString('hex')])).toEqual([...second.files.entries()].map(([path, bytes]) => [path, bytes.toString('hex')]));
    expect(first.index.aliases).toEqual({ power: 'power-off' });
    const shard = [...first.files.entries()].find(([path]) => path.includes('/icons/classic-solid-'))![1].toString();
    const parsedShard = JSON.parse(shard) as { records: Array<{ name: string; paths: string[] }> };
    const parsedCatalogue = JSON.parse(first.catalogue) as { records: Array<{ terms: string[] }> };
    expect(parsedShard.records.find((record) => record.name === 'split')?.paths).toEqual(['M1', 'M2']);
    expect(parsedCatalogue.records.find(record => record.terms.includes('shutdown'))).toBeTruthy();
    expect(parsedCatalogue.records.find((record) => record.terms.includes('power-alias'))).toBeTruthy();
    validateIconCatalogue(JSON.parse(first.catalogue), { expectedProfile: 'free' });
    validateRuntimeCatalogue(JSON.parse(first.catalogue), 'free');
    const shardPath = [...first.files.keys()].find((path) => path.includes('/icons/classic-solid-'))!;
    const shardParts = shardPath.match(/classic-solid-(\d+)-/)!;
    validateIconShard(JSON.parse(first.files.get(shardPath)!.toString()), { profile: 'free', family: 'classic', style: 'solid', bucket: Number(shardParts[1]) });
    validateRuntimeShard(JSON.parse(first.files.get(shardPath)!.toString()), { profile: 'free', family: 'classic', style: 'solid', bucket: Number(shardParts[1]) });
  });

  it('supports the shared pro-local shape without permitting it as Free', () => {
    const artifact = generateIconArtifacts(pro);
    expect(() => validateIconArtifact(artifact.index, { expectedProfile: 'free' })).toThrow(/profile/);
    expect(() => validateRuntimeArtifact(artifact.index, 'free')).toThrow(/profile/);
    validateIconArtifact(artifact.index, { expectedProfile: 'pro-local' });
  });

  it('uses the same FNV-1a bucket primitive in Node and runtime code', () => {
    for (const name of ['power-off', 'split', 'unicode-✓']) expect(fnv1a32(name)).toBe(nodeFNV(name));
  });

  it('rejects conflicts, unsafe paths, and non-power-of-two shard metadata', () => {
    const family = free.families[0]!;
    const style = family.styles[0]!;
    const icon = style.icons[0]!;
    expect(() => generateIconArtifacts(withSolidIcons([...style.icons, { ...icon, icon: [17, 16, [], 'f011', 'DIFFERENT'] }]))).toThrow(/Conflicting/);
    const artifact = generateIconArtifacts(free);
    const invalid = structuredClone(artifact.index) as { families: Array<{ styles: Array<{ sharding: { bucketCount: number } }> }> };
    invalid.families[0]!.styles[0]!.sharding.bucketCount = 3;
    expect(() => validateIconArtifact(invalid)).toThrow(/sharding/);
    expect(() => validateRuntimeArtifact({ ...artifact.index, cataloguePath: '../secret.json' })).toThrow(/shape|path/);
    expect(() => validateIconCatalogue({ schemaVersion: 2, profile: 'free', records: [{ name: 'z', label: 'z', terms: [], aliases: [], officialAliases: [], family: 'classic', style: 'solid' }, { name: 'a', label: 'a', terms: [], aliases: [], officialAliases: [], family: 'classic', style: 'solid' }] }, { expectedProfile: 'free' })).toThrow(/catalogue/);
    expect(() => validateRuntimeCatalogue({ schemaVersion: 2, profile: 'free', records: [] }, 'free')).not.toThrow();
    expect(() => generateIconArtifacts({ ...free, sources: free.sources.map((source, index) => index === 0 ? { ...source, version: '6.0.0' } : source) })).toThrow(/same Font Awesome major/);
    expect(() => generateIconArtifacts({ ...free, sources: [{ package: '/tmp/secret', version: '7.3.1' }] })).toThrow(/source/);
    expect(() => normalizeIconRecord({ iconName: 'bad', icon: [0, 5000, [], 'zz', ''] })).toThrow(/Malformed/);
    expect(() => generateIconArtifacts({ ...free, aliases: { missing: 'does-not-exist' } })).toThrow(/alias/);
    const raw = { iconName: 'bad', icon: [16, 16, [], 'f001', 'M0'] };
    expect(() => normalizeIconRecord({ ...raw, icon: [0.5, 16, [], 'f001', 'M0'] })).toThrow(/Malformed/);
    expect(() => normalizeIconRecord({ ...raw, icon: [16, 16, [], 'not-unicode', 'M0'] })).toThrow(/Malformed/);
    expect(() => normalizeIconRecord({ ...raw, label: '\u0001' })).toThrow(/label/);
    expect(() => normalizeIconRecord({ ...raw, label: 'x'.repeat(257) })).toThrow(/label/);
    expect(() => normalizeIconRecord({ ...raw, icon: [16, 16, [], 'f001', 'x'.repeat(262145)] })).toThrow(/paths/);
    expect(() => normalizeIconRecord({ ...raw, icon: [16, 16, [], 'f001', ['M0', 'M1', 'M2']] })).toThrow(/paths/);
    expect(normalizeIconRecord({ ...raw, icon: [16, 16, ['same', 'same'], 'f001', ['M0', 'M1']] }).ligatures).toEqual(['same']);
    const shardPath = [...artifact.files.keys()].find(path => path.includes('/icons/classic-solid-'))!;
    const validShard = JSON.parse(artifact.files.get(shardPath)!.toString()) as { bucket: number; records: Array<Record<string, unknown>> };
    const expected = { profile: 'free', family: 'classic', style: 'solid', bucket: validShard.bucket as number };
    for (const invalid of [{ ...validShard, extra: true }, { ...validShard, family: '../escape' }, { ...validShard, records: Array.from({ length: 4097 }, () => validShard.records[0]) }]) {
      expect(() => validateIconShard(invalid, expected)).toThrow(/envelope/);
      expect(() => validateRuntimeShard(invalid, expected)).toThrow(/envelope/);
    }
    const unsorted = { ...validShard, records: [{ ...(validShard.records as Array<Record<string, unknown>>)[0], ligatures: ['z', 'a'] }] };
    expect(() => validateIconShard(unsorted, expected)).toThrow(/record/);
    expect(() => validateRuntimeShard(unsorted, expected)).toThrow(/record/);
    expect(() => validateIconShard({ ...validShard, family: 'f'.repeat(129) }, expected)).toThrow(/envelope/);
    expect(() => validateRuntimeShard({ ...validShard, family: 'f'.repeat(129) }, expected)).toThrow(/envelope/);
    const invalidCatalogue = { schemaVersion: 2, profile: 'free', records: [{ name: 'a', label: 'a', terms: ['z', 'a'], aliases: ['same', 'same'], officialAliases: ['official', 'official'], family: 'classic', style: 'solid' }] };
    expect(() => validateIconCatalogue(invalidCatalogue, { expectedProfile: 'free' })).toThrow(/catalogue/);
    expect(() => validateRuntimeCatalogue(invalidCatalogue, 'free')).toThrow(/catalogue/);
    expect(() => validateIconArtifact({ ...artifact.index, sources: [] })).toThrow(/source package/);
    expect(() => validateRuntimeArtifact({ ...artifact.index, sources: [] })).toThrow(/shape/);
    const prerelease = structuredClone(artifact.index) as { packageVersion: string; sources: Array<{ version: string }> };
    prerelease.packageVersion = '0.1.2-rc.1+build.5';
    prerelease.sources[0]!.version = '7.3.1-rc.1+build.5';
    expect(() => validateIconArtifact(prerelease, { expectedProfile: 'free' })).not.toThrow();
    expect(() => validateRuntimeArtifact(prerelease, 'free')).not.toThrow();
    const leadingZero = structuredClone(prerelease) as { sources: Array<{ version: string }> };
    leadingZero.sources[0]!.version = '07.3.1';
    expect(() => validateIconArtifact(leadingZero, { expectedProfile: 'free' })).toThrow(/source/);
    expect(() => validateRuntimeArtifact(leadingZero, 'free')).toThrow(/source/);
  });

  it('changes bucket count at the raw-byte boundary and hashes actual bucket bytes', () => {
    const icons = Array.from({ length: 400 }, (_, index) => ({ iconName: `synthetic-${String(index).padStart(3, '0')}`, icon: [16, 16, [], `e${index.toString(16)}`, 'M' + '1'.repeat(500)] }));
    const artifact = generateIconArtifacts(withSolidIcons(icons));
    const style = (artifact.index.families as Array<{ family: string; styles: Array<{ style: string; sharding: { bucketCount: number }; shards: string[] }> }>).find(family => family.family === 'classic')!.styles.find(style => style.style === 'solid')!;
    expect(style.sharding.bucketCount).toBeGreaterThan(1);
    for (const path of style.shards) {
      const bytes = artifact.files.get(path)!;
      expect(bytes.byteLength).toBeLessThanOrEqual(128 * 1024);
      expect(createHash('sha256').update(bytes).digest('hex').startsWith(path.match(/-([0-9a-f]{12})\.json$/)![1]!)).toBe(true);
    }
  });

  it('bounds generated shards by both bytes and records and fails at the bucket ceiling', () => {
    const icons = Array.from({ length: 4097 }, (_, index) => ({ iconName: `i-${index}`, icon: [1, 1, [], '1', 'M0'] }));
    const artifact = generateIconArtifacts(withSolidIcons(icons));
    for (const [path, bytes] of artifact.files) if (/solid-\d+-/.test(path)) {
      expect(bytes.length).toBeLessThanOrEqual(128 * 1024);
      expect(JSON.parse(bytes.toString()).records.length).toBeLessThanOrEqual(4096);
    }
    expect(() => generateIconArtifacts(withSolidIcons([{ iconName: 'too-large', icon: [1, 1, [], '1', 'M' + '1'.repeat(128 * 1024)] }]))).toThrow(/bytes and 4096 records at 128 buckets/);
  });

  it('rejects stale versions, catalogue tampering, and shard/catalogue mismatches', () => {
    const artifact = generateIconArtifacts(free);
    const files = new Map(artifact.files);
    const indexBytes = files.get('v2/nodel-icons.json')!;
    expect(() => validateIconArtifactFiles(indexBytes, files, { expectedProfile: 'free', expectedPackageVersion: '9.9.9' })).toThrow(/packageVersion/);
    const cataloguePath = artifact.index.cataloguePath as string;
    files.set(cataloguePath, Buffer.from(files.get(cataloguePath)!.toString().replace('Power', 'Tampered')));
    expect(() => validateIconArtifactFiles(indexBytes, files, { expectedProfile: 'free', expectedPackageVersion: free.packageVersion })).toThrow(/digest/);
  });

  it('rejects an oversized index before parsing and keeps the runtime limit in sync', () => {
    expect(maxIconIndexBytes).toBe(256 * 1024);
    expect(MAX_ICON_INDEX_BYTES).toBe(maxIconIndexBytes);
    const artifact = generateIconArtifacts(free);
    const files = new Map(artifact.files);
    expect(() => validateIconArtifactFiles(Buffer.alloc(maxIconIndexBytes + 1), files)).toThrow(/index exceeds/);
  });

  it('rejects reordered or cross-family shard paths in both validation layers', () => {
    const icons = Array.from({ length: 400 }, (_, index) => ({ iconName: `synthetic-${String(index).padStart(3, '0')}`, icon: [16, 16, [], `e${index.toString(16)}`, 'M' + '1'.repeat(500)] }));
    const artifact = generateIconArtifacts(withSolidIcons(icons));
    const index = structuredClone(artifact.index) as { families: Array<{ family: string; styles: Array<{ style: string; shards: string[] }> }> };
    const shards = index.families.find(family => family.family === 'classic')!.styles.find(style => style.style === 'solid')!.shards;
    expect(shards.length).toBeGreaterThan(1);
    [shards[0], shards[1]] = [shards[1]!, shards[0]!];
    expect(() => validateRuntimeArtifact(index)).toThrow(/reordered/);
    const files = new Map(artifact.files).set('v2/nodel-icons.json', Buffer.from(JSON.stringify(index)));
    expect(() => validateIconArtifactFiles(files.get('v2/nodel-icons.json')!, files, { expectedProfile: 'free' })).toThrow(/reordered|bucket|family|style/);
  });

  it('uses set membership for catalogue and shard parity', async () => {
    const source = await readFile('scripts/icon-artifact.mjs', 'utf8');
    expect(source).toContain('const catalogueKeys = new Set(catalogue.records.map');
    expect(source).not.toContain('catalogue.records.some(record => `${record.name}\\0${record.family}\\0${record.style}` === key)');
  });
});
