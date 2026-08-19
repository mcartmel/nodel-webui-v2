// @vitest-environment node

import type { OutputOptions, PreRenderedChunk } from 'rollup';
import type { Plugin, UserConfig } from 'vite';
import packageMetadata from '../package.json';
import { serializeComponentContract } from '../src/component-contract/serialize';
// @ts-expect-error Release scripts are intentionally plain Node ESM.
import { validateAuthoredPageScaffold } from '../scripts/verify-release-gate.mjs';
import { createViteConfig } from '../vite.config';

describe('Vite stable entry contract', () => {
  it('keeps authored pages outside the build inputs and emits stable support paths', () => {
    const userConfig = createViteConfig('public') as UserConfig;
    const build = userConfig.build!;
    const rollup = build.rollupOptions!;
    const inputs = rollup.input as Record<string, string>;
    const output = rollup.output as OutputOptions;
    const entryFileNames = output.entryFileNames as (chunk: PreRenderedChunk) => string;
    const assetFileNames = output.assetFileNames as (asset: { name?: string }) => string;

    expect(userConfig.base).toBe('./');
    expect(build.cssCodeSplit).toBe(false);
    expect(rollup.preserveEntrySignatures).toBe('exports-only');
    expect(Object.keys(inputs).sort()).toEqual(['components', 'main', 'nodel', 'nodes', 'toolkit']);
    expect(Object.values(inputs).some((path) => path.includes('/e2e/fixtures/'))).toBe(false);
    expect(entryFileNames({ name: 'main' } as PreRenderedChunk)).toBe('v2/nodel-webui.js');
    expect(entryFileNames({ name: 'nodes' } as PreRenderedChunk)).toBe('v2/entries/[name].js');
    expect(output.chunkFileNames).toBe('v2/chunks/[name]-[hash].js');
    expect(assetFileNames({ name: 'style.css' })).toBe('v2/nodel-webui.css');
  });

  it('serves and emits the deterministic component contract without a public source file', () => {
    const plugins = (createViteConfig('public') as UserConfig).plugins as Plugin[];
    const contractPlugin = plugins.find((plugin) => plugin.name === 'nodel-component-contract')!;
    const emitted: Array<{ type: string; fileName: string; source: string }> = [];
    (contractPlugin.generateBundle as Function).call({ emitFile: (asset: { type: string; fileName: string; source: string }) => emitted.push(asset) }, {}, {});
    expect(emitted).toEqual([{
      type: 'asset', fileName: 'v2/nodel-components.json', source: serializeComponentContract(packageMetadata.version)
    }]);

    let middleware: ((request: { url?: string; method?: string }, response: { statusCode: number; setHeader: (name: string, value: string | number) => void; end: (content?: string) => void }, next: () => void) => void) | undefined;
    const configureServer = contractPlugin.configureServer as (server: { middlewares: { use: (handler: typeof middleware) => void } }) => void;
    configureServer({ middlewares: { use: (handler) => { middleware = handler; } } });
    const headers = new Map<string, string | number>();
    let body: string | undefined;
    const response: { statusCode: number; setHeader: (name: string, value: string | number) => void; end: (content?: string) => void } = {
      statusCode: 0,
      setHeader: (name, value) => headers.set(name, value),
      end: (content) => { body = content; }
    };
    middleware!({ url: '/v2/nodel-components.json', method: 'GET' }, response, () => { throw new Error('component contract middleware did not handle GET'); });
    expect(response.statusCode).toBe(200);
    expect(headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(body).toBe(serializeComponentContract(packageMetadata.version));
    body = 'not empty';
    middleware!({ url: '/v2/nodel-components.json', method: 'HEAD' }, response, () => { throw new Error('component contract middleware did not handle HEAD'); });
    expect(body).toBeUndefined();
  });

  it('serves, emits, and rejects paths for declared icon assets', () => {
    const plugins = (createViteConfig('public') as UserConfig).plugins as Plugin[];
    const iconPlugin = plugins.find((plugin) => plugin.name === 'nodel-icon-assets')!;
    const emitted: Array<{ fileName: string; source: string }> = [];
    (iconPlugin.generateBundle as Function).call({ emitFile: (asset: { fileName: string; source: string }) => emitted.push(asset) }, {}, {});
    expect(emitted.some(asset => asset.fileName === 'v2/nodel-icons.json')).toBe(true);
    expect(emitted.some(asset => asset.fileName.includes('/icons/catalogue-'))).toBe(true);
    let middleware: ((request: { url?: string; method?: string }, response: { statusCode: number; setHeader: (name: string, value: string | number) => void; end: (content?: string) => void }, next: () => void) => void) | undefined;
    const configureServer = iconPlugin.configureServer as (server: { middlewares: { use: (handler: typeof middleware) => void } }) => void;
    configureServer({ middlewares: { use: (handler) => { middleware = handler; } } });
    const response = { statusCode: 0, headers: new Map<string, string | number>(), body: 'sentinel' as string | undefined, setHeader(name: string, value: string | number) { this.headers.set(name, value); }, end(content?: string) { this.body = content; } };
    middleware!({ url: '/v2/nodel-icons.json', method: 'GET' }, response, () => { throw new Error('declared icon GET was not handled'); });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('schemaVersion');
    response.body = 'sentinel';
    middleware!({ url: '/v2/nodel-icons.json', method: 'HEAD' }, response, () => { throw new Error('declared icon HEAD was not handled'); });
    expect(response.body).toBeUndefined();
    middleware!({ url: '/v2/icons/not-declared.json', method: 'GET' }, response, () => { throw new Error('undeclared icon path was forwarded'); });
    expect(response.statusCode).toBe(404);
    let forwarded = false;
    for (const url of ['/', '/index.html', '/src/main.ts', '/@vite/client', '/v2/nodel-components.json']) {
      middleware!({ url, method: 'GET' }, response, () => { forwarded = true; });
    }
    expect(forwarded).toBe(true);
  });

  it('requires authored scaffold ordering and stable dist assets', () => {
    const scaffold = '<script>theme</script><link rel="stylesheet" href="./v2/nodel-webui.css"><script type="module" src="./v2/nodel-webui.js"></script>';
    expect(validateAuthoredPageScaffold(scaffold, ['v2/nodel-webui.css', 'v2/nodel-webui.js'])).toBe(true);
    expect(() => validateAuthoredPageScaffold(scaffold.replace('nodel-webui.css', 'nodel-webui.js'), ['v2/nodel-webui.css', 'v2/nodel-webui.js'])).toThrow(/theme bootstrap/);
    expect(() => validateAuthoredPageScaffold(scaffold, ['v2/nodel-webui.js'])).toThrow(/missing dist asset/);
  });

  it('uses an explicit mode boundary and ignores hostile Pro environment variables for public builds', () => {
    const previous = { ...process.env };
    process.env.NODEL_PRO_LOCAL_BUILD = '1';
    process.env.NODEL_ICON_PROFILE = 'pro-local';
    process.env.NODEL_ICON_ASSET_ROOT = '/tmp/attacker-icons';
    process.env.NODEL_FONTAWESOME_PRO_DIR = '/tmp/attacker-pro';
    process.env.FONTAWESOME_PACKAGE_TOKEN = 'attacker-token';
    try {
      const publicConfig = createViteConfig('public');
      expect(publicConfig.build?.outDir).toBe('dist');
      const plugin = (publicConfig.plugins as Plugin[]).find(item => item.name === 'nodel-icon-assets')!;
      expect(plugin.configResolved).toBeDefined();
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  });
});
