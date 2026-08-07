import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { nodelDocumentElements } from '../src/editor/nodel-document-definition';
import { commonNodelAttributes } from '../src/nodel-component-metadata';

function importedComponents(source: string, importPathPrefix = './components/') {
  const escapedPrefix = importPathPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`['"]${escapedPrefix}(nodel-[a-z0-9-]+)['"]`, 'g');
  return Array.from(source.matchAll(pattern), (match) => match[1]);
}

function documentedComponents(source: string, heading: string) {
  const start = source.indexOf(`### ${heading}`);
  if (start === -1) return [];
  const tail = source.slice(start + heading.length + 4);
  const end = tail.indexOf('\n### ');
  const section = end === -1 ? tail : tail.slice(0, end);
  return Array.from(section.matchAll(/-\s*`(nodel-[a-z0-9-]+)`/g), (match) => match[1]);
}

describe('production refinement Stage 0 baseline', () => {
  it('captures the pre-contract component registry and metadata', async () => {
    const [packageSource, mainSource, loaderSource, docsSource] = await Promise.all([
      readFile(resolve(process.cwd(), 'package.json'), 'utf8'),
      readFile(resolve(process.cwd(), 'src/main.ts'), 'utf8'),
      readFile(resolve(process.cwd(), 'src/nodel-component-loader.ts'), 'utf8'),
      readFile(resolve(process.cwd(), 'docs/web-components.md'), 'utf8')
    ]);
    const packageJson = JSON.parse(packageSource) as { version: string };
    const baseline = {
      baselineSchema: 'pre-component-contract',
      packageVersion: packageJson.version,
      registry: {
        eager: importedComponents(mainSource),
        lazy: importedComponents(loaderSource, './components/'),
        documentedCustom: documentedComponents(docsSource, 'Custom UI Components'),
        documentedCore: documentedComponents(docsSource, 'Core Nodel Components')
      },
      commonAttributes: commonNodelAttributes,
      elements: nodelDocumentElements
    };

    await expect(`${JSON.stringify(baseline, null, 2)}\n`).toMatchFileSnapshot('./fixtures/production-refinement-stage0-component-contract.json');
  });
});
