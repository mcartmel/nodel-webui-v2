import { mkdtemp, mkdir, open, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPinnedMdiMetadata, normalizeMdiMetadata } from '../scripts/mdi-metadata.mjs';
import type { MdiMetadataRecord } from '../scripts/mdi-metadata.mjs';

type MdiFixture = { name: string; codepoint: string; aliases: string[]; tags: string[]; deprecated?: boolean };
const svg = (name: string) => `<svg xmlns="http://www.w3.org/2000/svg" id="mdi-${name}" viewBox="0 0 24 24"><path d="M0 0L1 1Z" /></svg>`;
const entry = (name: string, overrides: Partial<MdiFixture> = {}): MdiFixture => ({ name, codepoint: 'F0335', aliases: [], tags: ['Home Automation'], deprecated: false, ...overrides });
const normalize = (metadata: unknown[]) => normalizeMdiMetadata({ metadata, readSvg: async path => svg(path.slice(4, -4)) });
const withPath = (data: string) => svg('safe').replace('M0 0L1 1Z', data);
const temporaryRoots: string[] = [];

async function pinnedFixture(metadata: unknown = [entry('safe')], useInstalledSvgs = false) {
  const root = await mkdtemp(join(tmpdir(), 'mdi-metadata-'));
  temporaryRoots.push(root);
  const packageRoot = join(root, 'node_modules/@mdi/svg');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@mdi/svg': '7.4.47' } }));
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/@mdi/svg': { version: '7.4.47' } } }));
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@mdi/svg', version: '7.4.47' }));
  await writeFile(join(packageRoot, 'meta.json'), JSON.stringify(metadata));
  if (useInstalledSvgs) await symlink(resolve('node_modules/@mdi/svg/svg'), join(packageRoot, 'svg'), 'dir');
  else {
    await mkdir(join(packageRoot, 'svg'));
    await writeFile(join(packageRoot, 'svg/safe.svg'), svg('safe'));
  }
  return { root, packageRoot };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('MDI metadata adapter', () => {
  it('returns deterministic neutral records with real metadata and reports filtered entries', async () => {
    const metadata = [
      entry('lightbulb', { aliases: ['idea', 'bulb'], tags: ['Home Automation'], codepoint: 'F0335' }),
      entry('old-icon', { codepoint: 'F0336', deprecated: true }),
      entry('logo-mark', { codepoint: 'F0337', aliases: ['brand-mark'], tags: ['Brand / Logo'] })
    ];
    const first = await normalize(metadata);
    const second = await normalize(metadata);
    expect(first).toEqual(second);
    expect(first.records).toHaveLength(2);
    expect(first.records[0]).toMatchObject({ name: 'lightbulb', label: 'Lightbulb', codepoint: 'F0335', width: 24, height: 24, paths: ['M0 0L1 1Z'], aliases: ['bulb', 'idea'], searchTerms: ['Home Automation', 'bulb', 'idea', 'lightbulb'], source: { package: '@mdi/svg', version: '7.4.47', svgPath: 'svg/lightbulb.svg' } });
    expect(first.records[1]?.deprecated).toBe(true);
    expect(first.exclusions).toEqual({ count: 1, reasons: { 'Brand / Logo': 1 }, names: ['logo-mark'], entries: [{ name: 'logo-mark', aliases: ['brand-mark'], reason: 'Brand / Logo' }] });
    expect(first.report).toEqual({ source: { package: '@mdi/svg', version: '7.4.47' }, counts: { metadata: 3, included: 2, excluded: 1 }, exclusions: { count: 1, names: ['logo-mark'], reasons: { 'Brand / Logo': 1 } } });
  });

  it.each([
    ['duplicate names', [entry('same'), entry('same', { codepoint: 'F0336' })], /duplicate canonical name/],
    ['duplicate codepoints', [entry('first'), entry('second')], /duplicate codepoint/],
    ['out-of-range codepoints', [entry('too-large', { codepoint: 'FFFFFF' })], /out-of-range codepoint/],
    ['invalid canonical names', [entry('Bad_Name')], /invalid canonical name/],
    ['missing category metadata', [{ ...entry('uncategorized'), tags: undefined }], /invalid category metadata/],
    ['noncanonical category whitespace', [entry('bad-category', { tags: ['Brand / Logo '] })], /invalid category metadata/],
    ['control characters in category metadata', [entry('bad-control', { tags: ['Home\u0000Automation'] })], /invalid category metadata/],
    ['excessive raw aliases', [entry('safe', { aliases: Array(257).fill('alias') })], /invalid aliases/],
    ['excessive raw tags', [entry('safe', { tags: Array(65).fill('Category') })], /invalid category metadata/],
    ['excessive unique aliases', [entry('safe', { aliases: Array.from({ length: 33 }, (_, index) => `alias-${index}`) })], /aliases exceeds 32 unique values/],
    ['excessive metadata entries', Array(10001).fill(entry('safe')), /at most 10000 entries/]
  ])('rejects %s', async (_label, metadata, message) => {
    await expect(normalize(metadata)).rejects.toThrow(message);
  });

  it.each([
    'M0 0L1', 'M0 0L1,', 'M0 0E', 'M0 0L', 'M0 0e1E', 'M0 0L1e 1', 'M0 0L1e+ 1',
    'M0 0A1 1 0 2 0 1 1', 'M0 0A1 1 0 0 2 1 1', 'M0 0A-1 1 0 0 0 1 1',
    'M0 0A+1 1 0 0 0 1 1', 'M0 0A1 -1 0 0 0 1 1', 'M0 0A1 1 0 -0 1 1 1',
    'M0 0A1 1 0 0.5 1 1', 'M0 0A1 1 0 0 0 1',
    'L0 0', 'Z', 'M', 'M0', 'M,0 0', 'M0,,0', 'M0 0,', 'M0 0,L1 1', 'M0 0Z1 1',
    'M0 0L1 1, Z', 'M0 0L1 1,,2 2', 'M0 0NaN 1', 'M0 0L1e999 1', 'M0 0L-100001 1',
    'M0 0L1\u00a01', 'M0 0R1 1', 'M0 0<', 'M0 0 1', 'M0 0C1 1 2 2 3 3 4'
  ])('rejects malformed or incomplete path grammar: %s', async data => {
    await expect(normalizeMdiMetadata({ metadata: [entry('safe')], readSvg: () => withPath(data) })).rejects.toThrow(/path data/);
  });

  const argumentCounts = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
  it.each(Object.entries(argumentCounts).flatMap(([command, count]) => [command, command.toLowerCase()].map(letter => [letter, count] as const)))('requires complete argument groups for %s', async (command, count) => {
    for (let length = 0; length < count; length += 1) {
      const data = `M0 0${command}${Array(length).fill('0').join(' ')}`;
      await expect(normalizeMdiMetadata({ metadata: [entry('safe')], readSvg: () => withPath(data) })).rejects.toThrow(/path data/);
    }
  });

  it.each([
    'M0 0L1 1Z', 'm0,0 1,1 2,2z', ' M.5.6L1.-2.5e-1 1e+2-1E2 ',
    'M0 0H1 2h-1v.5 1V2', 'M0 0C1 1 2 2 3 3 4 4 5 5 6 6c1 1 2 2 3 3',
    'M0 0S1 1 2 2s3 3 4 4Q1 1 2 2q3 3 4 4T5 5t6 6',
    'M0 0A1 2 45 0 1 3 4a1 2 0 013 4', 'M0 0A0 0 0 1 0-1-2', 'M0 0A1 1 0 0 1.5 1', 'M0 0ZM1 1z'
  ])('accepts complete bounded SVG path grammar: %s', async data => {
    const result = await normalizeMdiMetadata({ metadata: [entry('safe')], readSvg: () => withPath(data) });
    expect(result.records[0]?.paths).toEqual([data]);
  });

  it.each(['brand / logo', 'BRAND / LOGO', 'bRaNd / LoGo'])('excludes case-variant brand categories: %s', async tag => {
    const readSvg = vi.fn(async () => svg('safe'));
    const result = await normalizeMdiMetadata({ metadata: [entry('logo-mark', { tags: [tag] })], readSvg });
    expect(result.counts).toEqual({ metadata: 1, included: 0, excluded: 1 });
    expect(result.exclusions.entries).toEqual([{ name: 'logo-mark', aliases: [], reason: 'Brand / Logo' }]);
    expect(readSvg).not.toHaveBeenCalled();
  });

  it('case-folds excluded terms without discarding an included colliding canonical name', async () => {
    const result = await normalize([
      entry('logo-mark', { aliases: ['brand-alias'], tags: ['Brand / Logo'] }),
      entry('semantic-web', { codepoint: 'F0336', aliases: ['owl'], tags: ['brand / logo'] }),
      entry('owl', { codepoint: 'F0337', aliases: ['logo-mark', 'brand-alias', 'semantic-web'], tags: ['Logo-Mark', 'Brand-Alias', 'Semantic-Web', 'OWL', 'Animals'] })
    ]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ name: 'owl', label: 'Owl', aliases: [], tags: ['Animals'], searchTerms: ['Animals', 'owl'] });
    expect(result.exclusions.names).toEqual(['logo-mark', 'semantic-web']);
  });

  it('sorts and deduplicates all output arrays independently of source ordering', async () => {
    const metadata = [
      entry('zebra', { aliases: ['stripe', 'stripe', 'animal'], tags: ['Nature', 'Animals', 'Nature'] }),
      entry('ant', { codepoint: 'F0336' }),
      entry('z-logo', { codepoint: 'F0337', aliases: ['z-alias', 'a-alias', 'a-alias'], tags: ['Brand / Logo'] }),
      entry('a-logo', { codepoint: 'F0338', tags: ['Brand / Logo'] })
    ];
    const result = await normalize(metadata);
    expect(result).toEqual(await normalize([...metadata].reverse().map(item => ({ ...item, aliases: [...item.aliases].reverse(), tags: [...item.tags].reverse() }))));
    expect(result.records.map(record => record.name)).toEqual(['ant', 'zebra']);
    expect(result.records[1]).toMatchObject({ aliases: ['animal', 'stripe'], tags: ['Animals', 'Nature'], searchTerms: ['Animals', 'Nature', 'animal', 'stripe', 'zebra'] });
    expect(result.exclusions.entries.map(item => item.name)).toEqual(['a-logo', 'z-logo']);
    expect(result.exclusions.entries[1]?.aliases).toEqual(['a-alias', 'z-alias']);
  });

  it('deduplicates before applying output limits and accepts artifact-compatible boundaries', async () => {
    const aliases = Array.from({ length: 32 }, (_, index) => `alias-${index}`);
    const tags = Array.from({ length: 64 }, (_, index) => `Tag ${index}`);
    const result = await normalize([entry('safe', { aliases: [...aliases, ...aliases], tags })]);
    expect(result.records[0]?.aliases).toHaveLength(32);
    expect(result.records[0]?.tags).toHaveLength(64);
    expect(result.records[0]?.searchTerms).toHaveLength(97);
    expect(result.records[0]?.searchTerms).toEqual([...new Set(['safe', ...aliases, ...tags])].sort());
  });

  it('bounds supplied SVG strings and path data before parsing', async () => {
    await expect(normalizeMdiMetadata({ metadata: [entry('safe')], readSvg: () => `${svg('safe')}${' '.repeat(128 * 1024)}` })).rejects.toThrow(/text bounds/);
    await expect(normalizeMdiMetadata({ metadata: [entry('safe')], readSvg: () => withPath(`M0 0${'L1 1'.repeat(16384)}`) })).rejects.toThrow(/path data/);
    const exactLimit = `${svg('safe')}${' '.repeat(128 * 1024 - Buffer.byteLength(svg('safe')))}`;
    await expect(normalizeMdiMetadata({ metadata: [entry('safe')], readSvg: () => exactLimit })).resolves.toMatchObject({ counts: { included: 1 } });
    const exactPathLimit = `M0 0${'L1 1'.repeat(16383)}`;
    expect(exactPathLimit.length).toBe(64 * 1024);
    await expect(normalizeMdiMetadata({ metadata: [entry('safe')], readSvg: () => withPath(exactPathLimit) })).resolves.toMatchObject({ counts: { included: 1 } });
  });

  it.each([
    ['external reference', '<svg xmlns="http://www.w3.org/2000/svg" id="mdi-safe" viewBox="0 0 24 24"><image href="https://evil" /></svg>'],
    ['script', '<svg xmlns="http://www.w3.org/2000/svg" id="mdi-safe" viewBox="0 0 24 24"><script /></svg>'],
    ['extra path attribute', '<svg xmlns="http://www.w3.org/2000/svg" id="mdi-safe" viewBox="0 0 24 24"><path fill="red" d="M0 0" /></svg>'],
    ['wrong name', svg('other')],
    ['fractional viewBox', '<svg xmlns="http://www.w3.org/2000/svg" id="mdi-safe" viewBox="0 0 24.5 24"><path d="M0 0L1 1Z" /></svg>'],
    ['multiple paths', '<svg xmlns="http://www.w3.org/2000/svg" id="mdi-safe" viewBox="0 0 24 24"><path d="M0 0L1 1Z" /><path d="M1 1L2 2Z" /></svg>'],
    ['invalid path command', '<svg xmlns="http://www.w3.org/2000/svg" id="mdi-safe" viewBox="0 0 24 24"><path d="eeee" /></svg>'],
    ['out-of-bounds path coordinates', '<svg xmlns="http://www.w3.org/2000/svg" id="mdi-safe" viewBox="0 0 24 24"><path d="M9999999 0L1 1Z" /></svg>'],
    ['control characters', `<svg xmlns="http://www.w3.org/2000/svg" id="mdi-safe" viewBox="0 0 24 24"><path d="M0 0L1\u00001Z" /></svg>`]
  ])('rejects hostile SVG structure (%s)', async (_label, content) => {
    await expect(normalizeMdiMetadata({ metadata: [entry('safe')], readSvg: async () => content })).rejects.toThrow();
  });

  it('removes excluded aliases from alias-derived search metadata but preserves a colliding canonical icon', async () => {
    const result = await normalize([
      entry('semantic-web', { aliases: ['owl'], tags: ['Brand / Logo'] }),
      entry('owl', { codepoint: 'F0336', aliases: ['semantic-web'], tags: ['semantic-web', 'Animals'] })
    ]);
    expect(result.records.map(record => record.name)).toEqual(['owl']);
    expect(result.records[0]).toMatchObject({ name: 'owl', label: 'Owl', aliases: [], tags: ['Animals'], searchTerms: ['Animals', 'owl'] });
    expect(result.exclusions.names).toEqual(['semantic-web']);
  });

  it('loads the exact pinned upstream package and matches the agreed exclusion count', async () => {
    const result = await loadPinnedMdiMetadata();
    const lightbulb = result.records.find(record => record.name === 'lightbulb');
    expect(result.counts).toEqual({ metadata: 7447, included: 7205, excluded: 242 });
    expect(lightbulb).toMatchObject({ codepoint: 'F0335', aliases: ['bulb', 'idea'], tags: ['Home Automation'], width: 24, height: 24, paths: [expect.stringContaining('M12,2')] });
    expect(result.records.some(record => record.name === 'deprecated')).toBe(false);
    expect(result.records.filter(record => record.deprecated)).toHaveLength(17);
    expect(result.records.every(record => record.paths.length === 1 && record.width === 24 && record.height === 24)).toBe(true);
    expect(result.records.some(record => record.name === 'owl')).toBe(true);
    expect(result.records.some(record => record.name === 'android')).toBe(false);
    const excluded = new Set(result.exclusions.entries.flatMap(item => [item.name, ...item.aliases]));
    for (const record of result.records) {
      expect(record.aliases.length).toBeLessThanOrEqual(32);
      expect(record.searchTerms.length).toBeLessThanOrEqual(128);
      expect(record.aliases).toEqual([...new Set(record.aliases)].sort());
      expect(record.tags).toEqual([...new Set(record.tags)].sort());
      expect(record.searchTerms).toEqual([...new Set(record.searchTerms)].sort());
      expect([...record.aliases, ...record.tags].some(term => excluded.has(term.toLowerCase()))).toBe(false);
      expect(record.searchTerms.some(term => term !== record.name && excluded.has(term.toLowerCase()))).toBe(false);
    }
    expect(result.records.every((record: MdiMetadataRecord) => !record.tags.includes('Brand / Logo'))).toBe(true);
  });

  it.each([
    ['package.json', 256 * 1024],
    ['node_modules/@mdi/svg/package.json', 256 * 1024],
    ['package-lock.json', 8 * 1024 * 1024],
    ['node_modules/@mdi/svg/meta.json', 8 * 1024 * 1024],
    ['node_modules/@mdi/svg/svg/safe.svg', 128 * 1024]
  ] as const)('rejects oversized filesystem input before decoding: %s', async (path, limit) => {
    const { root } = await pinnedFixture();
    // Sparse files avoid allocating hostile input just to exercise the guard.
    await truncate(join(root, path), limit + 1);
    await expect(loadPinnedMdiMetadata({ root })).rejects.toThrow(/exceeds .* byte limit/);
  });

  it('caps actual filesystem reads even if an input grows after the size check', async () => {
    const { root, packageRoot } = await pinnedFixture();
    const path = join(packageRoot, 'svg/safe.svg');
    const limit = 128 * 1024;
    await truncate(path, limit + 100);
    const file = await open(path, 'r');
    const prototype = Object.getPrototypeOf(file);
    await file.close();
    // A stale size simulates growth without relying on a timing-sensitive race.
    const stat = vi.spyOn(prototype, 'stat').mockResolvedValue({ isFile: () => true, size: 0 });
    const read = vi.spyOn(prototype, 'read');
    try {
      await expect(loadPinnedMdiMetadata({ root })).rejects.toThrow(/exceeds .* byte limit/);
      const svgHandle = read.mock.contexts.at(-1) as FileHandle;
      const results = await Promise.all(read.mock.results.filter((_, index) => read.mock.contexts[index] === svgHandle).map(result => result.value as Promise<{ bytesRead: number }>));
      expect(results.reduce((sum, result) => sum + result.bytesRead, 0)).toBe(limit + 1);
      expect(svgHandle.fd).toBe(-1);
    } finally {
      stat.mockRestore();
      read.mockRestore();
    }
  });

  it('uses case-folded licensing classification in the pinned count gate', async () => {
    const metadata = JSON.parse(await readFile(resolve('node_modules/@mdi/svg/meta.json'), 'utf8')) as MdiFixture[];
    const android = metadata.find(item => item.name === 'android')!;
    android.tags = android.tags.map(tag => tag === 'Brand / Logo' ? 'brand / logo' : tag);
    const { root, packageRoot } = await pinnedFixture(metadata, true);
    const result = await loadPinnedMdiMetadata({ root });
    expect(result.counts).toEqual({ metadata: 7447, included: 7205, excluded: 242 });
    expect(result.records.some(record => record.name === 'android')).toBe(false);
    // Swapping one included category cannot hide Android's case-variant tag.
    metadata.find(item => item.name === 'owl')!.tags.push('Brand / Logo');
    await writeFile(join(packageRoot, 'meta.json'), JSON.stringify(metadata));
    await expect(loadPinnedMdiMetadata({ root })).rejects.toThrow(/metadata counts differ/);
  }, 15000);
});
