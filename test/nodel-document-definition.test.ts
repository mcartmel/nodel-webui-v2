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

function normaliseExampleMarkup(markup: string) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();

  return serialiseCatalogueFragment(template.content);
}

function normaliseLiveExample(element: Element) {
  const template = document.createElement('template');

  if (element.classList.contains('nodel-catalogue-examples')) {
    template.innerHTML = element.innerHTML;
  } else {
    template.content.append(element.cloneNode(true));
  }

  return serialiseCatalogueFragment(template.content);
}

function serialiseCatalogueFragment(fragment: DocumentFragment) {
  const clone = fragment.cloneNode(true) as DocumentFragment;
  normaliseCatalogueNode(clone);

  const template = document.createElement('template');
  template.content.append(clone);

  return template.innerHTML.trim();
}

function normaliseCatalogueNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    if (text) {
      node.textContent = text;
    } else {
      node.parentNode?.removeChild(node);
    }

    return;
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    node.parentNode?.removeChild(node);
    return;
  }

  if (node instanceof HTMLTemplateElement) {
    normaliseCatalogueNode(node.content);
  }

  if (node instanceof Element) {
    node.removeAttribute('data-catalogue-example');
  }

  for (const child of Array.from(node.childNodes)) {
    normaliseCatalogueNode(child);
  }
}

function duplicateIds(ids: string[]) {
  return Array.from(new Set(ids.filter((id, index) => ids.indexOf(id) !== index)));
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
      'nodel-group',
      'nodel-button',
      'nodel-select',
      'nodel-stepper',
      'nodel-pad',
      'nodel-readout',
      'nodel-palette',
      'nodel-image',
      'nodel-icon',
      'nodel-status-indicator',
      'nodel-status',
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
    expect(image?.attributes.find((attribute) => attribute.name === 'variant')).toBeUndefined();

    const icon = nodelDocumentElements.find((element) => element.name === 'nodel-icon');
    expect(icon?.attributes.find((attribute) => attribute.name === 'variant')).toBeUndefined();

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

  it('includes the node menu in the default node UI', async () => {
    const nodeUi = await readFile(resolve(process.cwd(), 'nodel.html'), 'utf8');

    expect(nodeUi).toContain('<nodel-node-menu></nodel-node-menu>');
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

  it('keeps the component catalogue covering the public components', async () => {
    const componentsUi = await readFile(resolve(process.cwd(), 'components.html'), 'utf8');
    const expectedComponents = [
      'nodel-app',
      'nodel-toolbar',
      'nodel-page',
      'nodel-row',
      'nodel-column',
      'nodel-control-grid',
      'nodel-control-space',
      'nodel-group',
      'nodel-template',
      'nodel-button',
      'nodel-toggle',
      'nodel-segmented',
      'nodel-select',
      'nodel-stepper',
      'nodel-pad',
      'nodel-readout',
      'nodel-palette',
      'nodel-fader',
      'nodel-meter',
      'nodel-image',
      'nodel-icon',
      'nodel-status-indicator',
      'nodel-status',
      'nodel-collapse',
      'nodel-text',
      'nodel-title',
      'nodel-theme-toggle',
      'nodel-host-icon'
    ];

    for (const component of expectedComponents) {
      expect(componentsUi).toContain(`<${component}`);
    }

    const internalControlClasses = [
      'nodel-select-trigger',
      'nodel-stepper-button',
      'nodel-pad-button',
      'nodel-fader-nudge',
      'nodel-theme-toggle-button',
      'nodel-theme-switch'
    ];

    for (const className of internalControlClasses) {
      expect(componentsUi).not.toContain(`class="${className}`);
      expect(componentsUi).not.toContain(`class=&quot;${className}`);
    }

    const runtimeComponents = [
      'nodel-node-list',
      'nodel-add-node',
      'nodel-diagnostics',
      'nodel-host-log',
      'nodel-diagnostic-charts',
      'nodel-toolkit',
      'nodel-description',
      'nodel-console',
      'nodel-log',
      'nodel-actsig',
      'nodel-params',
      'nodel-bindings',
      'nodel-editor',
      'nodel-node-menu',
      'nodel-toast-host',
      'nodel-confirm-host'
    ];

    for (const component of runtimeComponents) {
      expect(componentsUi).not.toContain(`<${component}`);
      expect(componentsUi).not.toContain(`&lt;${component}`);
    }
  });

  it('keeps marked catalogue examples matched to their code snippets', async () => {
    const componentsUi = await readFile(resolve(process.cwd(), 'components.html'), 'utf8');
    const template = document.createElement('template');
    template.innerHTML = componentsUi;
    const examples = Array.from(template.content.querySelectorAll('[data-catalogue-example]'));
    const codeElements = Array.from(template.content.querySelectorAll<HTMLElement>('pre.nodel-catalogue-code'));
    const codeIds = codeElements.map((code) => code.dataset.catalogueCodeFor ?? '');
    const exampleIds = examples.map((example) => (example as HTMLElement).dataset.catalogueExample ?? '');

    expect(codeElements.length).toBeGreaterThan(0);
    expect(examples.length).toBeGreaterThan(0);
    expect(codeIds.filter((id) => !id)).toEqual([]);
    expect(exampleIds.filter((id) => !id)).toEqual([]);
    expect(duplicateIds(codeIds)).toEqual([]);
    expect(duplicateIds(exampleIds)).toEqual([]);

    const codeBlocks = new Map(codeElements.map((code) => [code.dataset.catalogueCodeFor, code.querySelector('code')?.textContent ?? '']));

    expect(codeElements).toHaveLength(examples.length);

    for (const code of codeElements) {
      const markup = code.querySelector('code')?.textContent ?? '';
      const openingTags = markup.match(/<[^/!][^>]*>/g) ?? [];

      if (openingTags.length > 1) {
        expect(markup, `${code.dataset.catalogueCodeFor} should format nested markup across lines`).toContain('\n');
      }
    }

    for (const example of examples) {
      const id = (example as HTMLElement).dataset.catalogueExample;
      expect(codeBlocks.has(id)).toBe(true);
      expect(normaliseLiveExample(example)).toBe(normaliseExampleMarkup(codeBlocks.get(id) ?? ''));
      codeBlocks.delete(id);
    }

    expect(Array.from(codeBlocks.keys()).filter(Boolean)).toEqual([]);
  });
});
