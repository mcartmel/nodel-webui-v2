import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import packageMetadata from '../package.json' with { type: 'json' };
import { generateIconArtifacts, isExactSemVer, normalizeIconRecord, semVerMajor, validateIconArtifact } from './icon-artifact.mjs';
import { enrichFontAwesomeIcons, loadPinnedFreeFontAwesomeMetadata, parseFontAwesomeMetadataYaml } from './fontawesome-metadata.mjs';
import { verifyReleaseGate as verifyReleaseGateApi } from './verify-release-gate.mjs';
import { assertNoSymlinkAncestors, isInside, projectRoot } from './deployment-contract.mjs';

const execFileAsync = promisify(execFile);
const proPackageName = '@fortawesome/fontawesome-pro';
const freeBrandsPackageName = '@fortawesome/free-brands-svg-icons';
const iconAliases = { action: 'person-running', arrow: 'arrow-right', event: 'traffic-light', info: 'circle-info', mute: 'volume-xmark', power: 'power-off', success: 'circle-check', volume: 'volume-high', warning: 'triangle-exclamation' };
const proAssetRoot = resolve(projectRoot, 'build/icon-assets/pro-local');
const proWorkspaceRoot = resolve(projectRoot, 'build/pro-workspace');
const proDistRoot = resolve(projectRoot, 'build/pro-dist');
const viteBinary = resolve(projectRoot, 'node_modules/vite/bin/vite.js');
const proStyles = ['solid', 'regular', 'light', 'thin'];
// FA7 all-inclusive archives organise SVGs by style, not by family. These are
// the only flat directory names accepted from that distribution.
const flatSvgLayouts = new Map([
  ['brands', { family: 'brands', style: 'brands' }],
  ...proStyles.map(style => [style, { family: 'classic', style }]),
  // FA archives have used both the bare and explicit solid names.
  ['duotone', { family: 'duotone', style: 'solid' }],
  ...proStyles.map(style => [`duotone-${style}`, { family: 'duotone', style }]),
  ...proStyles.map(style => [`sharp-${style}`, { family: 'sharp', style }]),
  ['sharp-duotone', { family: 'sharp-duotone', style: 'solid' }],
  ...proStyles.map(style => [`sharp-duotone-${style}`, { family: 'sharp-duotone', style }])
]);
const nestedSvgLayouts = new Map([
  ['classic', { family: 'classic', styles: new Set(proStyles) }],
  ['duotone', { family: 'duotone', styles: new Set(proStyles) }],
  ['sharp', { family: 'sharp', styles: new Set(proStyles) }],
  ['sharp-duotone', { family: 'sharp-duotone', styles: new Set(proStyles) }]
]);
const requiredProFamilies = new Map([
  ['classic', new Set(['solid', 'regular', 'light', 'thin'])],
  ['duotone', new Set(['solid', 'regular', 'light', 'thin'])],
  ['sharp', new Set(['solid', 'regular', 'light', 'thin'])],
  ['sharp-duotone', new Set(['solid', 'regular', 'light', 'thin'])]
]);

function compare(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function exactVersion(value, label = 'Font Awesome version') {
  if (!isExactSemVer(value)) throw new Error(`${label} must be an exact SemVer version`);
  return value;
}
function sameMajor(left, right) {
  return semVerMajor(exactVersion(left)) === semVerMajor(exactVersion(right));
}
function safeToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9._~-]{1,4096}$/.test(token)) throw new Error('Font Awesome package credential is malformed');
  return token;
}
function ownRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export function redactProError(error, token) {
  let message = error instanceof Error ? error.message : String(error);
  if (typeof token === 'string' && token) message = message.split(token).join('[redacted]');
  return message.replace(/((?:_authToken|token)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]');
}

export function parseProBuildArgs(argv, { defaultVersion } = {}) {
  let version = defaultVersion;
  let seenVersion = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== '--version' || seenVersion) throw new Error(`Unknown or duplicate Pro build argument: ${argument}`);
    version = argv[++index];
    if (!version || version.startsWith('--')) throw new Error('Missing value for --version');
    seenVersion = true;
  }
  return { version: exactVersion(version) };
}

export function sanitizeProChildEnvironment(environment, additions = {}) {
  const result = {};
  for (const [key, value] of Object.entries(environment)) {
    const normalized = key.toLowerCase();
    if (normalized === 'fontawesome_package_token' || normalized === 'nodel_fontawesome_pro_dir'
      || normalized === 'npm_token' || normalized === 'npm_auth_token' || normalized === 'node_auth_token'
      || normalized.startsWith('vite_') || normalized.startsWith('npm_config_')) continue;
    if (typeof value === 'string') result[key] = value;
  }
  return { ...result, ...additions };
}

