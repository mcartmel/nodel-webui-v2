import { createHash } from 'node:crypto';

import '../src/components/nodel-icon';
import { resetIconCatalogueCache } from '../src/icons/catalogue-loader';

function jsonBytes(value: unknown) { return JSON.stringify(value); }
function contentDigest(value: unknown, length: number) { return createHash('sha256').update(jsonBytes(value)).digest('hex').slice(0, length); }

const definitions = [
  ['classic', 'solid', 'solid-icon'],
  ['classic', 'regular', 'regular-icon'],
  ['brands', 'brands', 'brand-icon'],
  ['ornate', 'display', 'default-icon']
] as const;

const shards = definitions.map(([family, style, name]) => {
  const body = { schemaVersion: 1, profile: 'free', family, style, bucket: 0, records: [{ name, width: 16, height: 16, unicode: 'f001', ligatures: [], paths: ['M0'] }] };
  const path = `v2/icons/${family}-${style}-0-${contentDigest(body, 12)}.json`;
  return { body, path, family, style };
});

const records = shards.map(item => item.body);

const catalogue = {
  schemaVersion: 1, profile: 'free',
  records: definitions.map(([family, style, name]) => ({
    name,
    label: name,
    family,
    style,
    terms: [name],
    aliases: [],
    officialAliases: []
  }))
};

const index = {
  schemaVersion: 1, profile: 'free', packageVersion: '0.1.2', sources: [{ package: '@fortawesome/free-solid-svg-icons', version: '7.3.1' }],
  default: { family: 'classic', style: 'solid' }, aliases: {},
  families: shards.reduce<Array<Record<string, unknown>>>((families, item) => {
    const existing = families.find(candidate => candidate.family === item.family);
    const styleEntry = { style: item.style, sharding: { algorithm: 'fnv1a-32', bucketCount: 1, maxBytes: 131072 }, shards: [item.path] };
    if (existing) (existing.styles as unknown[]).push(styleEntry);
    else families.push({ family: item.family, defaultStyle: item.style, styles: [styleEntry] });
    return families;
  }, []),
  cataloguePath: `v2/icons/catalogue-${contentDigest(catalogue, 16)}.json`
};
const recordsByPath = new Map(shards.map(item => [item.path, item.body]));

function response(body: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return { ok: true, status: 200, headers: new Headers({ 'content-length': String(bytes.byteLength) }), arrayBuffer: async () => bytes.buffer } as Response;
}

const wait = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 20));
};

describe('nodel-icon runtime catalogue rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetIconCatalogueCache();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.includes('nodel-icons.json')) return response(index);
      let record = recordsByPath.get(url.replace(/^.*\//, ''));
      if (!record) {
        for (const [path, value] of recordsByPath.entries()) {
          if (url.includes(`/${path}`)) {
            record = value;
            break;
          }
        }
      }
      return response(record ?? records[0]);
    });
  });

  it('renders Solid, Regular, and Brands records with effective state attributes', async () => {
    document.body.innerHTML = '<nodel-icon name="solid-icon"></nodel-icon><nodel-icon name="regular-icon" family="classic" style="regular"></nodel-icon><nodel-icon name="brand-icon" family="brands"></nodel-icon><nodel-icon name="default-icon" family="ornate"></nodel-icon>';
    await wait();
    const icons = [...document.querySelectorAll<HTMLElement>('nodel-icon')];
    expect(icons.map(icon => [icon.dataset.family, icon.dataset.style, icon.dataset.iconState])).toEqual([
      ['classic', 'solid', 'ready'], ['classic', 'regular', 'ready'], ['brands', 'brands', 'ready'], ['ornate', 'display', 'ready']
    ]);
    expect(icons[1]?.querySelector('[data-icon="regular-icon"]')).not.toBeNull();
    expect(icons[2]?.querySelector('[data-icon="brand-icon"]')).not.toBeNull();
    expect(icons[3]?.querySelector('[data-icon="default-icon"]')).not.toBeNull();
  });

  it('reflects known loading defaults and replaces arbitrary-family style after manifest resolution', async () => {
    const deferred: Array<(value: Response) => void> = [];
    vi.mocked(globalThis.fetch).mockImplementation(async input => {
      const url = String(input);
      if (url.includes('nodel-icons.json')) return response(index);
      return new Promise<Response>(resolve => deferred.push(resolve));
    });
    document.body.innerHTML = '<nodel-icon name="brand-icon" family="brands"></nodel-icon><nodel-icon name="default-icon" family="ornate"></nodel-icon>';
    await wait();
    const icons = [...document.querySelectorAll<HTMLElement>('nodel-icon')];
    expect(icons.map(icon => icon.dataset.style)).toEqual(['brands', '']);
    deferred[0]?.(response(records[2]));
    deferred[1]?.(response(records[3]));
    await wait();
    expect(icons.map(icon => icon.dataset.style)).toEqual(['brands', 'display']);
  });

  it('keeps accessibility and image fallback behavior for unavailable records', async () => {
    document.body.innerHTML = '<nodel-icon name="missing" alt="Missing icon"></nodel-icon>';
    await wait();
    const icon = document.querySelector('nodel-icon') as HTMLElement;
    expect(icon.dataset.iconState).toBe('fallback');
    expect(icon.getAttribute('role')).toBe('img');
    expect(icon.getAttribute('aria-label')).toBe('Missing icon');
    expect(icon.querySelector('[data-icon="image"]')).not.toBeNull();
  });

  it('defers inactive pages and ignores stale and disconnected completions', async () => {
    const deferred: Array<(value: Response) => void> = [];
    vi.mocked(globalThis.fetch).mockImplementation(async input => {
      const url = String(input);
      if (url.includes('nodel-icons.json')) return response(index);
      return new Promise<Response>(resolve => deferred.push(resolve));
    });
    document.body.innerHTML = '<nodel-page hidden><nodel-icon name="regular-icon" family="classic" style="regular"></nodel-icon></nodel-page>';
    const icon = document.querySelector('nodel-icon') as HTMLElement;
    await wait();
    expect(icon.dataset.iconState).toBe('loading');
    expect(deferred).toHaveLength(0);

    document.querySelector('nodel-page')?.removeAttribute('hidden');
    await wait();
    expect(deferred).toHaveLength(1);
    icon.setAttribute('name', 'brand-icon');
    icon.setAttribute('family', 'brands');
    icon.setAttribute('style', 'brands');
    await wait();
    expect(deferred).toHaveLength(2);
    deferred[0]?.(response(records[1]));
    await wait();
    expect(icon.querySelector('[data-icon="regular-icon"]')).toBeNull();
    icon.remove();
    deferred[1]?.(response(records[2]));
    await wait();
    expect(icon.dataset.iconState).toBe('loading');
  });
});
