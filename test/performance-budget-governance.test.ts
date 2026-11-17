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
  'stable-entry-closure': [386548, 405876, 104552, 109780],
  'stable-css': [178790, 187730, 23434, 23903],
  'codemirror-base': [411183, 431743, 133409, 140080],
  'codemirror-language-python': [71704, 75290, 27989, 29389],
  'codemirror-language-html': [271633, 285215, 92689, 97324],
  'codemirror-language-xml': [144439, 151661, 42638, 44770],
  'codemirror-language-javascript': [111238, 116800, 42326, 44443],
  'codemirror-language-json': [28617, 30048, 10118, 10624],
  'codemirror-language-css': [53800, 56490, 21113, 22169],
  'codemirror-language-markdown': [211327, 221894, 81617, 85698],
  'codemirror-language-java': [74801, 78542, 28280, 29694],
  'codemirror-language-groovy': [4139, 4346, 1765, 1854],
  'codemirror-language-sql': [40595, 42625, 14926, 15673],
  'codemirror-language-shell': [2571, 2700, 1214, 1275],
  'components-html': [175483, 184258, 20145, 21153],
  'free-icon-artifact': [8615311, 9046077, 1950455, 2047978],
  'dist-v2-inventory': [11348518, 11580000, 2738723, 2795000]
} as const;

describe('Stage 5 performance budget governance', () => {
  it('pins schema, roles, reviewed baselines, maxima, and release-note evidence', async () => {
    const policy = JSON.parse(await readFile('performance-budgets.json', 'utf8')) as { schemaVersion: number; releaseNotesMarker: string; rationale: string; codeMirrorBaseModuleId: string; languageRoles: string[]; languageEntries: Array<{ role: string; moduleId: string }>; budgets: Record<string, { rawBaseline: number; rawMax: number; gzipBaseline: number; gzipMax: number }> };
    const notes = await readFile('RELEASE_NOTES.md', 'utf8');
    expect(policy.schemaVersion).toBe(1);
    expect(policy.codeMirrorBaseModuleId).toBe('src/editor/codemirror-editor.ts');
    expect(policy.languageRoles).toEqual(roles);
    expect(policy.languageEntries.map((entry) => [entry.role, entry.moduleId])).toEqual(languageEntries);
    expect(policy.releaseNotesMarker).toBe('APPROVED_PARSER_DEPENDENCIES_2026-11-17');
    expect(policy.releaseNotesMarker.length).toBeGreaterThan(10);
    expect(policy.rationale.length).toBeGreaterThanOrEqual(20);
    expect(policy.rationale.length).toBeLessThanOrEqual(500);
    expect(Object.keys(policy.budgets).sort()).toEqual(Object.keys(expected).sort());
    expect(notes).toContain(policy.releaseNotesMarker);
    expect(notes).toContain(policy.rationale);
    expect(policy.rationale).toBe('CI run 43994373770 measured Java at 74801 raw / 28280 gzip bytes and XML at 151378 raw / 42638 gzip bytes. Upstream @lezer/java 1.1.3->1.1.5 contributes 7021 raw / 2598 gzip bytes to Java, and @lezer/lr 1.4.10->1.4.12 contributes approximately 445 raw / 120 gzip bytes to XML; these grammar and reuse fixes are retained rather than pinned or rolled back. Only Java raw/gzip and XML gzip baselines are updated with five percent headroom; all other baselines and limits remain unchanged.');
    expect(notes).toContain('APPROVED_MDI_OFFLINE_ASSETS_2026-11-16');
    expect(notes).toContain('only free-icon-artifact');
    expect(notes).toContain('dist-v2-inventory');
    expect(notes).toContain('All initial JavaScript, CSS, editor, and other metric baselines and limits remain unchanged');
    expect(notes).toContain('APPROVED_PARSER_DEPENDENCIES_2026-11-17');
    expect(notes).toContain(policy.rationale);
    for (const [name, values] of Object.entries(expected)) {
      const budget = policy.budgets[name];
      if (!budget) throw new Error(`Missing budget ${name}`);
      expect([budget.rawBaseline, budget.rawMax, budget.gzipBaseline, budget.gzipMax]).toEqual(values);
      if (name === 'dist-v2-inventory') {
        expect(budget.rawMax).toBe(Math.ceil(budget.rawBaseline * 1.02 / 10000) * 10000);
        expect(budget.gzipMax).toBe(Math.ceil(budget.gzipBaseline * 1.02 / 5000) * 5000);
      } else if (name === 'stable-css') {
        expect(budget.rawMax).toBe(Math.ceil(budget.rawBaseline * 1.05));
        expect(budget.gzipMax).toBe(Math.ceil(budget.gzipBaseline * 1.02));
      } else {
        expect(budget.rawMax).toBe(Math.ceil(budget.rawBaseline * 1.05));
        expect(budget.gzipMax).toBe(Math.ceil(budget.gzipBaseline * 1.05));
      }
    }
  });
});
