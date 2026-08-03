// @vitest-environment node

import type { OutputOptions, PreRenderedChunk } from 'rollup';
import type { UserConfig } from 'vite';
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
});
