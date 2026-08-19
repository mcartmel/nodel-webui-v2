import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const compareCodeUnits = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function normalizeModuleId(value, projectRoot) {
  const raw = String(value).replaceAll('\\', '/');
  const withoutVirtual = raw.startsWith('\0') ? raw.slice(1) : raw;
  const queryIndex = withoutVirtual.indexOf('?');
  const clean = queryIndex < 0 ? withoutVirtual : withoutVirtual.slice(0, queryIndex);
  if (raw.startsWith('\0')) {
    const marker = '/node_modules/';
    const nodeModules = clean.indexOf(marker);
    const result = nodeModules >= 0 ? `node_modules/${clean.slice(nodeModules + marker.length)}` : `virtual/${clean.replace(/^\/+/, '')}`;
    if (!result || result.split('/').includes('..') || result.startsWith('/')) throw new Error(`Unsafe virtual module ID: ${value}`);
    return result;
  }
  const absolute = resolve(clean);
  const result = relative(projectRoot, absolute).split(sep).join('/');
  if (!result || result === '..' || result.startsWith('../') || result.startsWith('/')) throw new Error(`Bundle graph module escapes project: ${value}`);
  return result;
}

export function normalizeOutputPath(value) {
  const path = String(value).replaceAll('\\', '/');
  if (!path || path.startsWith('/') || path.split('/').includes('..') || path.split('/').includes('')) throw new Error(`Unsafe bundle output path: ${path}`);
  return path;
}

export function normalizeRollupBundle(bundle, projectRoot) {
  if (!bundle || typeof bundle !== 'object') throw new Error('Rollup bundle must be an object');
  const outputs = Object.entries(bundle).map(([fileName, item]) => {
    if (!item || (item.type !== 'asset' && item.type !== 'chunk')) throw new Error(`Malformed Rollup output: ${fileName}`);
    const path = normalizeOutputPath(fileName);
    if (item.type === 'asset') {
      if (typeof item.source !== 'string' && !Buffer.isBuffer(item.source)) throw new Error(`Malformed asset output: ${fileName}`);
      return { path, type: 'asset', bytes: Buffer.byteLength(item.source), facadeModuleId: null, modules: [], imports: [], dynamicImports: [] };
    }
    if (typeof item.code !== 'string' || !item.modules || !Array.isArray(item.imports) || !Array.isArray(item.dynamicImports)) throw new Error(`Malformed chunk output: ${fileName}`);
    return {
      path,
      type: 'chunk',
      bytes: Buffer.byteLength(item.code),
      facadeModuleId: item.facadeModuleId ? normalizeModuleId(item.facadeModuleId, projectRoot) : null,
      modules: Object.keys(item.modules).map((id) => normalizeModuleId(id, projectRoot)).sort(compareCodeUnits),
      imports: item.imports.map(normalizeOutputPath).sort(compareCodeUnits),
      dynamicImports: item.dynamicImports.map(normalizeOutputPath).sort(compareCodeUnits)
    };
  });
  const paths = new Set();
  for (const output of outputs) {
    if (paths.has(output.path)) throw new Error(`Duplicate bundle graph output: ${output.path}`);
    paths.add(output.path);
  }
  outputs.sort((left, right) => compareCodeUnits(left.path, right.path));
  return { schemaVersion: 1, outputs };
}

export function finalizeBundleGraph(graph, presentPaths, expectedPaths = graph.outputs.map((output) => output.path)) {
  const present = new Set([...presentPaths].map(normalizeOutputPath));
  for (const path of expectedPaths) if (!present.has(path)) throw new Error(`Rollup output was not written: ${path}`);
  const outputs = graph.outputs.filter((output) => present.has(output.path)).map((output) => ({ ...output }));
  return { ...graph, outputs: outputs.sort((left, right) => compareCodeUnits(left.path, right.path)) };
}

export async function writeBundleGraph(graph, reportPath = resolve(process.cwd(), 'build/bundle-graph.json')) {
  const target = resolve(reportPath);
  await mkdir(resolve(target, '..'), { recursive: true });
  await writeFile(target, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
}

export function bundleGraphPlugin(projectRoot, outputRoot = resolve(projectRoot, 'dist'), reportPath = resolve(projectRoot, 'build/bundle-graph.json')) {
  let graph;
  return {
    name: 'nodel-bundle-graph',
    generateBundle(_options, bundle) {
      graph = normalizeRollupBundle(bundle, projectRoot);
    },
    async writeBundle() {
      const presentPaths = new Set();
      for (const output of graph.outputs) {
        if (/^v2\/entries\/(?:nodel|nodes|toolkit)\.js$/.test(output.path)) continue;
        const source = await readFile(resolve(outputRoot, output.path));
        presentPaths.add(output.path);
        output.bytes = source.byteLength;
      }
      const cssPath = 'v2/nodel-webui.css';
      try {
        const source = await readFile(resolve(outputRoot, cssPath));
        presentPaths.add(cssPath);
        if (!graph.outputs.some((output) => output.path === cssPath)) graph.outputs.push({ path: cssPath, type: 'asset', bytes: source.byteLength, facadeModuleId: null, modules: [], imports: [], dynamicImports: [] });
      } catch (error) {
        throw new Error(`Expected CSS output was not written: ${cssPath}`, { cause: error });
      }
      // Vite consumes the unused HTML entry chunks after Rollup renders pages.
      const expectedPaths = graph.outputs.map((output) => output.path).filter((path) => !/^v2\/entries\/(?:nodel|nodes|toolkit)\.js$/.test(path));
      graph = finalizeBundleGraph(graph, presentPaths, expectedPaths);
      await writeBundleGraph(graph, reportPath);
    }
  };
}
