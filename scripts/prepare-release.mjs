import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleRoot, '..');
const requiredFiles = ['components.html', 'index.htm', 'nodel.html', 'nodes.html', 'toolkit.html'];
const retiredFiles = ['elements.html', 'example.html'];

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
  for (const file of requiredFiles) {
    await access(join(source, file));
  }
  await access(join(source, 'v2'));

  const topLevelEntries = new Set(await readdir(source));
  const retiredEntry = retiredFiles.find((file) => topLevelEntries.has(file));
  if (retiredEntry) {
    throw new Error(`Release source still contains retired page: ${retiredEntry}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageMetadata = await readPackageMetadata();
  const version = options.version || packageMetadata.version;

  if (version !== packageMetadata.version) {
    throw new Error(`Release version ${version} does not match package.json version ${packageMetadata.version}`);
  }

  assertSafeTarget(options.source, options.target);
  await validateSource(options.source);

  await rm(options.target, { recursive: true, force: true });
  await mkdir(options.target, { recursive: true });
  await cp(options.source, options.target, { recursive: true });
  await cp(join(projectRoot, 'LICENSE'), join(options.target, 'LICENSE'));
  await writeFile(
    join(options.target, 'release.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        name: packageMetadata.name,
        version,
        commit: options.commit
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  console.log(`Prepared Nodel Web UI ${version} release at ${options.target}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
