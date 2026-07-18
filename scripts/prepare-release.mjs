import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleRoot, '..');
const sourceRequiredFiles = [
  'components.html',
  'index.htm',
  'nodel.html',
  'nodes.html',
  'toolkit.html',
  'v2/nodel-webui.css',
  'v2/nodel-webui.js'
];
const bundleRequiredFiles = [
  ...sourceRequiredFiles,
  'LICENSE',
  'THIRD-PARTY-NOTICES.md',
  'release.json'
];
const retiredFiles = ['elements.html', 'example.html'];
const nodelApiRange = Object.freeze({
  min: '1.0',
  maxExclusive: '2.0',
  requiredFeatures: []
});

function parseArgs(argv) {
  const result = {
    source: resolve(projectRoot, 'dist'),
    target: resolve(projectRoot, 'build/release'),
    version: '',
    commit: process.env.GITHUB_SHA ?? 'local'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--source' && argv[index + 1]) {
      result.source = resolve(argv[++index]);
    } else if (value === '--target' && argv[index + 1]) {
      result.target = resolve(argv[++index]);
    } else if (value === '--version' && argv[index + 1]) {
      result.version = argv[++index];
    } else if (value === '--commit' && argv[index + 1]) {
      result.commit = argv[++index];
    }
  }

  return result;
}

function isInside(parent, child) {
  const result = relative(parent, child);
  return result === '' || (!result.startsWith('..') && !isAbsolute(result));
}

function assertSafeTarget(source, target) {
  if (target === projectRoot || !isInside(projectRoot, target)) {
    throw new Error(`Release target must be inside the project without replacing it: ${target}`);
  }

  if (isInside(source, target) || isInside(target, source)) {
    throw new Error(`Release target must not contain or be contained by the source: ${target}`);
  }
}

async function readPackageMetadata() {
  return JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
}

async function validateSource(source) {
  for (const file of sourceRequiredFiles) {
    await access(join(source, file));
  }

  const topLevelEntries = new Set(await readdir(source));
  const retiredEntry = retiredFiles.find((file) => topLevelEntries.has(file));
  if (retiredEntry) {
    throw new Error(`Release source still contains retired page: ${retiredEntry}`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidVersion(value) {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value);
}

function isValidCommit(value) {
  return typeof value === 'string' && (value === 'local' || /^[0-9a-f]{40}$/i.test(value));
}

function parseApiVersion(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = /^(\d+)\.(\d+)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function compareApiVersions(left, right) {
  return left[0] === right[0] ? left[1] - right[1] : left[0] - right[0];
}

function validateReleaseManifest(manifest, expected) {
  if (!isRecord(manifest)) {
    throw new Error('release.json must contain an object');
  }

  if (manifest.schemaVersion !== 1) {
    throw new Error('release.json schemaVersion must be 1');
  }

  if (manifest.name !== expected.name) {
    throw new Error(`release.json name ${manifest.name} does not match ${expected.name}`);
  }

  if (!isValidVersion(manifest.version) || manifest.version !== expected.version) {
    throw new Error(`release.json version ${manifest.version} does not match ${expected.version}`);
  }

  if (!isValidCommit(manifest.commit) || manifest.commit !== expected.commit) {
    throw new Error(`release.json commit ${manifest.commit} does not match ${expected.commit}`);
  }

  if (!isRecord(manifest.nodelApi)) {
    throw new Error('release.json nodelApi must contain an object');
  }

  const min = parseApiVersion(manifest.nodelApi.min);
  const maxExclusive = parseApiVersion(manifest.nodelApi.maxExclusive);
  if (!min || !maxExclusive || compareApiVersions(min, maxExclusive) >= 0) {
    throw new Error('release.json nodelApi range is invalid');
  }

  if (!Array.isArray(manifest.nodelApi.requiredFeatures) || !manifest.nodelApi.requiredFeatures.every((feature) => typeof feature === 'string')) {
    throw new Error('release.json nodelApi requiredFeatures must be a string array');
  }
}

async function validateBundle(target, expected) {
  for (const file of bundleRequiredFiles) {
    await access(join(target, file));
  }

  const manifest = JSON.parse(await readFile(join(target, 'release.json'), 'utf8'));
  validateReleaseManifest(manifest, expected);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageMetadata = await readPackageMetadata();
  const version = options.version || packageMetadata.version;

  if (version !== packageMetadata.version) {
    throw new Error(`Release version ${version} does not match package.json version ${packageMetadata.version}`);
  }

  if (!isValidCommit(options.commit)) {
    throw new Error(`Release commit must be a 40-character hexadecimal value or local: ${options.commit}`);
  }

  assertSafeTarget(options.source, options.target);
  await validateSource(options.source);

  await rm(options.target, { recursive: true, force: true });
  await mkdir(options.target, { recursive: true });
  await cp(options.source, options.target, { recursive: true });
  await cp(join(projectRoot, 'LICENSE'), join(options.target, 'LICENSE'));
  await cp(join(projectRoot, 'THIRD-PARTY-NOTICES.md'), join(options.target, 'THIRD-PARTY-NOTICES.md'));
  const manifest = {
    schemaVersion: 1,
    name: packageMetadata.name,
    version,
    commit: options.commit,
    nodelApi: nodelApiRange
  };
  validateReleaseManifest(manifest, {
    name: packageMetadata.name,
    version,
    commit: options.commit
  });
  await writeFile(
    join(options.target, 'release.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  await validateBundle(options.target, {
    name: packageMetadata.name,
    version,
    commit: options.commit
  });

  console.log(`Prepared Nodel Web UI ${version} release at ${options.target}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
