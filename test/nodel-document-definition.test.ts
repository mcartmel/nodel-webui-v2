import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { nodelDocumentElements, completeNodelDocument } from '../src/editor/nodel-document-definition';

function fakeCompletionContext(text: string, explicit = true) {
  return {
    pos: text.length,
    explicit,
    state: {
      sliceDoc(from: number, to: number) {
        return text.slice(from, to);
      }
    },
    matchBefore(pattern: RegExp) {
      const match = text.match(pattern);
      if (!match || match.index === undefined || match.index + match[0].length !== text.length) {
        return null;
      }
      return { from: match.index, to: text.length, text: match[0] };
    }
  };
}

describe('nodel document definition', () => {
  it('includes custom layout elements and completions', () => {
    const names = nodelDocumentElements.map((element) => element.name);
    expect(names).toEqual(expect.arrayContaining([
      'nodel-app',
      'nodel-page',
      'nodel-row',
      'nodel-column',
      'nodel-control-grid',
      'nodel-control-space',
      'nodel-button',
      'nodel-image',
      'nodel-icon',
      'nodel-status-indicator',
      'nodel-console',
      'nodel-log',
      'nodel-params',
      'nodel-bindings',
      'nodel-editor',
      'nodel-host-log',
      'nodel-diagnostic-charts'
    ]));

    const nodeList = nodelDocumentElements.find((element) => element.name === 'nodel-node-list');
    expect(nodeList?.attributes.find((attribute) => attribute.name === 'scope')?.values).toEqual(['local', 'network']);

    const button = nodelDocumentElements.find((element) => element.name === 'nodel-button');
    expect(button?.attributes.find((attribute) => attribute.name === 'variant')?.values).toEqual(['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost', 'link']);
    expect(button?.attributes.find((attribute) => attribute.name === 'layout')?.values).toEqual(['inline', 'stack']);

    const text = nodelDocumentElements.find((element) => element.name === 'nodel-text');
    expect(text?.attributes.find((attribute) => attribute.name === 'tone')?.values).toEqual(['muted', 'default', 'accent', 'success', 'info', 'warning', 'danger']);
    expect(text?.attributes.find((attribute) => attribute.name === 'size')?.values).toEqual(['xs', 'sm', 'md', 'lg', 'xl']);

    const image = nodelDocumentElements.find((element) => element.name === 'nodel-image');
    expect(image?.attributes.find((attribute) => attribute.name === 'variant')?.values).toEqual(['plain', 'soft', 'bordered']);

    const icon = nodelDocumentElements.find((element) => element.name === 'nodel-icon');
    expect(icon?.attributes.find((attribute) => attribute.name === 'variant')?.values).toEqual(['plain', 'soft', 'bordered']);

    const completions = completeNodelDocument(fakeCompletionContext('<nodel-node-list scope="') as never);
    expect(completions?.options.map((option) => option.label)).toEqual(expect.arrayContaining(['local', 'network']));
  });

  it('has document-definition entries for public main imports', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const importedComponents = Array.from(source.matchAll(/\.\/components\/(nodel-[^']+)'/g)).map((match) => match[1]);
    const definedComponents = new Set(nodelDocumentElements.map((element) => element.name));

    expect(importedComponents.length).toBeGreaterThan(0);
    expect(importedComponents.filter((name) => !definedComponents.has(name))).toEqual([]);
  });

  it('includes the node menu in the default node UI only', async () => {
    const nodeUi = await readFile(resolve(process.cwd(), 'nodel.html'), 'utf8');
    const elementsUi = await readFile(resolve(process.cwd(), 'elements.html'), 'utf8');

    expect(nodeUi).toContain('<nodel-node-menu></nodel-node-menu>');
    expect(elementsUi).not.toContain('<nodel-node-menu');
  });

  it('keeps the toolkit reference on a standalone page', async () => {
    const nodeUi = await readFile(resolve(process.cwd(), 'nodel.html'), 'utf8');
    const toolkitUi = await readFile(resolve(process.cwd(), 'toolkit.html'), 'utf8');

    expect(nodeUi).not.toContain('<nodel-toolkit>');
    expect(toolkitUi).toContain('<nodel-toolkit></nodel-toolkit>');
  });

  it('includes host log and charts on the diagnostics document', async () => {
    const nodesUi = await readFile(resolve(process.cwd(), 'nodes.html'), 'utf8');

    expect(nodesUi).toContain('<nodel-diagnostics></nodel-diagnostics>');
    expect(nodesUi).toContain('<nodel-host-log></nodel-host-log>');
    expect(nodesUi).toContain('<nodel-diagnostic-charts></nodel-diagnostic-charts>');
  });

  it('keeps the component example document covering the public components', async () => {
    const exampleUi = await readFile(resolve(process.cwd(), 'example.html'), 'utf8');
    const expectedComponents = [
      'nodel-app',
      'nodel-toolbar',
      'nodel-page',
      'nodel-row',
      'nodel-column',
      'nodel-control-grid',
      'nodel-control-space',
      'nodel-button',
      'nodel-image',
      'nodel-icon',
      'nodel-status-indicator',
      'nodel-collapse',
      'nodel-text',
      'nodel-title',
      'nodel-theme-toggle',
      'nodel-host-icon'
    ];

    for (const component of expectedComponents) {
      expect(exampleUi).toContain(`<${component}`);
    }
  });
});