export function privateNpmConfig(token) {
  return `@fortawesome:registry=https://npm.fontawesome.com/\n//npm.fontawesome.com/:_authToken=${safeToken(token)}\nalways-auth=true\n`;
}

export async function publicFontAwesomeVersion(root = projectRoot) {
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
  const version = lock?.packages?.[`node_modules/${freeBrandsPackageName}`]?.version;
  return exactVersion(version, 'Public Font Awesome version');
}

async function regularFile(path, label) {
  await assertNoSymlinkAncestors(path);
  const information = await lstat(path).catch(() => null);
  if (!information?.isFile() || information.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  return information;
}

async function regularDirectory(path, label) {
  await assertNoSymlinkAncestors(path);
  const information = await lstat(path).catch(() => null);
  if (!information?.isDirectory() || information.isSymbolicLink()) throw new Error(`${label} must be a real directory`);
  return information;
}

async function readDirectory(path, label) {
  await regularDirectory(path, label);
  return (await readdir(path, { withFileTypes: true })).sort((left, right) => compare(left.name, right.name));
}

async function assertNotRepositorySource(root) {
  const marker = await lstat(join(root, '.git')).catch(() => null);
  if (marker) throw new Error('Font Awesome Pro directory must be an extracted package, not a repository');
}

async function readPackageSource(sourceRoot) {
  await regularDirectory(sourceRoot, 'Font Awesome Pro directory');
  await assertNotRepositorySource(sourceRoot);
  const packagePath = join(sourceRoot, 'package.json');
  await regularFile(packagePath, 'Font Awesome Pro package metadata');
  let metadata;
  try { metadata = JSON.parse(await readFile(packagePath, 'utf8')); } catch { throw new Error('Font Awesome Pro package metadata is invalid JSON'); }
  if (!ownRecord(metadata) || metadata.name !== proPackageName) throw new Error('Font Awesome Pro directory does not contain the all-inclusive package metadata');
  return { root: sourceRoot, version: exactVersion(metadata.version, 'Font Awesome Pro package version') };
}

function metadataForIcon(metadata, name, family, style) {
  const value = metadata[name];
  const vendorStyles = new Set([style, family, `${family}-${style}`]);
  if (!ownRecord(value) || typeof value.label !== 'string' || !value.label || !/^[0-9a-f]{1,8}$/i.test(value.unicode)
    || !ownRecord(value.search) || !Array.isArray(value.search.terms) || value.search.terms.some(term => typeof term !== 'string')
    || !Array.isArray(value.styles) || value.styles.length === 0 || value.styles.some(entry => typeof entry !== 'string') || !value.styles.some(entry => vendorStyles.has(entry))) {
    throw new Error(`Incomplete Font Awesome metadata for ${family}/${style}/${name}`);
  }
  const aliases = value.aliases?.names;
  if (aliases !== undefined && (!Array.isArray(aliases) || aliases.some(alias => typeof alias !== 'string'))) {
    throw new Error(`Incomplete Font Awesome metadata aliases for ${family}/${style}/${name}`);
  }
  return { label: value.label, searchTerms: value.search.terms, aliases: aliases ?? [] };
}

async function readProMetadata(sourceRoot) {
  const metadataRoot = join(sourceRoot, 'metadata');
  const entries = await readDirectory(metadataRoot, 'Font Awesome metadata directory');
  const names = new Set(entries.filter(entry => entry.isFile() && !entry.isSymbolicLink()).map(entry => entry.name));
  const fileName = ['icons.json', 'icons.yml', 'icons.yaml'].find(name => names.has(name));
  if (!fileName) throw new Error('Font Awesome icon metadata is missing (expected metadata/icons.json or metadata/icons.yml)');
  const metadataPath = join(metadataRoot, fileName);
  await regularFile(metadataPath, 'Font Awesome icon metadata');
  try {
    const source = await readFile(metadataPath, 'utf8');
    const metadata = fileName === 'icons.json' ? JSON.parse(source) : parseFontAwesomeMetadataYaml(source);
    if (!ownRecord(metadata)) throw new Error('Font Awesome icon metadata must be an object');
    return metadata;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Font Awesome')) throw error;
    throw new Error(`Font Awesome icon metadata is invalid ${fileName.endsWith('json') ? 'JSON' : 'YAML'}`);
  }
}

function svgIconDefinition(name, content, metadata) {
  let svgSource = content.trimStart();
  const declaration = svgSource.match(/^<\?xml\s+version=(['"])1\.\d+\1(?:\s+encoding=(['"])[A-Za-z][A-Za-z0-9._-]*\2)?(?:\s+standalone=(['"])(?:yes|no)\3)?\s*\?>\s*/i);
  if (declaration) svgSource = svgSource.slice(declaration[0].length);
  svgSource = svgSource.replace(/<!--[\s\S]*?-->/g, '').trimStart();
  if (/<!|<\?|<\/?(?:script|foreignObject)\b/i.test(svgSource) || !svgSource.startsWith('<svg')) throw new Error(`Malformed Font Awesome SVG: ${name}`);
  const svg = svgSource.match(/^<svg\b([^>]*)>/i);
  const viewBox = svg?.[1].match(/\bviewBox\s*=\s*(["'])\s*0\s+0\s+(\d+)\s+(\d+)\s*\1/i);
  const paths = [...svgSource.matchAll(/<path\b[^>]*\bd\s*=\s*(["'])(.*?)\1[^>]*>/gis)].map(match => match[2]);
  if (!viewBox || !paths.length || paths.length > 2 || paths.some(path => !path)) throw new Error(`Malformed Font Awesome SVG: ${name}`);
  return {
    iconName: name,
    label: metadata.label,
    searchTerms: metadata.searchTerms,
    icon: [Number(viewBox[2]), Number(viewBox[3]), metadata.aliases, 'f000', paths.length === 1 ? paths[0] : paths]
  };
}

async function readStyleIcons(root, family, style, metadata) {
  const icons = [];
  for (const entry of await readDirectory(root, `Font Awesome ${family}/${style} SVG directory`)) {
    const filePath = join(root, entry.name);
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.svg')) throw new Error(`Unknown Font Awesome SVG layout entry: ${filePath}`);
    await regularFile(filePath, 'Font Awesome SVG');
    const name = basename(entry.name, '.svg');
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(name)) throw new Error(`Malformed Font Awesome SVG name: ${entry.name}`);
    const record = svgIconDefinition(name, await readFile(filePath, 'utf8'), metadataForIcon(metadata, name, family, style));
    // The parser only fills the tuple from trusted metadata/SVG; normalize it before output.
    record.icon[3] = String(metadata[name].unicode).toLowerCase();
    icons.push(record);
  }
  if (!icons.length) throw new Error(`Missing Font Awesome SVG definitions for ${family}/${style}`);
  return icons;
}

async function loadProFamilies(sourceRoot) {
  const metadata = await readProMetadata(sourceRoot);
  const svgRoot = join(sourceRoot, 'svgs');
  const mappedStyles = new Map();
  function addStyle(layout, root) {
    const key = `${layout.family}\0${layout.style}`;
    if (mappedStyles.has(key)) throw new Error(`Duplicate Font Awesome family/style layout: ${layout.family}/${layout.style}`);
    mappedStyles.set(key, { ...layout, root });
  }
  for (const entry of await readDirectory(svgRoot, 'Font Awesome SVG root')) {
    const root = join(svgRoot, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Unknown Font Awesome SVG layout: ${root}`);
    const flatLayout = flatSvgLayouts.get(entry.name);
    const nestedLayout = nestedSvgLayouts.get(entry.name);
    // Bare duotone names are valid FA7 flat solid directories and legacy nested
    // family roots. Their child shape is the only unambiguous discriminator.
    const nestedEntries = nestedLayout ? await readDirectory(root, `Font Awesome ${nestedLayout.family} SVG root`) : null;
    if (nestedLayout && (!flatLayout || nestedEntries.some(child => child.isDirectory()))) {
      for (const styleEntry of nestedEntries) {
        if (!styleEntry.isDirectory() || styleEntry.isSymbolicLink() || !nestedLayout.styles.has(styleEntry.name)) throw new Error(`Unknown Font Awesome SVG layout: ${join(root, styleEntry.name)}`);
        addStyle({ family: nestedLayout.family, style: styleEntry.name }, join(root, styleEntry.name));
      }
      continue;
    }
    if (flatLayout) {
      addStyle(flatLayout, root);
      continue;
    }
    throw new Error(`Unknown Font Awesome SVG layout: ${root}`);
  }
  for (const [family, styles] of requiredProFamilies) {
    for (const style of styles) {
      if (!mappedStyles.has(`${family}\0${style}`)) {
        throw new Error(`Font Awesome Pro source is missing required family/style: ${family}/${style}`);
      }
    }
  }
  const byFamily = new Map();
  for (const layout of mappedStyles.values()) {
    const family = byFamily.get(layout.family) ?? { family: layout.family, defaultStyle: layout.family === 'brands' ? 'brands' : 'solid', styles: [] };
    family.styles.push({ style: layout.style, icons: await readStyleIcons(layout.root, layout.family, layout.style, metadata) });
    byFamily.set(layout.family, family);
  }
  return [...byFamily.values()];
}

async function defaultFreeBrands(root = projectRoot) {
  const module = await import(freeBrandsPackageName);
  const metadataSource = await loadPinnedFreeFontAwesomeMetadata(root);
  const icons = enrichFontAwesomeIcons(Object.values(module).filter(value => value && typeof value === 'object' && Array.isArray(value.icon)), metadataSource.metadata);
  return { version: await publicFontAwesomeVersion(root), icons, metadataSource };
}

function mergeFamilyStyles(proFamilies, freeBrands) {
  if (!freeBrands || !Array.isArray(freeBrands.icons) || !exactVersion(freeBrands.version, 'Free Brands package version')) throw new Error('Free Brands source is invalid');
  const merged = new Map();
  for (const family of proFamilies) {
    for (const style of family.styles) {
      const key = `${family.family}\0${style.style}`;
      if (merged.has(key)) throw new Error(`Duplicate Font Awesome family/style: ${family.family}/${style.style}`);
      merged.set(key, { family: family.family, defaultStyle: family.defaultStyle, style: style.style, icons: [...style.icons] });
    }
  }
  const brandKey = 'brands\0brands';
  const existing = merged.get(brandKey);
  const proByName = new Map();
  for (const icon of existing?.icons ?? []) {
    const normalized = normalizeIconRecord(icon);
    if (typeof normalized.name !== 'string') throw new Error('Malformed Font Awesome Pro definition');
    const name = normalized.name;
    const previous = proByName.get(name);
    if (previous && JSON.stringify(normalizeIconRecord(previous)) !== JSON.stringify(normalized)) {
      throw new Error(`Conflicting Font Awesome Pro definition: brands/brands/${name}`);
    }
    proByName.set(name, icon);
  }
  for (const icon of freeBrands.icons) {
    const normalized = normalizeIconRecord(icon);
    if (typeof normalized.name !== 'string') throw new Error('Malformed Free Brands definition');
    const name = normalized.name;
    if (!proByName.has(name)) proByName.set(name, icon);
  }
  merged.set(brandKey, { family: 'brands', defaultStyle: 'brands', style: 'brands', icons: [...proByName.values()] });
  const families = new Map();
  for (const entry of merged.values()) {
    const family = families.get(entry.family) ?? { family: entry.family, defaultStyle: entry.defaultStyle, styles: [] };
    family.styles.push({ style: entry.style, icons: entry.icons });
    families.set(entry.family, family);
  }
  return [...families.values()];
}

export async function adaptProIconSource({ sourceRoot, publicVersion, freeBrands } = {}) {
  const source = await readPackageSource(resolve(sourceRoot));
  const expectedVersion = exactVersion(publicVersion, 'Public Font Awesome version');
  if (!sameMajor(source.version, expectedVersion)) throw new Error('Font Awesome Pro package must use the supported public Font Awesome major');
  const brands = freeBrands ?? await defaultFreeBrands();
  if (!sameMajor(brands.version, expectedVersion)) throw new Error('Free Brands package must use the supported public Font Awesome major');
  const metadataSource = brands.metadataSource ?? await loadPinnedFreeFontAwesomeMetadata(projectRoot);
  if (!metadataSource || metadataSource.package !== '@fortawesome/fontawesome-free' || !sameMajor(metadataSource.version, expectedVersion)) {
    throw new Error('Pinned Font Awesome Free metadata must use the supported public Font Awesome major');
  }
  const enrichedBrands = { ...brands, icons: enrichFontAwesomeIcons(brands.icons, metadataSource.metadata) };
  const families = mergeFamilyStyles(await loadProFamilies(source.root), enrichedBrands);
  return {
    packageVersion: packageMetadata.version,
    profile: 'pro-local',
    sources: [{ package: metadataSource.package, version: metadataSource.version }, { package: proPackageName, version: source.version }, { package: freeBrandsPackageName, version: brands.version }],
    aliases: iconAliases,
    families
  };
}

export async function generateProIconAssets({ sourceRoot, publicVersion, outputRoot = proAssetRoot, freeBrands } = {}) {
  const adapter = await adaptProIconSource({ sourceRoot, publicVersion, freeBrands });
  const availableNames = new Set(adapter.families.flatMap(family => family.styles.flatMap(style => style.icons.map(icon => icon.iconName))));
  const artifact = generateIconArtifacts({ ...adapter, aliases: Object.fromEntries(Object.entries(adapter.aliases).filter(([, canonical]) => availableNames.has(canonical))) });
  validateIconArtifact(artifact.index, { expectedProfile: 'pro-local' });
  const output = resolve(outputRoot);
  if (!isInside(resolve(projectRoot, 'build'), output)) throw new Error('Pro icon assets must be generated below the ignored build directory');
  await assertNoSymlinkAncestors(output);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const [path, bytes] of artifact.files) {
    const target = resolve(output, path);
    if (!isInside(output, target)) throw new Error('Generated Pro icon path escapes its output root');
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, bytes);
  }
  await writeFile(resolve(output, 'generation-report.json'), `${JSON.stringify(artifact.report, null, 2)}\n`);
  return artifact;
}

export async function bootstrapProPackage({ token, version, workspaceRoot = proWorkspaceRoot, environment = process.env, run = execFileAsync } = {}) {
  const requestedVersion = exactVersion(version);
  const credential = safeToken(token);
  const workspace = resolve(workspaceRoot);
  if (!isInside(resolve(projectRoot, 'build'), workspace)) throw new Error('Pro package workspace must be below the ignored build directory');
  await assertNoSymlinkAncestors(workspace);
  const configDirectory = await mkdtemp(join(tmpdir(), 'nodel-fontawesome-pro-'));
  const configPath = join(configDirectory, 'npmrc');
  try {
    await writeFile(configPath, privateNpmConfig(credential), { mode: 0o600 });
    await chmod(configPath, 0o600);
    await rm(workspace, { recursive: true, force: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'package.json'), `${JSON.stringify({ name: 'nodel-fontawesome-pro-local', private: true, version: '0.0.0' })}\n`);
    const childEnvironment = sanitizeProChildEnvironment(environment, {
      NPM_CONFIG_USERCONFIG: configPath,
      npm_config_userconfig: configPath,
      NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
      npm_config_registry: 'https://registry.npmjs.org/'
    });
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--save=false', `${proPackageName}@${requestedVersion}`], { cwd: workspace, env: childEnvironment });
    const sourceRoot = join(workspace, 'node_modules', '@fortawesome', 'fontawesome-pro');
    const source = await readPackageSource(sourceRoot);
    if (source.version !== requestedVersion) throw new Error('Installed Font Awesome Pro package version did not match the requested exact version');
    return { sourceRoot, version: source.version };
  } catch (error) {
    throw new Error(redactProError(error, credential));
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
}

export async function verifyProIconOutput(outputRoot = proDistRoot) {
  await verifyReleaseGateApi({ distRoot: outputRoot, expectedIconProfile: 'pro-local' });
  return true;
}

export async function runProBuild({ argv = process.argv.slice(2), environment = process.env, run = execFileAsync, verifyReleaseGate = verifyReleaseGateApi } = {}) {
  const publicVersion = await publicFontAwesomeVersion();
  const { version } = parseProBuildArgs(argv, { defaultVersion: publicVersion });
  if (!sameMajor(version, publicVersion)) throw new Error('Requested Font Awesome Pro version must use the supported public Font Awesome major');
  const directory = environment.NODEL_FONTAWESOME_PRO_DIR;
  const token = environment.FONTAWESOME_PACKAGE_TOKEN;
  if (Boolean(directory) === Boolean(token)) throw new Error('Set exactly one Pro source: NODEL_FONTAWESOME_PRO_DIR or FONTAWESOME_PACKAGE_TOKEN');
  if (directory && argv.length) throw new Error('--version is only supported for the isolated token bootstrap');
  const source = directory
    ? await readPackageSource(resolve(directory))
    : await bootstrapProPackage({ token, version, environment, run });
  await generateProIconAssets({ sourceRoot: source.sourceRoot ?? source.root, publicVersion: publicVersion });
  const childEnvironment = sanitizeProChildEnvironment(environment, {
    NODEL_PRO_BUILD_ORCHESTRATOR: '1'
  });
  await run(process.execPath, [viteBinary, 'build', '--mode', 'pro-local'], { cwd: projectRoot, env: childEnvironment });
  await verifyReleaseGate({ distRoot: proDistRoot, expectedIconProfile: 'pro-local' });
  return { profile: 'pro-local', sourceVersion: source.version };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProBuild().then(() => {
    console.log('Pro-local build completed in build/pro-dist.');
  }).catch(error => {
    console.error(redactProError(error, process.env.FONTAWESOME_PACKAGE_TOKEN));
    process.exitCode = 1;
  });
}
