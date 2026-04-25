import { access, copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
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

async function ensureSourceExists(source) {
  await access(join(source, 'index.html'));
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

async function main() {
  const { source, supportSubdir, target } = parseArgs(process.argv.slice(2));
  await ensureSourceExists(source);
  await access(join(source, supportSubdir));

  const supportFiles = await copyDirectory(join(source, supportSubdir), join(target, supportSubdir));
  await mkdir(target, { recursive: true });
  await copyFile(join(source, 'index.html'), join(target, 'index.html'));

  console.log(`Copied ${supportFiles + 1} files to ${target}`);
  console.log(`Wrote ${join(target, 'index.html')}`);
  console.log(`Wrote supporting files under ${join(target, supportSubdir)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
