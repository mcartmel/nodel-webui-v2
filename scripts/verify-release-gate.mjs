import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateComponentContractArtifact } from './deployment-contract.mjs';

const dist = resolve(process.cwd(), 'dist');
const entryPages = ['components.html', 'index.htm', 'nodel.html', 'nodes.html', 'toolkit.html'];
const corePages = ['nodel.html', 'nodes.html', 'toolkit.html'];

export function validateAuthoredPageScaffold(scaffold, distPaths) {
  if (typeof scaffold !== 'string') throw new Error('Authored page scaffold artifact is not text');
  const theme = scaffold.indexOf('<script>');
  const css = scaffold.indexOf('<link rel="stylesheet" href="./v2/nodel-webui.css"');
  const script = scaffold.indexOf('<script type="module" src="./v2/nodel-webui.js"');
  if (theme < 0 || css < 0 || script < 0 || !(theme < css && css < script)) {
    throw new Error('Authored page scaffold must load theme bootstrap, stable CSS, then module JavaScript');
  }
  const paths = distPaths instanceof Set ? distPaths : new Set(distPaths);
  for (const path of ['v2/nodel-webui.css', 'v2/nodel-webui.js']) {
    if (!paths.has(path)) throw new Error(`Authored page scaffold references missing dist asset: ${path}`);
  }
  return true;
}

function staticImportSpecifiers(source) {
  return [
    ...Array.from(source.matchAll(/\bimport\s*["']([^"']+)["']/g), (match) => match[1]),
    ...Array.from(source.matchAll(/\b(?:import|export)\s*[^;"']*?\bfrom\s*["']([^"']+)["']/g), (match) => match[1])
  ];
}

async function eagerEntryClosure(entry, distRoot = dist) {
  const pending = [entry];
  const sources = new Map();
  while (pending.length) {
    const path = pending.pop();
    if (sources.has(path)) continue;
    const source = await readFile(join(distRoot, path), 'utf8');
    sources.set(path, source);
    for (const specifier of staticImportSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      const target = resolve(dirname(join(distRoot, path)), specifier);
      const targetPath = relative(distRoot, target).split(sep).join('/');
      if (!targetPath || targetPath.startsWith('../')) throw new Error(`Eager entry import escapes dist: ${path} -> ${specifier}`);
      pending.push(targetPath);
    }
  }
  return sources;
}

export async function verifyReleaseGate({ distRoot = dist } = {}) {
  for (const page of entryPages) {
    await access(join(distRoot, page));
  }
  await access(join(distRoot, 'v2/nodel-webui.css'));
  await access(join(distRoot, 'v2/nodel-webui.js'));
  const packageMetadata = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'));
  const componentContract = await readFile(join(distRoot, 'v2/nodel-components.json'));
  const componentContractDocument = validateComponentContractArtifact(componentContract, packageMetadata.version);
  const scaffoldSource = await readFile(resolve(process.cwd(), 'src/editor/authored-page-scaffold.ts'), 'utf8');
  validateAuthoredPageScaffold(scaffoldSource, ['v2/nodel-webui.css', 'v2/nodel-webui.js']);
  const eagerSources = await eagerEntryClosure('v2/nodel-webui.js', distRoot);
  const descriptiveMarkers = [
    ...componentContractDocument.elements.map((element) => element.description),
    ...componentContractDocument.elements.flatMap((element) => element.attributes.flatMap((attribute) => [attribute.description, attribute.defaultDescription, attribute.legacy, attribute.syntax])),
    ...componentContractDocument.elements.flatMap((element) => element.events.flatMap((event) => [event.description])),
    ...componentContractDocument.commonAttributes.flatMap((attribute) => [attribute.description, attribute.defaultDescription, attribute.legacy, attribute.syntax]),
    ...Object.values(componentContractDocument.styles).flat().map((style) => style.description)
  ].filter((value) => typeof value === 'string').filter((value, index, values) => value.length >= 24 && values.indexOf(value) === index);
  for (const [path, source] of eagerSources) {
    const marker = descriptiveMarkers.find((description) => source.includes(description));
    if (marker) throw new Error(`Canonical descriptive component contract leaked into eager runtime closure file ${path}`);
  }

  const components = await readFile(join(distRoot, 'components.html'), 'utf8');
  const runtimeMarkers = components.match(/data-nodel-runtime=["']memory["']/g) ?? [];
  if (runtimeMarkers.length !== 1) {
    throw new Error(`components.html must contain exactly one in-memory runtime marker; found ${runtimeMarkers.length}`);
  }
  if (!/<nodel-app(?:\s|>)/.test(components) || /<nodel-app[^>]*offline-mode=["']overlay["']/.test(components)) {
    throw new Error('components.html must retain the authored-page modal default');
  }

  for (const page of corePages) {
    const content = await readFile(join(distRoot, page), 'utf8');
    if (!/<nodel-app[^>]*offline-mode=["']overlay["']/.test(content)) {
      throw new Error(`${page} must explicitly use offline-mode="overlay"`);
    }
  }

  for (const page of entryPages.filter((page) => page.endsWith('.html'))) {
    const content = await readFile(join(distRoot, page), 'utf8');
    if (/\/src\/main\.ts|\/assets\//.test(content)) {
      throw new Error(`${page} contains a development or unstable asset path`);
    }
  }

  const topLevel = new Set(await readdir(distRoot));
  for (const retired of ['elements.html', 'example.html']) {
    if (topLevel.has(retired)) {
      throw new Error(`Build contains retired page ${retired}`);
    }
  }

}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyReleaseGate().then(() => {
    console.log('Release gate verified entry pages, component contract, runtime marker, stable assets, offline modes, and authored-page scaffold.');
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
