// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyBundleBudget } from '../scripts/verify-bundle-budget.mjs';

const roles = ['python', 'html', 'xml', 'javascript', 'json', 'css', 'markdown', 'java', 'groovy', 'sql', 'shell'];
const moduleIds = [
  'node_modules/@codemirror/lang-python/dist/index.js', 'src/editor/nodel-html-document-support.ts', 'src/editor/nodel-xml-document-support.ts',
  'node_modules/@codemirror/lang-javascript/dist/index.js', 'node_modules/@codemirror/lang-json/dist/index.js', 'node_modules/@codemirror/lang-css/dist/index.js',
  'node_modules/@codemirror/lang-markdown/dist/index.js', 'node_modules/@codemirror/lang-java/dist/index.js', 'node_modules/@codemirror/legacy-modes/mode/groovy.js',
  'node_modules/@codemirror/lang-sql/dist/index.js', 'node_modules/@codemirror/legacy-modes/mode/shell.js'
];
const budgetNames = ['stable-entry-closure', 'stable-css', 'codemirror-base', ...roles.map((role) => `codemirror-language-${role}`), 'components-html', 'free-icon-artifact', 'dist-v2-inventory'];
type BudgetResult = { reports: Array<{ name: string; actual: { raw: number; gzip: number } }> };
type Budget = { rawBaseline: number; rawMax: number; gzipBaseline: number; gzipMax: number };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nodel-stage5-'));
  await mkdir(join(root, 'dist/v2'), { recursive: true });
  const files = new Map<string, string>();
  const add = async (path: string, content: string) => { files.set(path, content); await mkdir(dirname(join(root, 'dist', path)), { recursive: true }); await writeFile(join(root, 'dist', path), content); };
  await add('v2/nodel-webui.js', 'stable');
  await add('v2/main.js', 'main');
  await add('v2/nodel-webui.css', 'css');
  await add('components.html', 'catalogue');
  const outputs: Array<Record<string, unknown>> = [
    { path: 'v2/nodel-webui.js', type: 'chunk', modules: [], imports: ['v2/main.js'], dynamicImports: [], facadeModuleId: 'src/main.ts' },
    { path: 'v2/main.js', type: 'chunk', modules: ['src/main.ts'], imports: [], dynamicImports: [], facadeModuleId: null },
    { path: 'v2/nodel-webui.css', type: 'asset', modules: [], imports: [], dynamicImports: [], facadeModuleId: null }
  ];
  const languageEntries = [];
  for (const [index, role] of roles.entries()) {
    const path = `v2/${role}.js`;
    await add(path, role);
    languageEntries.push({ role, moduleId: moduleIds[index] });
    outputs.push({ path, type: 'chunk', modules: [`${moduleIds[index]}`], imports: [], dynamicImports: [], facadeModuleId: moduleIds[index] });
  }
  await add('v2/codemirror.js', 'base');
  await add('v2/nodel-icons.json', '{"schemaVersion":1,"profile":"free"}\n');
  await add('v2/icons/fixture-shard.json', '{"schemaVersion":1,"profile":"free","family":"classic","style":"solid","bucket":0,"records":[]}\n');
  outputs.push({ path: 'v2/codemirror.js', type: 'chunk', modules: ['src/editor/codemirror-editor.ts'], imports: [], dynamicImports: languageEntries.map((entry) => `v2/${entry.role}.js`), facadeModuleId: null });
  for (const output of outputs) output.bytes = (await readFile(join(root, 'dist', String(output.path)))).byteLength;
  const graph = { schemaVersion: 1, outputs };
  const budgets = Object.fromEntries(budgetNames.map((name) => [name, { rawBaseline: 0, rawMax: 1000000, gzipBaseline: 0, gzipMax: 1000000 }]));
  const policy = { schemaVersion: 1, releaseNotesMarker: 'STAGE5_TEST_MARKER_01', rationale: 'A bounded temporary test rationale for Stage 5.', codeMirrorBaseModuleId: 'src/editor/codemirror-editor.ts', languageRoles: roles, languageEntries, budgets };
  await writeFile(join(root, 'build-graph.json'), JSON.stringify(graph));
  await writeFile(join(root, 'performance-budgets.json'), JSON.stringify(policy));
  await writeFile(join(root, 'RELEASE_NOTES.md'), `${policy.releaseNotesMarker}\n${policy.rationale}\n`);
  return { root, graph, policy, cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe('Stage 5 temporary-root verifier', () => {
  it('passes, reports, and leaves policy unchanged without an updater', async () => {
    const test = await fixture();
    try {
      const before = await readFile(join(test.root, 'performance-budgets.json'));
      const result = await verifyBundleBudget({ projectRoot: test.root, graphPath: 'build-graph.json', reportDir: 'reports' }) as BudgetResult;
       expect(result.reports).toHaveLength(17);
      const firstReport = await readFile(join(test.root, 'reports/bundle-budget.md'), 'utf8');
      expect(firstReport).toContain('raw baseline');
      expect(firstReport).toContain('gzip baseline');
      for (const name of budgetNames) expect(firstReport).toContain(`- ${name}:`);
      expect(firstReport).not.toContain(test.root);
      expect(firstReport).not.toMatch(/timestamp|createdAt|generatedAt/i);
      await verifyBundleBudget({ projectRoot: test.root, graphPath: 'build-graph.json', reportDir: 'reports' });
      expect(await readFile(join(test.root, 'reports/bundle-budget.md'), 'utf8')).toBe(firstReport);
      expect(await readFile(join(test.root, 'performance-budgets.json'))).toEqual(before);
    } finally { await test.cleanup(); }
  });

  it.each([
    ['malformed graph', (test: Awaited<ReturnType<typeof fixture>>) => { test.graph.outputs[0]!.bytes = 'bad'; }],
    ['duplicate output', (test: Awaited<ReturnType<typeof fixture>>) => { test.graph.outputs.push({ ...test.graph.outputs[0] }); }],
    ['path escape', (test: Awaited<ReturnType<typeof fixture>>) => { test.graph.outputs[0]!.path = '../escape.js'; }],
    ['missing edge', (test: Awaited<ReturnType<typeof fixture>>) => { test.graph.outputs[0]!.imports = ['v2/missing.js']; }],
    ['cycle', (test: Awaited<ReturnType<typeof fixture>>) => { test.graph.outputs[1]!.imports = ['v2/nodel-webui.js']; }]
  ])('rejects %s in a temporary root', async (_name, mutate) => {
    const test = await fixture();
    try {
      mutate(test);
      await writeFile(join(test.root, 'build-graph.json'), JSON.stringify(test.graph));
      await expect(verifyBundleBudget({ projectRoot: test.root, graphPath: 'build-graph.json', enforce: false })).rejects.toThrow();
    } finally { await test.cleanup(); }
  });

  it.each(['missing base', 'ambiguous base'])('rejects %s mapping/role', async (kind) => {
    const test = await fixture();
    try {
      if (kind === 'missing base') test.graph.outputs = test.graph.outputs.filter((output) => output.path !== 'v2/codemirror.js');
      else {
        await writeFile(join(test.root, 'dist/v2/codemirror-2.js'), 'base');
        test.graph.outputs.push({ ...test.graph.outputs.find((output) => output.path === 'v2/codemirror.js'), path: 'v2/codemirror-2.js', bytes: 4 });
      }
      await writeFile(join(test.root, 'build-graph.json'), JSON.stringify(test.graph));
      await writeFile(join(test.root, 'performance-budgets.json'), JSON.stringify(test.policy));
      await expect(verifyBundleBudget({ projectRoot: test.root, graphPath: 'build-graph.json', enforce: false })).rejects.toThrow(/CodeMirror base chunk/);
    } finally { await test.cleanup(); }
  });

  it.each(roles)('rejects a missing %s dynamic role with valid policy and files', async (role) => {
    const test = await fixture();
    try {
      const base = test.graph.outputs.find((output) => output.path === 'v2/codemirror.js')!;
      base.dynamicImports = (base.dynamicImports as string[]).filter((path) => path !== `v2/${role}.js`);
      await writeFile(join(test.root, 'build-graph.json'), JSON.stringify(test.graph));
      await expect(verifyBundleBudget({ projectRoot: test.root, graphPath: 'build-graph.json', enforce: false })).rejects.toThrow(new RegExp(`dynamic CodeMirror entry for ${role}, found 0`));
    } finally { await test.cleanup(); }
  });

  it.each(roles)('rejects an ambiguous %s dynamic role with valid policy and files', async (role) => {
    const test = await fixture();
    try {
      const base = test.graph.outputs.find((output) => output.path === 'v2/codemirror.js')!;
      const source = test.graph.outputs.find((output) => output.path === `v2/${role}.js`)!;
      const duplicatePath = `v2/${role}-duplicate.js`;
      await writeFile(join(test.root, 'dist', duplicatePath), role);
      test.graph.outputs.push({ ...source, path: duplicatePath });
      base.dynamicImports = [...(base.dynamicImports as string[]), duplicatePath];
      await writeFile(join(test.root, 'build-graph.json'), JSON.stringify(test.graph));
      await expect(verifyBundleBudget({ projectRoot: test.root, graphPath: 'build-graph.json', enforce: false })).rejects.toThrow(new RegExp(`dynamic CodeMirror entry for ${role}, found 2`));
    } finally { await test.cleanup(); }
  });

  it('rejects stale file bytes and policy shape failures', async () => {
    const test = await fixture();
    try {
      await writeFile(join(test.root, 'dist/v2/main.js'), 'stale bytes');
      await expect(verifyBundleBudget({ projectRoot: test.root, graphPath: 'build-graph.json', enforce: false })).rejects.toThrow(/stale/i);
      (test.policy.budgets as Record<string, Budget>).extra = test.policy.budgets['stable-css']!;
      await writeFile(join(test.root, 'performance-budgets.json'), JSON.stringify(test.policy));
      await expect(verifyBundleBudget({ projectRoot: test.root, graphPath: 'build-graph.json', enforce: false })).rejects.toThrow(/budget/i);
    } finally { await test.cleanup(); }
  });

  it('enforces raw and gzip maxima independently for every role', async () => {
    const test = await fixture();
    try {
      const result = await verifyBundleBudget({ projectRoot: test.root, graphPath: 'build-graph.json', enforce: false }) as BudgetResult;
      for (const report of result.reports) {
        const budget = (test.policy.budgets as Record<string, Budget>)[report.name]!;
        budget.rawMax = report.actual.raw - 1;
        await writeFile(join(test.root, 'performance-budgets.json'), JSON.stringify(test.policy));
        const rawFailurePolicy = await readFile(join(test.root, 'performance-budgets.json'));
        await expect(verifyBundleBudget({ projectRoot: test.root, graphPath: 'build-graph.json' })).rejects.toThrow(new RegExp(`${report.name} raw`));
        expect(await readFile(join(test.root, 'performance-budgets.json'))).toEqual(rawFailurePolicy);
        budget.rawMax = 1000000;
        budget.gzipMax = report.actual.gzip - 1;
        await writeFile(join(test.root, 'performance-budgets.json'), JSON.stringify(test.policy));
        await expect(verifyBundleBudget({ projectRoot: test.root, graphPath: 'build-graph.json' })).rejects.toThrow(new RegExp(`${report.name} gzip`));
        budget.gzipMax = 1000000;
      }
    } finally { await test.cleanup(); }
  });
});
