import { gzipSync } from 'node:zlib';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const languageRoles = ['python', 'html', 'xml', 'javascript', 'json', 'css', 'markdown', 'java', 'groovy', 'sql', 'shell'];
const budgetNames = ['stable-entry-closure', 'stable-css', 'codemirror-base', ...languageRoles.map((role) => `codemirror-language-${role}`), 'components-html', 'free-icon-artifact', 'dist-v2-inventory'];
const compareCodeUnits = (left, right) => left < right ? -1 : left > right ? 1 : 0;

const safe = (value, label) => {
  const normalized = String(value).replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) throw new Error(`${label} is unsafe: ${normalized}`);
  return normalized;
};
const distFile = (dist, path) => resolve(dist, safe(path, 'dist path'));
async function bytes(dist, path) { return readFile(distFile(dist, path)); }
export async function measureFiles(paths, read = (path) => readFile(path)) {
  const unique = [...new Set(paths)].sort(compareCodeUnits);
  const contents = await Promise.all(unique.map(read));
  const raw = contents.reduce((sum, value) => sum + value.byteLength, 0);
  const compressed = contents.reduce((sum, value) => sum + gzipSync(value, { level: 9, mtime: 0 }).byteLength, 0);
  return { files: unique, raw, gzip: compressed };
}
export function traverseBundleGraph(graph, start, edge = 'imports', seen = new Set(), active = []) {
  const cycleStart = active.indexOf(start);
  if (cycleStart >= 0) throw new Error(`Bundle graph static import cycle: ${[...active.slice(cycleStart), start].join(' -> ')}`);
  if (seen.has(start)) return seen;
  const output = graph.outputs.find((item) => item.path === start);
  if (!output) throw new Error(`Bundle graph references missing output: ${start}`);
  active.push(start);
  for (const next of output[edge]) traverseBundleGraph(graph, next, edge, seen, active);
  active.pop();
  seen.add(start);
  return seen;
}
async function inventory(dist) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(relative(dist, path).split(sep).join('/'));
      else throw new Error(`Unsupported dist inventory entry: ${path}`);
    }
  }
  await visit(resolve(dist, 'v2'));
  return result.sort(compareCodeUnits);
}
export function validatePolicy(policy) {
  if (policy?.schemaVersion !== 1 || typeof policy.releaseNotesMarker !== 'string' || policy.releaseNotesMarker.length < 10 || policy.releaseNotesMarker.length > 100 || /\s/.test(policy.releaseNotesMarker) || typeof policy.rationale !== 'string' || policy.rationale.length < 20 || policy.rationale.length > 500) throw new Error('Malformed performance budget policy');
  if (!Array.isArray(policy.languageRoles) || JSON.stringify(policy.languageRoles) !== JSON.stringify(languageRoles)) throw new Error('Performance budget language roles are not the approved 11 roles');
  if (policy.codeMirrorBaseModuleId !== 'src/editor/codemirror-editor.ts' || !Array.isArray(policy.languageEntries) || policy.languageEntries.length !== languageRoles.length) throw new Error('Malformed CodeMirror role mapping');
  for (const [index, entry] of policy.languageEntries.entries()) {
    if (!entry || entry.role !== languageRoles[index] || typeof entry.moduleId !== 'string' || !entry.moduleId || entry.moduleId.startsWith('/') || entry.moduleId.split('/').includes('..')) throw new Error(`Malformed CodeMirror role mapping at ${index}`);
  }
  if (new Set(policy.languageEntries.map((entry) => entry.moduleId)).size !== languageRoles.length) throw new Error('CodeMirror role mapping contains duplicate module IDs');
  for (const [name, budget] of Object.entries(policy.budgets ?? {})) {
    if (!budget || !Number.isInteger(budget.rawBaseline) || !Number.isInteger(budget.rawMax) || !Number.isInteger(budget.gzipBaseline) || !Number.isInteger(budget.gzipMax) || budget.rawBaseline < 0 || budget.gzipBaseline < 0 || budget.rawBaseline > budget.rawMax || budget.gzipBaseline > budget.gzipMax) throw new Error(`Malformed budget: ${name}`);
  }
  if (!policy.budgets || JSON.stringify(Object.keys(policy.budgets).sort(compareCodeUnits)) !== JSON.stringify([...budgetNames].sort(compareCodeUnits))) throw new Error('Performance budget names are incomplete or unexpected');
}
function validateGraph(graph) {
  if (!graph || graph.schemaVersion !== 1 || !Array.isArray(graph.outputs)) throw new Error('Malformed bundle graph');
  const paths = new Set();
  for (const output of graph.outputs) {
    if (!output || (output.type !== 'asset' && output.type !== 'chunk') || typeof output.path !== 'string' || !Number.isInteger(output.bytes) || output.bytes < 0 || !Array.isArray(output.modules) || !Array.isArray(output.imports) || !Array.isArray(output.dynamicImports) || (output.facadeModuleId !== null && typeof output.facadeModuleId !== 'string')) throw new Error('Malformed bundle graph output');
    safe(output.path, 'bundle output');
    if (paths.has(output.path)) throw new Error(`Duplicate bundle graph output: ${output.path}`);
    paths.add(output.path);
    for (const id of [...output.modules, ...(output.facadeModuleId ? [output.facadeModuleId] : [])]) if (typeof id !== 'string' || !id || id.startsWith('/') || id.split('/').includes('..')) throw new Error('Malformed bundle graph module ID');
    for (const edge of [...output.imports, ...output.dynamicImports]) {
      if (typeof edge !== 'string') throw new Error('Malformed bundle graph edge');
      safe(edge, 'bundle graph edge');
    }
  }
  return paths;
}
export function validateReleaseNotes(releaseNotes, policy) {
  if (typeof releaseNotes !== 'string' || !releaseNotes.includes(policy.releaseNotesMarker) || !releaseNotes.includes(policy.rationale)) throw new Error('Release notes do not contain the approved bundle budget marker and rationale');
}
export function metric(name, actual, budget) {
  return { name, baseline: { raw: budget.rawBaseline, gzip: budget.gzipBaseline }, actual: { raw: actual.raw, gzip: actual.gzip }, delta: { raw: actual.raw - budget.rawBaseline, gzip: actual.gzip - budget.gzipBaseline }, deltaPercent: { raw: (actual.raw - budget.rawBaseline) * 100 / Math.max(1, budget.rawBaseline), gzip: (actual.gzip - budget.gzipBaseline) * 100 / Math.max(1, budget.gzipBaseline) }, max: { raw: budget.rawMax, gzip: budget.gzipMax }, headroom: { raw: budget.rawMax - actual.raw, gzip: budget.gzipMax - actual.gzip }, files: actual.files };
}
const formatPercent = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
export function formatReportLine(item) {
  return `- ${item.name}: raw baseline ${item.baseline.raw}, actual ${item.actual.raw}, delta ${item.delta.raw} (${formatPercent(item.deltaPercent.raw)}), maximum ${item.max.raw}, headroom ${item.headroom.raw}; gzip baseline ${item.baseline.gzip}, actual ${item.actual.gzip}, delta ${item.delta.gzip} (${formatPercent(item.deltaPercent.gzip)}), maximum ${item.max.gzip}, headroom ${item.headroom.gzip}`;
}
export async function verifyBundleBudget({ projectRoot = process.cwd(), distDir, graph, policy, releaseNotes, graphPath, policyPath, releaseNotesPath, reportDir, writeReport = true, enforce = true } = {}) {
  const root = resolve(projectRoot);
  const dist = resolve(root, distDir ?? 'dist');
  const loaded = await Promise.all([
    graph ?? readFile(resolve(root, graphPath ?? 'build/bundle-graph.json'), 'utf8').then(JSON.parse),
    policy ?? readFile(resolve(root, policyPath ?? 'performance-budgets.json'), 'utf8').then(JSON.parse),
    releaseNotes ?? readFile(resolve(root, releaseNotesPath ?? 'RELEASE_NOTES.md'), 'utf8')
  ]);
  [graph, policy, releaseNotes] = loaded;
  validatePolicy(policy);
  validateReleaseNotes(releaseNotes, policy);
  validateGraph(graph);
  const graphByPath = new Map(graph.outputs.map((item) => [safe(item.path, 'bundle output'), item]));
  for (const output of graph.outputs) {
    const data = await readFile(distFile(dist, output.path));
    if (data.byteLength !== output.bytes) throw new Error(`Stale bundle graph bytes for ${output.path}`);
    for (const edge of [...output.imports, ...output.dynamicImports]) if (!graphByPath.has(edge)) throw new Error(`Bundle graph edge is missing: ${output.path} -> ${edge}`);
  }
  const stable = graphByPath.get('v2/nodel-webui.js');
  const css = graphByPath.get('v2/nodel-webui.css');
  if (!stable || !css) throw new Error('Bundle graph is missing a required stable output');
  const base = graph.outputs.filter((item) => item.type === 'chunk' && item.modules.includes(policy.codeMirrorBaseModuleId));
  if (base.length !== 1) throw new Error(`Expected one CodeMirror base chunk, found ${base.length}`);
  const languageEntries = policy.languageEntries.map((entry) => {
    const matches = base[0].dynamicImports.map((path) => graphByPath.get(path)).filter((item) => item?.facadeModuleId === entry.moduleId);
    if (matches.length !== 1) throw new Error(`Expected one dynamic CodeMirror entry for ${entry.role}, found ${matches.length}`);
    return matches[0];
  });
  const reports = [];
  const stablePaths = [...traverseBundleGraph(graph, stable.path)];
  const readDist = (path) => bytes(dist, path);
  reports.push(metric('stable-entry-closure', await measureFiles(stablePaths, readDist), policy.budgets['stable-entry-closure']));
  reports.push(metric('stable-css', await measureFiles([css.path], readDist), policy.budgets['stable-css']));
  reports.push(metric('codemirror-base', await measureFiles([base[0].path], readDist), policy.budgets['codemirror-base']));
  const baseClosure = traverseBundleGraph(graph, base[0].path);
  for (const [index, role] of languageRoles.entries()) {
    const entry = languageEntries[index];
    const paths = [...traverseBundleGraph(graph, entry.path)].filter((path) => !baseClosure.has(path));
    reports.push(metric(`codemirror-language-${role}`, await measureFiles(paths, readDist), policy.budgets[`codemirror-language-${role}`]));
  }
  reports.push(metric('components-html', await measureFiles(['components.html'], readDist), policy.budgets['components-html']));
  const iconPaths = ['v2/nodel-icons.json', ...(await inventory(dist)).filter(path => path.startsWith('v2/icons/'))];
  reports.push(metric('free-icon-artifact', await measureFiles(iconPaths, readDist), policy.budgets['free-icon-artifact']));
  reports.push(metric('dist-v2-inventory', await measureFiles(await inventory(dist), readDist), policy.budgets['dist-v2-inventory']));
  const failures = reports.flatMap((report) => ['raw', 'gzip'].filter((kind) => report.actual[kind] > report.max[kind]).map((kind) => `${report.name} ${kind} exceeds maximum`));
  const markdown = `# Bundle Budget\n\n${reports.map(formatReportLine).join('\n')}`;
  const result = { schemaVersion: 1, languageEntries: Object.fromEntries(languageRoles.map((role, index) => [role, languageEntries[index].path])), reports, failures, markdown };
  if (writeReport) {
    const target = resolve(root, reportDir ?? 'build');
    await mkdir(target, { recursive: true });
    await writeFile(resolve(target, 'bundle-budget.json'), `${JSON.stringify(result, null, 2)}\n`);
    await writeFile(resolve(target, 'bundle-budget.md'), `${markdown}\n`);
  }
  if (enforce && failures.length) throw new Error(failures.join('; '));
  return result;
}
if (process.argv[1]?.endsWith('verify-bundle-budget.mjs')) verifyBundleBudget().catch((error) => { console.error(error.message); process.exitCode = 1; });
