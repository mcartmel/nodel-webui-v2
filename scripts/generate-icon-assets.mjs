import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import packageMetadata from '../package.json' with { type: 'json' };
import { generateIconArtifacts } from './icon-artifact.mjs';
import { enrichFontAwesomeIcons, loadPinnedFreeFontAwesomeMetadata } from './fontawesome-metadata.mjs';

const root = resolve(process.cwd());
const output = resolve(root, 'build/icon-assets/free');
const aliases = { action: 'person-running', arrow: 'arrow-right', event: 'traffic-light', info: 'circle-info', mute: 'volume-xmark', power: 'power-off', success: 'circle-check', volume: 'volume-high', warning: 'triangle-exclamation' };
const packageNames = ['@fortawesome/free-brands-svg-icons', '@fortawesome/free-regular-svg-icons', '@fortawesome/free-solid-svg-icons'];

function definitions(module) { return Object.values(module).filter(value => value && typeof value === 'object' && Array.isArray(value.icon)); }
async function load(name) { return import(name); }
export async function generateFreeIconAssets({ outputRoot = output } = {}) {
  const modules = await Promise.all(packageNames.map(load));
  const metadataSource = await loadPinnedFreeFontAwesomeMetadata(root);
  const withMetadata = module => enrichFontAwesomeIcons(definitions(module), metadataSource.metadata);
  const families = [
    { family: 'brands', defaultStyle: 'brands', styles: [{ style: 'brands', icons: withMetadata(modules[0]) }] },
    { family: 'classic', defaultStyle: 'solid', styles: [{ style: 'regular', icons: withMetadata(modules[1]) }, { style: 'solid', icons: withMetadata(modules[2]) }] }
  ];
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
  const sources = [...packageNames, metadataSource.package].sort().map(name => ({ package: name, version: name === metadataSource.package ? metadataSource.version : lock.packages[`node_modules/${name}`].version }));
  const artifact = generateIconArtifacts({ packageVersion: packageMetadata.version, sources, aliases, families });
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  for (const [path, bytes] of artifact.files) { const target = resolve(outputRoot, path); await mkdir(resolve(target, '..'), { recursive: true }); await writeFile(target, bytes); }
  await writeFile(resolve(outputRoot, 'generation-report.json'), `${JSON.stringify(artifact.report, null, 2)}\n`);
  return artifact;
}

if (process.argv[1]?.endsWith('generate-icon-assets.mjs')) generateFreeIconAssets().catch(error => { console.error(error.message); process.exitCode = 1; });
