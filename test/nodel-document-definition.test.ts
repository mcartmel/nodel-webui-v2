import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { nodelDocumentElements, completeNodelDocument } from '../src/editor/nodel-document-definition';
import { bootstrapNodelComponentLoader, loadNodelComponent } from '../src/nodel-component-loader';
import { readStyleSource } from './style-source';

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

function parseDocumentedComponents(docsSource: string, section: 'Custom UI Components' | 'Core Nodel Components') {
  const heading = `### ${section}`;
  const sectionStart = docsSource.indexOf(heading);
  if (sectionStart === -1) {
    return [] as string[];
  }

  const sectionTail = docsSource.slice(sectionStart + heading.length);
  const nextHeadingStart = sectionTail.indexOf('\n### ');
  const sectionSource = nextHeadingStart === -1 ? sectionTail : sectionTail.slice(0, nextHeadingStart);

  return Array.from(sectionSource.matchAll(/-\s*`(nodel-[a-z0-9-]+)`/g)).map((match) => match[1]);
}

function parseImportedComponents(source: string, importPathPrefix: './components/') {
  const escapedImportPathPrefix = importPathPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`['\"]${escapedImportPathPrefix}(nodel-[a-z0-9-]+)['\"]`, 'g');
  return Array.from(source.matchAll(pattern)).map((match) => match[1]);
}

function toUniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function expectDisjointSets(a: Set<string>, b: Set<string>) {
  const overlap = Array.from(a).filter((value) => b.has(value));
  expect(overlap).toEqual([]);
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
      'nodel-qrcode',
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

    const select = nodelDocumentElements.find((element) => element.name === 'nodel-select');
    const segmented = nodelDocumentElements.find((element) => element.name === 'nodel-segmented');
    expect(select?.attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['options-signal', 'options-loading-label', 'options-empty-label', 'options-error-label']));
    expect(select?.attributes.find((attribute) => attribute.name === 'placement')?.values).toEqual(['auto', 'bottom', 'top']);
    expect(segmented?.attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['options-signal', 'options-loading-label', 'options-empty-label', 'options-error-label']));
    for (const name of ['nodel-button', 'nodel-toggle', 'nodel-segmented', 'nodel-select', 'nodel-palette', 'nodel-pad', 'nodel-stepper']) {
      const control = nodelDocumentElements.find((element) => element.name === name);
      expect(control?.attributes.map((attribute) => attribute.name), name).toEqual(expect.arrayContaining(['confirm-mode', 'confirm-code-signal']));
    }
    const app = nodelDocumentElements.find((element) => element.name === 'nodel-app');
    expect(app?.attributes.find((attribute) => attribute.name === 'offline-mode')?.values).toEqual(['modal', 'overlay']);
    expect(app?.attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['signal', 'signals']));
    const page = nodelDocumentElements.find((element) => element.name === 'nodel-page');
    expect(page?.attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['action', 'actions', 'arg', 'arg-type']));
    const link = nodelDocumentElements.find((element) => element.name === 'nodel-link');
    expect(link?.attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['href', 'node', 'event-binding', 'target', 'rel']));
    const nodeListDefinition = nodelDocumentElements.find((element) => element.name === 'nodel-node-list');
    expect(nodeListDefinition?.attributes.map((attribute) => attribute.name)).toContain('query-param');
    const footer = nodelDocumentElements.find((element) => element.name === 'nodel-footer');
    expect(footer?.attributes.map((attribute) => attribute.name)).toContain('fixed');
    const markdown = nodelDocumentElements.find((element) => element.name === 'nodel-markdown');
    expect(markdown?.attributes.find((attribute) => attribute.name === 'max-height')?.values).toEqual(['none', 'sm', 'md', 'lg', 'screen']);
    const clock = nodelDocumentElements.find((element) => element.name === 'nodel-clock');
    expect(clock?.attributes.find((attribute) => attribute.name === 'format')?.values).toEqual(['time', 'date', 'datetime']);
    const palette = nodelDocumentElements.find((element) => element.name === 'nodel-palette');
    expect(palette?.attributes.find((attribute) => attribute.name === 'format')?.values).toEqual(['hex', 'rgb', 'hsl', 'hsv']);
    expect(palette?.attributes.find((attribute) => attribute.name === 'value-field')?.values).toEqual(['readonly', 'editable', 'hidden']);
    expect(palette?.attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['live', 'live-interval']));
    const indicator = nodelDocumentElements.find((element) => element.name === 'nodel-status-indicator');
    expect(indicator?.attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['partial-on-value', 'partial-off-value', 'partial-tone', 'show-state-label']));
    const column = nodelDocumentElements.find((element) => element.name === 'nodel-column');
    expect(column?.attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['order', 'sm-order', 'md-order', 'lg-order', 'xl-order', '2xl-order']));

    const text = nodelDocumentElements.find((element) => element.name === 'nodel-text');
    expect(text?.attributes.find((attribute) => attribute.name === 'tone')?.values).toEqual(['muted', 'default', 'accent', 'success', 'info', 'warning', 'danger']);
    expect(text?.attributes.find((attribute) => attribute.name === 'size')?.values).toEqual(['xs', 'sm', 'md', 'lg', 'xl']);
    const textAttributeCompletions = completeNodelDocument(fakeCompletionContext('<nodel-text ') as never);
    expect(textAttributeCompletions?.options.map((option) => option.label)).toEqual(expect.arrayContaining(['visibility', 'visible-value', 'visible-values']));

    const image = nodelDocumentElements.find((element) => element.name === 'nodel-image');
    expect(image?.attributes.find((attribute) => attribute.name === 'variant')).toBeUndefined();

    const icon = nodelDocumentElements.find((element) => element.name === 'nodel-icon');
    expect(icon?.attributes.find((attribute) => attribute.name === 'variant')).toBeUndefined();

    const completions = completeNodelDocument(fakeCompletionContext('<nodel-node-list scope="') as never);
    expect(completions?.options.map((option) => option.label)).toEqual(expect.arrayContaining(['local', 'network']));
  });

  it('has document-definition entries for public main imports', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const importedComponents = parseImportedComponents(source, './components/');
    const definedComponents = new Set(nodelDocumentElements.map((element) => element.name));

    expect(importedComponents.length).toBeGreaterThan(0);
    expect(importedComponents.filter((name) => !definedComponents.has(name))).toEqual([]);
  });

  it('installs the catalogue runtime before importing eager components', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const firstImport = source.match(/^import\s+['"]([^'"]+)['"];?/m)?.[1];

    expect(firstImport).toBe('./catalogue/runtime-bootstrap');
  });

  it('keeps component registries aligned across loader, docs, completions, and CSS', async () => {
    const [mainSource, docsSource, stylesSource] = await Promise.all([
      readFile(resolve(process.cwd(), 'src/main.ts'), 'utf8'),
      readFile(resolve(process.cwd(), 'docs/web-components.md'), 'utf8'),
      readStyleSource()
    ]);
    const loaderSource = await readFile(resolve(process.cwd(), 'src/nodel-component-loader.ts'), 'utf8');

    const eagerComponents = toUniqueSorted(parseImportedComponents(mainSource, './components/'));
    const lazyComponents = toUniqueSorted(parseImportedComponents(loaderSource, './components/'));
    const customComponents = toUniqueSorted(parseDocumentedComponents(docsSource, 'Custom UI Components'));
    const coreComponents = toUniqueSorted(parseDocumentedComponents(docsSource, 'Core Nodel Components'));
    const autoCreatedCoreHosts = new Set(['nodel-toast-host', 'nodel-confirm-host', 'nodel-connectivity-host']);

    const documentedCoreLazy = coreComponents.filter((component) => !autoCreatedCoreHosts.has(component));
    const documentedCoreEager = coreComponents.filter((component) => autoCreatedCoreHosts.has(component));
    const documentedCoreEagerSorted = toUniqueSorted(documentedCoreEager);

    const allDocumentedComponents = toUniqueSorted([...customComponents, ...coreComponents]);
    const allRegistryComponents = toUniqueSorted(nodelDocumentElements.map((element) => element.name));
    const eagerSet = new Set(eagerComponents);
    const lazySet = new Set(lazyComponents);

    expect(documentedCoreEagerSorted).toEqual(toUniqueSorted(Array.from(autoCreatedCoreHosts)));
    expect(eagerComponents).toEqual(toUniqueSorted([...customComponents, ...documentedCoreEager]));
    expect(lazyComponents).toEqual(toUniqueSorted(documentedCoreLazy));
    expect(eagerComponents.filter((name) => !allDocumentedComponents.includes(name))).toEqual([]);
    expect(lazyComponents.filter((name) => !allDocumentedComponents.includes(name))).toEqual([]);
    expect(allRegistryComponents.filter((name) => !allDocumentedComponents.includes(name))).toEqual([]);
    expect(allDocumentedComponents.filter((name) => !allRegistryComponents.includes(name))).toEqual([]);
    expectDisjointSets(eagerSet, lazySet);
    expect(toUniqueSorted([...eagerComponents, ...lazyComponents])).toEqual(allDocumentedComponents);

    expect(allDocumentedComponents.filter((name) => !stylesSource.includes(`${name},`) && !stylesSource.includes(`${name} {`))).toEqual([]);
    expect(allDocumentedComponents.filter((name) => !stylesSource.includes(`${name}:not(:defined)`))).toEqual([]);
  });

  it('keeps the loader contract bounded, normalised, and scan-driven', async () => {
    await expect(loadNodelComponent('nodel-does-not-exist')).rejects.toThrow('Unknown Nodel component "nodel-does-not-exist"');
    await expect(loadNodelComponent('nodel-does-not-exist')).rejects.toThrow('Unknown Nodel component "nodel-does-not-exist"');

    await expect(loadNodelComponent('  Nodel-Link  ')).resolves.toBeUndefined();
    expect(customElements.get('nodel-link')).toBeDefined();

    const root = document.createElement('div');
    root.innerHTML = '<nodel-link id="loader-root"></nodel-link>';
    document.body.append(root);

    bootstrapNodelComponentLoader(root);

    await customElements.whenDefined('nodel-link');
    root.append(document.createElement('nodel-description'));
    await customElements.whenDefined('nodel-description');
    expect(customElements.get('nodel-description')).toBeDefined();
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

  it('redirects to newly created nodes by default', async () => {
    const nodesUi = await readFile(resolve(process.cwd(), 'nodes.html'), 'utf8');

    expect(nodesUi).toContain('<nodel-add-node></nodel-add-node>');
    expect(nodesUi).not.toContain('<nodel-add-node redirect="false"');
  });

  it('keeps the component catalogue covering the public components', async () => {
    const componentsUi = await readFile(resolve(process.cwd(), 'components.html'), 'utf8');
    const expectedComponents = [
      'nodel-app',
      'nodel-toolbar',
      'nodel-page',
      'nodel-row',
      'nodel-column',
      'nodel-footer',
      'nodel-control-grid',
      'nodel-control-space',
      'nodel-group',
      'nodel-template',
      'nodel-link',
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
      'nodel-qrcode',
      'nodel-status-indicator',
      'nodel-status',
      'nodel-collapse',
      'nodel-text',
      'nodel-title',
      'nodel-markdown',
      'nodel-clock',
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
      'nodel-theme-switch',
      'nodel-card',
      'nodel-panel',
      'nodel-popover'
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
      'nodel-confirm-host',
      'nodel-connectivity-host'
    ];

    for (const component of runtimeComponents) {
      expect(componentsUi).not.toContain(`<${component}`);
      expect(componentsUi).not.toContain(`&lt;${component}`);
    }

    expect(componentsUi).toContain('data-nodel-runtime="memory"');
    expect(componentsUi).toContain('The catalogue marker installs the page-only in-memory action/signal runtime');

    for (const page of ['nodel.html', 'nodes.html', 'toolkit.html']) {
      const pageUi = await readFile(resolve(process.cwd(), page), 'utf8');
      expect(pageUi).not.toContain('data-nodel-runtime="memory"');
      expect(pageUi).toMatch(/<nodel-app\b[^>]*offline-mode="overlay"/);
    }
    expect(componentsUi).toMatch(/<nodel-app\b/);
    expect(componentsUi).not.toMatch(/<nodel-app\b[^>]*offline-mode=/);
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
