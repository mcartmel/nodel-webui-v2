import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { validateComponentContractArtifact } from './deployment-contract.mjs';

const dist = resolve(process.cwd(), 'dist');
const entryPages = ['components.html', 'index.htm', 'nodel.html', 'nodes.html', 'toolkit.html'];
const corePages = ['nodel.html', 'nodes.html', 'toolkit.html'];

function staticImportSpecifiers(source) {
  return [
    ...Array.from(source.matchAll(/\bimport\s*["']([^"']+)["']/g), (match) => match[1]),
    ...Array.from(source.matchAll(/\b(?:import|export)\s*[^;"']*?\bfrom\s*["']([^"']+)["']/g), (match) => match[1])
  ];
}

async function eagerEntryClosure(entry) {
  const pending = [entry];
  const sources = new Map();
  while (pending.length) {
    const path = pending.pop();
    if (sources.has(path)) continue;
    const source = await readFile(join(dist, path), 'utf8');
    sources.set(path, source);
    for (const specifier of staticImportSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      const target = resolve(dirname(join(dist, path)), specifier);
      const targetPath = relative(dist, target).split(sep).join('/');
      if (!targetPath || targetPath.startsWith('../')) throw new Error(`Eager entry import escapes dist: ${path} -> ${specifier}`);
      pending.push(targetPath);
    }
  }
  return sources;
}

async function main() {
  for (const page of entryPages) {
    await access(join(dist, page));
  }
  await access(join(dist, 'v2/nodel-webui.css'));
  await access(join(dist, 'v2/nodel-webui.js'));
  const packageMetadata = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'));
  const componentContract = await readFile(join(dist, 'v2/nodel-components.json'));
  const componentContractDocument = validateComponentContractArtifact(componentContract, packageMetadata.version);
  const eagerSources = await eagerEntryClosure('v2/nodel-webui.js');
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

  const components = await readFile(join(dist, 'components.html'), 'utf8');
  const runtimeMarkers = components.match(/data-nodel-runtime=["']memory["']/g) ?? [];
  if (runtimeMarkers.length !== 1) {
    throw new Error(`components.html must contain exactly one in-memory runtime marker; found ${runtimeMarkers.length}`);
  }
  if (!/<nodel-app(?:\s|>)/.test(components) || /<nodel-app[^>]*offline-mode=["']overlay["']/.test(components)) {
    throw new Error('components.html must retain the authored-page modal default');
  }

  for (const page of corePages) {
    const content = await readFile(join(dist, page), 'utf8');
    if (!/<nodel-app[^>]*offline-mode=["']overlay["']/.test(content)) {
      throw new Error(`${page} must explicitly use offline-mode="overlay"`);
    }
  }

  for (const page of entryPages.filter((page) => page.endsWith('.html'))) {
    const content = await readFile(join(dist, page), 'utf8');
    if (/\/src\/main\.ts|\/assets\//.test(content)) {
      throw new Error(`${page} contains a development or unstable asset path`);
    }
  }

  const topLevel = new Set(await readdir(dist));
  for (const retired of ['elements.html', 'example.html']) {
    if (topLevel.has(retired)) {
      throw new Error(`Build contains retired page ${retired}`);
    }
  }

  console.log('Release gate verified entry pages, component contract, runtime marker, stable assets, and offline modes.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
