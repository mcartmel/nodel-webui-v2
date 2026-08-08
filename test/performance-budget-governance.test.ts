// @vitest-environment node

import { readFile } from 'node:fs/promises';

const roles = ['python', 'html', 'xml', 'javascript', 'json', 'css', 'markdown', 'java', 'groovy', 'sql', 'shell'];
const languageEntries = [
  ['python', 'node_modules/@codemirror/lang-python/dist/index.js'],
  ['html', 'src/editor/nodel-html-document-support.ts'],
  ['xml', 'src/editor/nodel-xml-document-support.ts'],
  ['javascript', 'node_modules/@codemirror/lang-javascript/dist/index.js'],
  ['json', 'node_modules/@codemirror/lang-json/dist/index.js'],
  ['css', 'node_modules/@codemirror/lang-css/dist/index.js'],
  ['markdown', 'node_modules/@codemirror/lang-markdown/dist/index.js'],
  ['java', 'node_modules/@codemirror/lang-java/dist/index.js'],
  ['groovy', 'node_modules/@codemirror/legacy-modes/mode/groovy.js'],
  ['sql', 'node_modules/@codemirror/lang-sql/dist/index.js'],
  ['shell', 'node_modules/@codemirror/legacy-modes/mode/shell.js']
] as const;
const expected = {
  'stable-entry-closure': [370708, 389244, 98444, 103367],
  'stable-css': [169854, 178347, 21137, 22194],
  'codemirror-base': [411183, 431743, 133409, 140080],
  'codemirror-language-python': [71704, 75290, 27989, 29389],
  'codemirror-language-html': [256111, 268917, 87809, 92200],
  'codemirror-language-xml': [130027, 136529, 36129, 37936],
  'codemirror-language-javascript': [111238, 116800, 42326, 44443],
  'codemirror-language-json': [28617, 30048, 10118, 10624],
  'codemirror-language-css': [53800, 56490, 21113, 22169],
  'codemirror-language-markdown': [211327, 221894, 81617, 85698],
  'codemirror-language-java': [67335, 70702, 25570, 26849],
  'codemirror-language-groovy': [4139, 4346, 1765, 1854],
  'codemirror-language-sql': [40595, 42625, 14926, 15673],
  'codemirror-language-shell': [2571, 2700, 1214, 1275],
  'components-html': [114502, 120228, 14072, 14776],
  'dist-v2-inventory': [2257115, 2369971, 645734, 678021]
} as const;

describe('Stage 5 performance budget governance', () => {
  it('pins schema, roles, reviewed baselines, maxima, and release-note evidence', async () => {
    const policy = JSON.parse(await readFile('performance-budgets.json', 'utf8')) as { schemaVersion: number; releaseNotesMarker: string; rationale: string; codeMirrorBaseModuleId: string; languageRoles: string[]; languageEntries: Array<{ role: string; moduleId: string }>; budgets: Record<string, { rawBaseline: number; rawMax: number; gzipBaseline: number; gzipMax: number }> };
    const notes = await readFile('RELEASE_NOTES.md', 'utf8');
    expect(policy.schemaVersion).toBe(1);
    expect(policy.codeMirrorBaseModuleId).toBe('src/editor/codemirror-editor.ts');
    expect(policy.languageRoles).toEqual(roles);
    expect(policy.languageEntries.map((entry) => [entry.role, entry.moduleId])).toEqual(languageEntries);
    expect(policy.releaseNotesMarker).toBe('STAGE5_APPROVED_BUNDLE_BASELINE_2026-08-08');
    expect(policy.releaseNotesMarker.length).toBeGreaterThan(10);
    expect(policy.rationale.length).toBeGreaterThanOrEqual(20);
    expect(policy.rationale.length).toBeLessThanOrEqual(500);
    expect(Object.keys(policy.budgets).sort()).toEqual(Object.keys(expected).sort());
    expect(notes).toContain(policy.releaseNotesMarker);
    expect(notes).toContain(policy.rationale);
    for (const [name, values] of Object.entries(expected)) {
      const budget = policy.budgets[name];
      if (!budget) throw new Error(`Missing budget ${name}`);
      expect([budget.rawBaseline, budget.rawMax, budget.gzipBaseline, budget.gzipMax]).toEqual(values);
      expect(budget.rawMax).toBe(Math.ceil(budget.rawBaseline * 1.05));
      expect(budget.gzipMax).toBe(Math.ceil(budget.gzipBaseline * 1.05));
    }
  });
});
