// @vitest-environment node

import type { OutputOptions, PreRenderedChunk } from 'rollup';
import type { Plugin, UserConfig } from 'vite';
import packageMetadata from '../package.json';
import { serializeComponentContract } from '../src/component-contract/serialize';
import config from '../vite.config';

describe('Vite stable entry contract', () => {
  it('keeps authored pages outside the build inputs and emits stable support paths', () => {
    const userConfig = config as UserConfig;
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
    const plugins = (config as UserConfig).plugins as Plugin[];
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
});
