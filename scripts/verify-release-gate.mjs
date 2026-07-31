import { access, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const dist = resolve(process.cwd(), 'dist');
const entryPages = ['components.html', 'index.htm', 'nodel.html', 'nodes.html', 'toolkit.html'];
const corePages = ['nodel.html', 'nodes.html', 'toolkit.html'];

async function main() {
  for (const page of entryPages) {
    await access(join(dist, page));
  }
  await access(join(dist, 'v2/nodel-webui.css'));
  await access(join(dist, 'v2/nodel-webui.js'));

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

  console.log('Release gate verified entry pages, runtime marker, stable assets, and offline modes.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
