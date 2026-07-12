import { access, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleRoot, '..');

function parseArgs(argv) {
  const result = {
    page: 'components.html',
    source: resolve(projectRoot, 'dist'),
    target: '/opt/nodel/nodes/Nodel Components Catalog/content'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--page' && argv[index + 1]) {
      result.page = argv[++index];
    } else if (value === '--source' && argv[index + 1]) {
      result.source = resolve(argv[++index]);
    } else if (value === '--target' && argv[index + 1]) {
      result.target = resolve(argv[++index]);
    }
  }

  return result;
}

async function ensureSourceExists(source, page) {
  await access(join(source, page));
}

async function main() {
  const { page, source, target } = parseArgs(process.argv.slice(2));
  await ensureSourceExists(source, page);
  await mkdir(target, { recursive: true });

  const pageTarget = join(target, page);
  await copyFile(join(source, page), pageTarget);
  console.log(`Wrote ${pageTarget}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
