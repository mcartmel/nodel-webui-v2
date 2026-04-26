import { access, copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleRoot, '..');

function parseArgs(argv) {
  const result = {
    source: resolve(projectRoot, 'dist'),
    supportSubdir: 'v2',
    target: '/opt/nodel/custom/content/'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--source' && argv[index + 1]) {
      result.source = resolve(argv[++index]);
    } else if (value === '--support-subdir' && argv[index + 1]) {
      result.supportSubdir = argv[++index].replace(/^\/+|\/+$/g, '');
    } else if (value === '--target' && argv[index + 1]) {
      result.target = resolve(argv[++index]);
    }
  }

  return result;
}

async function ensureSourceExists(source, supportSubdir) {
  await access(join(source, supportSubdir));
  await access(join(source, 'index.htm'));
  await access(join(source, 'nodes.html'));
  await access(join(source, 'nodel.html'));
}

async function copyDirectory(source, target) {
  await mkdir(target, { recursive: true });

  let copied = 0;
  const entries = await readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);

    if (entry.isDirectory()) {
      copied += await copyDirectory(from, to);
    } else if (entry.isFile()) {
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
      copied += 1;
    }
  }

  return copied;
}

async function copyTopLevelPages(source, target) {
  await mkdir(target, { recursive: true });

  let copied = 0;
  const entries = await readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !/\.html?$/i.test(entry.name)) {
      continue;
    }

    await copyFile(join(source, entry.name), join(target, entry.name));
    console.log(`Wrote ${join(target, entry.name)}`);
    copied += 1;
  }

  return copied;
}

function isInside(parent, child) {
  const result = relative(parent, child);
  return result === '' || (!result.startsWith('..') && !isAbsolute(result));
}

function assertSafeClearTarget(source, target) {
  const resolvedSource = resolve(source);
  const resolvedTarget = resolve(target);
  const root = parse(resolvedTarget).root;

  if (resolvedTarget === root) {
    throw new Error(`Refusing to clear filesystem root: ${resolvedTarget}`);
  }

  if (isInside(resolvedTarget, projectRoot) || isInside(resolvedTarget, resolvedSource)) {
    throw new Error(`Refusing to clear target that contains project/source files: ${resolvedTarget}`);
  }

  if (isInside(resolvedSource, resolvedTarget)) {
    throw new Error(`Refusing to deploy into source directory: ${resolvedTarget}`);
  }
}

async function clearTarget(source, target) {
  assertSafeClearTarget(source, target);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
}

async function main() {
  const { source, supportSubdir, target } = parseArgs(process.argv.slice(2));
  await ensureSourceExists(source, supportSubdir);
  await clearTarget(source, target);

  const supportFiles = await copyDirectory(join(source, supportSubdir), join(target, supportSubdir));
  const pageFiles = await copyTopLevelPages(source, target);

  console.log(`Copied ${supportFiles + pageFiles} files to ${target}`);
  console.log(`Wrote supporting files under ${join(target, supportSubdir)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
