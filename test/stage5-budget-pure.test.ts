// @vitest-environment node

import { finalizeBundleGraph, normalizeOutputPath, normalizeRollupBundle } from '../scripts/bundle-graph.mjs';
import { measureFiles, metric, traverseBundleGraph, validatePolicy, validateReleaseNotes } from '../scripts/verify-bundle-budget.mjs';
import { gzipSync } from 'node:zlib';

describe('Stage 5 pure budget and graph functions', () => {
  it('normalizes deterministic graph paths, virtual IDs, and ordering', () => {
    const graph = normalizeRollupBundle({
      'v2/z.js': { type: 'chunk', code: 'x', modules: { '/workspace/project/src/z.ts': {}, '\0/workspace/project/node_modules/pkg/index.js?x': {} }, imports: [], dynamicImports: [] },
      'v2/a.js': { type: 'asset', source: 'asset' }
    }, '/workspace/project') as { outputs: Array<{ path: string; modules: string[] }> };
    expect(graph.outputs.map((output) => output.path)).toEqual(['v2/a.js', 'v2/z.js']);
    expect(graph.outputs[1]?.modules).toEqual(['node_modules/pkg/index.js', 'src/z.ts']);
    expect(normalizeOutputPath('v2\\safe.js')).toBe('v2/safe.js');
    expect(() => normalizeOutputPath('../escape.js')).toThrow();
    expect(() => normalizeRollupBundle({ 'v2/a.js': { type: 'asset', source: 'a' }, 'v2\\a.js': { type: 'asset', source: 'b' } }, '/workspace/project')).toThrow(/duplicate/i);
    expect(() => normalizeRollupBundle({ 'v2/a.js': { type: 'chunk', code: 'a', modules: { '/outside.ts': {} }, imports: [], dynamicImports: [] } }, '/workspace/project')).toThrow(/escapes/i);
  });

  it('rejects missing emitted outputs and traverses cycles without looping', () => {
    const graph = { schemaVersion: 1, outputs: [{ path: 'a.js' }, { path: 'b.js' }] } as { schemaVersion: number; outputs: Array<{ path: string; imports?: string[]; dynamicImports?: string[] }> };
    graph.outputs[0]!.imports = ['b.js']; graph.outputs[0]!.dynamicImports = [];
    graph.outputs[1]!.imports = ['a.js']; graph.outputs[1]!.dynamicImports = [];
    expect(() => traverseBundleGraph(graph as never, 'a.js')).toThrow(/static import cycle.*a\.js.*b\.js.*a\.js/i);
    expect(() => traverseBundleGraph(graph as never, 'missing.js')).toThrow(/missing/i);
    expect(() => finalizeBundleGraph({ outputs: [{ path: 'a.js' }] }, new Set())).toThrow(/not written/i);
  });

  it('sums independent deterministic gzip sizes rather than compressing a concatenation', async () => {
    const files = new Map([['a', Buffer.from('shared-content-shared-content')], ['b', Buffer.from('shared-content-shared-content')]]);
    const result = await measureFiles(['b', 'a'], async (path) => files.get(path)!);
    expect(result.files).toEqual(['a', 'b']);
    expect(result.gzip).toBe(gzipSync(files.get('a')!, { level: 9 }).byteLength + gzipSync(files.get('b')!, { level: 9 }).byteLength);
  });

  it('rejects malformed, missing, extra, and baseline-overrun policy fields', () => {
    const names = ['stable-entry-closure', 'stable-css', 'codemirror-base', 'components-html', 'dist-v2-inventory', ...['python', 'html', 'xml', 'javascript', 'json', 'css', 'markdown', 'java', 'groovy', 'sql', 'shell'].map((role) => `codemirror-language-${role}`)];
    const budgets = Object.fromEntries(names.map((name) => [name, { rawBaseline: 1, rawMax: 2, gzipBaseline: 1, gzipMax: 2 }]));
    const base = { schemaVersion: 1, releaseNotesMarker: 'STAGE5_TEST_MARKER', rationale: 'This is a sufficiently bounded reviewed rationale.', codeMirrorBaseModuleId: 'src/editor/codemirror-editor.ts', languageRoles: ['python', 'html', 'xml', 'javascript', 'json', 'css', 'markdown', 'java', 'groovy', 'sql', 'shell'], languageEntries: Array.from({ length: 11 }, (_, index) => ({ role: ['python', 'html', 'xml', 'javascript', 'json', 'css', 'markdown', 'java', 'groovy', 'sql', 'shell'][index], moduleId: `module-${index}` })), budgets };
    expect(() => validatePolicy({ ...base, budgets: {} })).toThrow(/budget names/i);
    expect(() => validatePolicy({ ...base, languageEntries: base.languageEntries.slice(0, 10) })).toThrow(/mapping/i);
    expect(() => validatePolicy({ ...base, budgets: { ...budgets, 'stable-css': { rawBaseline: 3, rawMax: 2, gzipBaseline: 1, gzipMax: 2 } } })).toThrow(/malformed budget/i);
    expect(() => validateReleaseNotes('marker only', { releaseNotesMarker: 'marker', rationale: 'required rationale' })).toThrow(/release notes/i);
  });

  it('reports raw and gzip overruns independently for every budget role', () => {
    const names = ['stable-entry-closure', 'stable-css', 'codemirror-base', 'components-html', 'dist-v2-inventory', ...['python', 'html', 'xml', 'javascript', 'json', 'css', 'markdown', 'java', 'groovy', 'sql', 'shell'].map((role) => `codemirror-language-${role}`)];
    for (const name of names) {
      const budget = { rawBaseline: 10, rawMax: 10, gzipBaseline: 10, gzipMax: 10 };
      expect(metric(name, { raw: 11, gzip: 10, files: [] }, budget)).toMatchObject({ headroom: { raw: -1, gzip: 0 } });
      expect(metric(name, { raw: 10, gzip: 11, files: [] }, budget)).toMatchObject({ headroom: { raw: 0, gzip: -1 } });
    }
  });
});
