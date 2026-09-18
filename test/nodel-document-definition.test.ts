import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CompletionContext } from '@codemirror/autocomplete';
import { htmlLanguage } from '@codemirror/lang-html';
import { EditorState } from '@codemirror/state';
import type * as signalBindings from '../src/data/signal-bindings';
import { nodelDocumentElements } from '../src/editor/nodel-document-definition';
import { nodelHtmlCompletionSource } from '../src/editor/nodel-html-document-support';
import { commonNodelAttributes, getEffectiveCatalogueAttributes } from '../src/nodel-component-metadata';
import { controlIconNames } from '../src/icons/control-icon-names';
import { bootstrapNodelComponentLoader, loadNodelComponent } from '../src/nodel-component-loader';
import { readStyleSource } from './style-source';

vi.mock('../src/data/signal-bindings', async (importOriginal) => {
  const actual = await importOriginal<typeof signalBindings>();
  return {
    ...actual,
    bootstrapSignalVisibilityBindings: () => ({ dispose() {} })
  };
});

function fakeCompletionContext(text: string, explicit = true) {
  const state = EditorState.create({ doc: text, extensions: [htmlLanguage] });
  return new CompletionContext(state, text.length, explicit);
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

  return Array.from(sectionSource.matchAll(/-\s*`(nodel-[a-z0-9-]+)`/g))
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
}

function parseImportedComponents(source: string, importPathPrefix: './components/') {
  const escapedImportPathPrefix = importPathPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`["']${escapedImportPathPrefix}(nodel-[a-z0-9-]+)["']`, 'g');
  return Array.from(source.matchAll(pattern))
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
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
    expect(names).toEqual(expect.arrayContaining(['nodel-app', 'nodel-page', 'nodel-row', 'nodel-column', 'nodel-control-grid', 'nodel-control-space', 'nodel-group', 'nodel-button', 'nodel-shortcut', 'nodel-select', 'nodel-stepper', 'nodel-pad', 'nodel-readout', 'nodel-palette', 'nodel-image', 'nodel-icon', 'nodel-qrcode', 'nodel-status-indicator', 'nodel-status', 'nodel-console', 'nodel-log', 'nodel-params', 'nodel-bindings', 'nodel-editor', 'nodel-host-log', 'nodel-diagnostic-charts']));

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
      expect(
        control?.attributes.map((attribute) => attribute.name),
        name
      ).toEqual(expect.arrayContaining(['confirm-mode', 'confirm-code-signal']));
    }
    const app = nodelDocumentElements.find((element) => element.name === 'nodel-app');
    expect(app?.attributes.find((attribute) => attribute.name === 'offline-mode')?.values).toEqual(['modal', 'overlay']);
    expect(app?.attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['signal', 'signals']));
    const page = nodelDocumentElements.find((element) => element.name === 'nodel-page');
    expect(page?.attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['action', 'actions', 'arg', 'arg-type', 'min-height', 'bleed']));
    expect(page?.attributes.find((attribute) => attribute.name === 'min-height')?.values).toEqual(['auto', 'viewport']);
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
    const textAttributeCompletions = nodelHtmlCompletionSource(fakeCompletionContext('<nodel-text '));
    expect(textAttributeCompletions?.options.map((option) => option.label)).toEqual(expect.arrayContaining(['visibility', 'visible-value', 'visible-values']));

    const image = nodelDocumentElements.find((element) => element.name === 'nodel-image');
    expect(image?.attributes.find((attribute) => attribute.name === 'variant')).toBeUndefined();

    const icon = nodelDocumentElements.find((element) => element.name === 'nodel-icon');
    expect(icon?.attributes.find((attribute) => attribute.name === 'variant')).toBeUndefined();

    const completions = nodelHtmlCompletionSource(fakeCompletionContext('<nodel-node-list scope="'));
    expect(completions?.options.map((option) => option.label)).toEqual(expect.arrayContaining(['local', 'network']));
    expect(nodelHtmlCompletionSource(fakeCompletionContext('<nodel-page min-height="'))?.options.map((option) => option.label)).toEqual(expect.arrayContaining(['auto', 'viewport']));
    const readout = nodelDocumentElements.find((element) => element.name === 'nodel-readout');
    expect(readout?.attributes.find((attribute) => attribute.name === 'ring-layout')?.values).toEqual(['compact', 'edge']);
    expect(readout?.attributes.find((attribute) => attribute.name === 'notch-position')?.values).toEqual(['bottom', 'left', 'top', 'right']);
    expect(readout?.attributes.find((attribute) => attribute.name === 'notch-depth')?.syntax).toBe('percentage text');

    const elementCompletions = nodelHtmlCompletionSource(fakeCompletionContext('<'))?.options.map((option) => option.label) ?? [];
    expect(elementCompletions).toContain('nodel-link');
    expect(elementCompletions).not.toEqual(expect.arrayContaining(['nodel-toast-host', 'nodel-confirm-host', 'nodel-connectivity-host']));
    const templateAttributes = nodelHtmlCompletionSource(fakeCompletionContext('<nodel-template '))?.options.map((option) => option.label) ?? [];
    expect(templateAttributes).not.toContain('data-*');
  });

  it('keeps neutral metadata schema, catalogue flags, and editor completions aligned', () => {
    expect(nodelDocumentElements.find((element) => element.name === 'nodel-editor')?.catalogue).not.toBe(true);

    expect(new Set(nodelDocumentElements.map((element) => element.name)).size).toBe(nodelDocumentElements.length);
    for (const element of nodelDocumentElements) {
      const attributes = element.attributes.map((attribute) => attribute.name);
      expect(new Set(attributes).size, element.name).toBe(attributes.length);
      for (const attribute of element.attributes) {
        expect(attribute.valueType, `${element.name}.${attribute.name}`).toBeDefined();
        if (attribute.values) {
          expect(['enum', 'enum-or-string']).toContain(attribute.valueType);
          expect(new Set(attribute.values).size).toBe(attribute.values.length);
          expect(attribute.numeric, `${element.name}.${attribute.name}`).toBeUndefined();
          if (attribute.defaultValue) {
            expect(attribute.values).toContain(attribute.defaultValue);
          }
        }
        if (attribute.numeric?.min !== undefined && attribute.numeric?.max !== undefined) {
          expect(attribute.numeric.min).toBeLessThanOrEqual(attribute.numeric.max);
        }
      }
    }

    const byName = (name: string) => {
      const element = nodelDocumentElements.find((item) => item.name === name);
      if (!element) throw new Error(`Missing document element ${name}`);
      return element;
    };
    expect(byName('nodel-control-grid').attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['xl', '2xl', 'fill']));
    expect(byName('nodel-group').attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['fill']));
    expect(byName('nodel-column').attributes.map((attribute) => attribute.name)).not.toContain('fill');
    expect(byName('nodel-stepper').attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['prefix', 'repeat-delay', 'repeat-interval', 'aria-label', 'aria-labelledby']));
    expect(byName('nodel-pad').attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['up-actions', 'down-actions', 'left-actions', 'right-actions', 'center-actions', 'up-arg', 'center-label']));
    expect(byName('nodel-palette').attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['custom-label', 'allow-deselect', 'aria-label', 'aria-labelledby']));
    expect(byName('nodel-readout').attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['unit', 'prefix', 'on-label', 'warn', 'danger', 'empty', 'aria-label']));
    expect(byName('nodel-page').attributes.map((attribute) => attribute.name)).toContain('nav-label');
    expect(byName('nodel-button').attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['value', 'color']));
    expect(byName('nodel-template').attributes.map((attribute) => attribute.name)).toContain('data-*');
    expect(byName('nodel-template').attributes.find((attribute) => attribute.name === 'data-*')?.completion).toBe('hidden');
    expect(byName('nodel-button').attributes.find((attribute) => attribute.name === 'action-on')?.legacy).toBeDefined();
    expect(nodelDocumentElements.flatMap((element) => element.attributes).some((attribute) => attribute.name.startsWith('data-nodel-native-'))).toBe(false);

    const effective = getEffectiveCatalogueAttributes('nodel-button');
    expect(effective.filter((attribute) => attribute.name === 'signals')).toHaveLength(1);
    expect(effective.find((attribute) => attribute.name === 'signals')?.description).toContain(':visibility');
    expect(effective.filter((attribute) => attribute.common).map((attribute) => attribute.name)).toEqual(commonNodelAttributes.filter((attribute) => attribute.name !== 'signals').map((attribute) => attribute.name));
    const rowEffective = getEffectiveCatalogueAttributes('nodel-row');
    expect(rowEffective.filter((attribute) => attribute.name === 'signals')).toHaveLength(1);
    expect(rowEffective.find((attribute) => attribute.name === 'signals')?.syntax).toContain('visibility(any|all)');
    expect(nodelHtmlCompletionSource(fakeCompletionContext('<nodel-row '))?.options.map((option) => option.label)).toContain('signals');
    expect(nodelHtmlCompletionSource(fakeCompletionContext('<nodel-row signals="'))?.options).toEqual([]);
    expect(byName('nodel-fader').attributes.find((attribute) => attribute.name === 'actions')?.description).toContain('live, commit');
    expect(byName('nodel-fader').attributes.find((attribute) => attribute.name === 'actions')?.description).not.toContain('change');
    expect(byName('nodel-stepper').attributes.find((attribute) => attribute.name === 'actions')?.description).toContain('live, commit, increase, decrease');
    expect(byName('nodel-stepper').attributes.find((attribute) => attribute.name === 'actions')?.description).not.toContain('change');
    expect(byName('nodel-palette').attributes.find((attribute) => attribute.name === 'actions')?.description).toContain('select, live, commit');
    expect(byName('nodel-button').attributes.find((attribute) => attribute.name === 'actions')?.syntax).toContain('ActionName[:phase]');
    expect(byName('nodel-pad').attributes.find((attribute) => attribute.name === 'up-actions')?.syntax).toContain('ActionName[:phase]');
    expect(byName('nodel-select').attributes.find((attribute) => attribute.name === 'options-signal')?.syntax).toBe('SignalName[.path]');
    expect(byName('nodel-button').attributes.find((attribute) => attribute.name === 'confirm')?.valueType).toBe('presence-or-text');
    expect(byName('nodel-button').attributes.find((attribute) => attribute.name === 'confirm-code-signal')?.syntax).toBe('LocalSignalAlias');
    expect(byName('nodel-button').attributes.find((attribute) => attribute.name === 'signals')?.syntax).toContain('[:target]');
    expect(byName('nodel-button').attributes.find((attribute) => attribute.name === 'signals')?.syntax).toContain('active(any|all)');
    expect(byName('nodel-button').attributes.find((attribute) => attribute.name === 'signal')?.syntax).toContain('[; or ,');
    expect(effective.find((attribute) => attribute.name === 'signals')?.syntax).toContain('visibility(any|all)');
    expect(byName('nodel-pad').attributes.find((attribute) => attribute.name === 'signal')?.syntax).toContain('SignalName[.path]:target');
    expect(byName('nodel-pad').attributes.find((attribute) => attribute.name === 'signal')?.syntax).not.toContain('[:target]');
    expect(byName('nodel-button').attributes.find((attribute) => attribute.name === 'disabled')?.valueType).toBe('boolean');
    expect(byName('nodel-app').attributes.find((attribute) => attribute.name === 'theme')?.values).toEqual(['default', 'light', 'dark']);
    expect(byName('nodel-button').attributes.find((attribute) => attribute.name === 'disabled')?.defaultValue).toBe('false');
    expect(byName('nodel-toggle').attributes.find((attribute) => attribute.name === 'variant')?.defaultValue).toBe('success');
    expect(byName('nodel-toggle').attributes.find((attribute) => attribute.name === 'on-label')?.defaultValue).toBe('On');
    expect(byName('nodel-button').attributes.find((attribute) => attribute.name === 'confirm-tone')?.defaultDescription).toContain('warning');
    expect(byName('nodel-button').attributes.find((attribute) => attribute.name === 'confirm-title')?.defaultDescription).toContain('contextual');
    expect(byName('nodel-toggle').attributes.find((attribute) => attribute.name === 'confirm-tone')?.defaultDescription).toContain('Derived');
    expect(byName('nodel-toggle').attributes.find((attribute) => attribute.name === 'confirm-title')?.defaultValue).toBe('Confirm toggle');
    expect(byName('nodel-toolbar').attributes.find((attribute) => attribute.name === 'icon-alt')?.defaultDescription).toContain('title');
    expect(byName('nodel-toolbar').attributes.find((attribute) => attribute.name === 'show-host-icon')?.valueType).toBe('boolean');
    expect(byName('nodel-toolbar').attributes.find((attribute) => attribute.name === 'show-host-icon')?.defaultValue).toBe('false');
    expect(byName('nodel-column').attributes.find((attribute) => attribute.name === 'md')?.defaultDescription).toContain('inherits');
    expect(byName('nodel-column').attributes.find((attribute) => attribute.name === 'md-order')?.defaultDescription).toContain('inherits');
    expect(byName('nodel-pad').attributes.find((attribute) => attribute.name === 'up-label')?.defaultDescription).toContain('pad accessible label');
    expect(byName('nodel-readout').attributes.find((attribute) => attribute.name === 'visual')?.defaultDescription).toContain('Derived');
    expect(byName('nodel-node-list').attributes.find((attribute) => attribute.name === 'page-size')?.values).toEqual(['10', '20', '50', '100', '99999']);
    expect(byName('nodel-node-list').attributes.find((attribute) => attribute.name === 'poll-interval')?.numeric).toMatchObject({ min: 0, exclusiveMin: true, unit: 'ms' });
    expect(byName('nodel-fader').attributes.find((attribute) => attribute.name === 'compound-align')?.values).toEqual(['bottom', 'center', 'top', 'end', 'right', 'start', 'left', 'middle']);
    expect(byName('nodel-fader').attributes.find((attribute) => attribute.name === 'compound-align')?.defaultValue).toBe('bottom');
    expect(new Set(byName('nodel-toggle').attributes.find((attribute) => attribute.name === 'on-icon')?.values)).toEqual(new Set(controlIconNames));
    expect(nodelHtmlCompletionSource(fakeCompletionContext('<nodel-toggle on-icon="'))?.options[0]?.label).toBe('sun');
    expect(byName('nodel-icon').attributes.find((attribute) => attribute.name === 'name')?.values?.[0]).toBe('image');
    expect(byName('nodel-icon').attributes.find((attribute) => attribute.name === 'name')?.valueType).toBe('enum-or-string');
    expect(byName('nodel-icon').attributes.find((attribute) => attribute.name === 'name')?.syntax).toContain('Generated catalogue');
    expect(new Set(byName('nodel-icon').attributes.find((attribute) => attribute.name === 'name')?.values)).toEqual(new Set(controlIconNames));
    expect(byName('nodel-icon').attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['family', 'style']));
    expect(byName('nodel-icon').attributes.find((attribute) => attribute.name === 'family')?.syntax).toContain('Generated catalogue');
    expect(byName('nodel-icon').attributes.find((attribute) => attribute.name === 'style')?.defaultDescription).toContain('manifest default');
    expect(
      byName('nodel-icon')
        .signalBindings.find((binding) => binding.attribute === 'signal')
        ?.targets.map((target) => target.name)
    ).toEqual(['name']);
    expect(
      byName('nodel-icon')
        .signalBindings.find((binding) => binding.attribute === 'signals')
        ?.targets.map((target) => target.name)
    ).toEqual(expect.arrayContaining(['name', 'family', 'style']));
    expect(byName('nodel-toggle').attributes.find((attribute) => attribute.name === 'on-icon')?.valueType).toBe('enum');
    expect(byName('nodel-status').attributes.find((attribute) => attribute.name === 'state')?.valueType).toBe('enum-or-string');
    expect(byName('nodel-status').attributes.find((attribute) => attribute.name === 'level')?.syntax).toBe('integer-prefixed text');
    expect(byName('nodel-stepper').attributes.find((attribute) => attribute.name === 'precision')?.syntax).toBe('integer-prefixed text');
    expect(byName('nodel-palette').attributes.find((attribute) => attribute.name === 'columns')?.syntax).toBe('integer-prefixed text');
    expect(byName('nodel-palette').attributes.find((attribute) => attribute.name === 'live-interval')?.syntax).toBe('integer-prefixed text');
    expect(byName('nodel-qrcode').attributes.find((attribute) => attribute.name === 'size')?.syntax).toBe('unsigned decimal');
    expect(byName('nodel-page').attributes.find((attribute) => attribute.name === 'nav-label')?.defaultDescription).toContain('title');
    expect(byName('nodel-page').attributes.find((attribute) => attribute.name === 'nav-id')?.defaultDescription).toContain('slugged');
    expect(byName('nodel-page').attributes.find((attribute) => attribute.name === 'arg-type')?.defaultValue).toBe('string');
    expect(nodelHtmlCompletionSource(fakeCompletionContext('<nodel-stepper repeat="'))?.options.map((option) => option.label)).toEqual(expect.arrayContaining(['hold', 'off']));
  });

  it('opts shipped visual page toolbars into host branding', async () => {
    for (const page of ['components.html', 'nodes.html', 'nodel.html', 'toolkit.html']) {
      const source = await readFile(resolve(process.cwd(), page), 'utf8');
      const template = document.createElement('template');
      template.innerHTML = source;
      const toolbars = template.content.querySelectorAll('nodel-toolbar');

      expect(toolbars, page).toHaveLength(1);
      expect(toolbars[0]?.hasAttribute('show-host-icon'), page).toBe(true);
    }
  });

  it('documents every public attribute observed by catalogue components', async () => {
    await import('../src/main');
    await loadNodelComponent('nodel-link');

    for (const element of nodelDocumentElements.filter((definition) => definition.catalogue)) {
      const constructor = customElements.get(element.name) as (CustomElementConstructor & { observedAttributes?: string[] }) | undefined;
      expect(constructor, element.name).toBeDefined();
      const documented = new Set([...element.attributes, ...commonNodelAttributes].map((attribute) => attribute.name));
      const observed = constructor?.observedAttributes ?? [];
      const missing = observed.filter((attribute) => !attribute.startsWith('data-nodel-native-') && !documented.has(attribute));
      expect(missing, element.name).toEqual([]);
    }
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
    const [mainSource, docsSource, stylesSource] = await Promise.all([readFile(resolve(process.cwd(), 'src/main.ts'), 'utf8'), readFile(resolve(process.cwd(), 'docs/web-components.md'), 'utf8'), readStyleSource()]);
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
    const catalogueComponents = toUniqueSorted(nodelDocumentElements.filter((element) => element.catalogue).map((element) => element.name));
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
    expect(catalogueComponents).toEqual(toUniqueSorted([...customComponents, 'nodel-link']));

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
    const expectedComponents = nodelDocumentElements.filter((element) => element.catalogue).map((element) => element.name);

    for (const component of expectedComponents) {
      expect(componentsUi).toContain(`<${component}`);
    }

    const template = document.createElement('template');
    template.innerHTML = componentsUi;
    const referenceMarkers = Array.from(template.content.querySelectorAll<HTMLElement>('[data-catalogue-reference]')).map((marker) => marker.dataset.catalogueReference ?? '');
    expect(referenceMarkers.filter(Boolean).sort()).toEqual([...expectedComponents].sort());
    expect(new Set(referenceMarkers).size).toBe(referenceMarkers.length);
    expect(componentsUi).toContain('src="/src/catalogue/component-reference.ts"');

    const internalControlClasses = ['nodel-select-trigger', 'nodel-stepper-button', 'nodel-pad-button', 'nodel-fader-nudge', 'nodel-theme-toggle-button', 'nodel-theme-switch', 'nodel-card', 'nodel-panel', 'nodel-popover'];

    for (const className of internalControlClasses) {
      expect(componentsUi).not.toContain(`class="${className}`);
      expect(componentsUi).not.toContain(`class=&quot;${className}`);
    }

    const runtimeComponents = ['nodel-node-list', 'nodel-add-node', 'nodel-diagnostics', 'nodel-host-log', 'nodel-diagnostic-charts', 'nodel-toolkit', 'nodel-description', 'nodel-console', 'nodel-log', 'nodel-actsig', 'nodel-params', 'nodel-bindings', 'nodel-editor', 'nodel-node-menu', 'nodel-toast-host', 'nodel-confirm-host', 'nodel-connectivity-host'];

    for (const component of runtimeComponents) {
      expect(componentsUi).not.toContain(`<${component}`);
      expect(componentsUi).not.toContain(`&lt;${component}`);
    }

    expect(componentsUi).toContain('data-nodel-runtime="memory"');
    expect(componentsUi).toContain('The catalogue marker installs the page-only in-memory action/signal runtime');
    expect(componentsUi).toContain('Do not copy it to node pages');

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
    const codeElements = Array.from(template.content.querySelectorAll<HTMLElement>('pre.nodel-catalogue-code[data-catalogue-code-for]'));
    const codeIds = codeElements.map((code) => code.dataset.catalogueCodeFor ?? '');
    const exampleIds = examples.map((example) => (example as HTMLElement).dataset.catalogueExample ?? '');

    expect(codeElements.length).toBeGreaterThan(0);
    expect(examples.length).toBeGreaterThan(0);
    expect(examples).toHaveLength(59);
    expect(codeElements).toHaveLength(59);
    expect(template.content.querySelectorAll('pre.nodel-catalogue-code')).toHaveLength(67);
    expect(codeIds.filter((id) => !id)).toEqual([]);
    expect(exampleIds.filter((id) => !id)).toEqual([]);
    expect(duplicateIds(codeIds)).toEqual([]);
    expect(duplicateIds(exampleIds)).toEqual([]);

    const codeBlocks = new Map(codeElements.map((code) => [code.dataset.catalogueCodeFor, code.querySelector('code')?.textContent ?? '']));

    expect(codeElements).toHaveLength(examples.length);

    for (const code of codeElements) {
      const markup = code.querySelector('code')?.textContent ?? '';
      const openingTags = markup.match(/<[^/!][^>]*>/g) ?? [];
      const authored = document.createElement('template');
      authored.innerHTML = markup;

      if (openingTags.length > 1) {
        expect(markup, `${code.dataset.catalogueCodeFor} should format nested markup across lines`).toContain('\n');
      }
      expect(authored.content.querySelector('[class*="nodel-catalogue"]'), `${code.dataset.catalogueCodeFor} copied catalogue chrome`).toBeNull();
      expect(authored.content.querySelector('[data-catalogue-example], [data-catalogue-code-for], [data-catalogue-reference]'), `${code.dataset.catalogueCodeFor} copied catalogue metadata`).toBeNull();
    }

    for (const example of examples) {
      const id = (example as HTMLElement).dataset.catalogueExample;
      const sectionHeading = example.closest('section')?.querySelector(':scope > header h2');
      expect(codeBlocks.has(id)).toBe(true);
      expect(sectionHeading?.textContent?.trim(), `${id} should have explanatory section guidance`).toBeTruthy();
      expect(example.querySelector('.nodel-catalogue-examples'), `${id} should not double-wrap catalogue chrome`).toBeNull();
      expect(normaliseLiveExample(example)).toBe(normaliseExampleMarkup(codeBlocks.get(id) ?? ''));
      codeBlocks.delete(id);
    }

    expect(Array.from(codeBlocks.keys()).filter(Boolean)).toEqual([]);
  });

  it('keeps authored catalogue code readable at every nesting level', async () => {
    const componentsUi = await readFile(resolve(process.cwd(), 'components.html'), 'utf8');
    const template = document.createElement('template');
    template.innerHTML = componentsUi;
    const codeElements = Array.from(template.content.querySelectorAll<HTMLElement>('pre.nodel-catalogue-code code'));
    const entityDecoded = (value: string) => value
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&amp;', '&');
    const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
    const protectedElements = new Set(['template', 'script', 'pre', 'textarea']);

    expect(codeElements).toHaveLength(67);
    for (const code of codeElements) {
      const lines = (code.textContent ?? '').split('\n');
      let depth = 0;
      const protectedDepths: number[] = [];

      expect(lines[0], code.parentElement?.dataset.catalogueCodeFor).not.toBe('');
      expect(lines.at(-1), code.parentElement?.dataset.catalogueCodeFor).not.toBe('');
      for (const line of lines) {
        const decoded = entityDecoded(line);
        const tags = [...decoded.matchAll(/<\/?([A-Za-z][\w:-]*)(?:\s[^>]*)?>/g)];
        const inProtectedContent = protectedDepths.length > 0;
        if (!line.trim()) {
          expect(inProtectedContent, code.parentElement?.dataset.catalogueCodeFor).toBe(true);
          continue;
        }

        const expectedIndent = /^\s*<\//.test(decoded) ? Math.max(0, depth - 1) : depth;
        expect(line.match(/^ */)?.[0].length, code.parentElement?.dataset.catalogueCodeFor).toBe(expectedIndent * 2);
        for (const tag of tags) {
          const fullTag = tag[0];
          const name = tag[1]?.toLowerCase();
          if (!name) continue;
          if (fullTag.startsWith('</')) {
            depth = Math.max(0, depth - 1);
            if (protectedElements.has(name)) protectedDepths.pop();
          } else if (!fullTag.endsWith('/>') && !voidElements.has(name)) {
            depth += 1;
            if (protectedElements.has(name)) protectedDepths.push(depth);
          }
        }
      }
      expect(depth, code.parentElement?.dataset.catalogueCodeFor).toBe(0);
    }

    const iconsOptions = template.content.querySelector<HTMLElement>('[data-catalogue-code-for="icons-options"] code')?.textContent ?? '';
    expect(iconsOptions.split('\n')).toEqual([
      '<nodel-control-grid columns="2" md="4">',
      '  <nodel-group label="Info" surface="panel" padding="compact">',
      '    <nodel-icon name="info" tone="info"></nodel-icon>',
      '  </nodel-group>',
      '  <nodel-group label="Danger" surface="card">',
      '    <nodel-icon name="warning" tone="danger"></nodel-icon>',
      '  </nodel-group>',
      '</nodel-control-grid>'
    ]);
    const faderHorizontal = template.content.querySelector<HTMLElement>('[data-catalogue-code-for="faders-horizontal"] code')?.textContent ?? '';
    expect(faderHorizontal).toContain('increment=""');
    expect(faderHorizontal.split('\n')[0]).toBe('<nodel-control-grid>');
  });

  it('keeps the production Quickstart scaffold first and copy-safe', async () => {
    const componentsUi = await readFile(resolve(process.cwd(), 'components.html'), 'utf8');
    const template = document.createElement('template');
    template.innerHTML = componentsUi;
    const app = template.content.querySelector('nodel-app');
    const pages = Array.from(app?.children ?? []).filter((element): element is HTMLElement => element.matches('nodel-page'));
    const quickstart = pages[0];
    const quickstartText = quickstart?.textContent?.replace(/\s+/g, ' ') ?? '';
    const scaffold = template.content.querySelector<HTMLElement>('[data-catalogue-quickstart-code] code')?.textContent ?? '';

    expect(quickstart?.getAttribute('title')).toBe('Quickstart');
    expect(pages[1]?.getAttribute('title')).toBe('App & Layout');
    expect(template.content.querySelector('[data-catalogue-quickstart]')).not.toBeNull();
    expect(quickstartText).toContain('content/index.html');
    expect(quickstartText).toContain('open it automatically');
    expect(quickstartText).toContain('content/control.html');
    expect(scaffold).toContain('<!doctype html>');
    expect(scaffold).toContain('<link rel="stylesheet" href="./v2/nodel-webui.css" />');
    expect(scaffold).toContain('<script type="module" src="./v2/nodel-webui.js"></script>');
    expect(scaffold).toContain('<html lang="en">');
    expect(scaffold).toContain('<nodel-app title="YOUR BROWSER TAB TITLE" theme="dark">');
    expect(scaffold).toContain('<nodel-toolbar title="YOUR TOOLBAR TITLE"></nodel-toolbar>');
    expect(scaffold).toContain('<nodel-page title="YOUR NAVIGATION TAB TITLE">');
    expect(scaffold).toContain('<nodel-title level="1">YOUR PAGE HEADING</nodel-title>');
    expect(scaffold).not.toContain('<title>');
    expect(scaffold).not.toContain('data-theme=');
    expect(scaffold).not.toContain('<nodel-theme-toggle>');
    expect((scaffold.match(/\btheme="/g) ?? []).length).toBe(1);
    expect(scaffold).toContain('<nodel-row>');
    expect(scaffold).toContain('<nodel-column>');
    expect(scaffold).toContain('<nodel-text>Your content goes here.</nodel-text>');
    expect(scaffold).not.toContain('/src/');
    expect(scaffold).not.toContain('data-nodel-runtime');
    expect(scaffold).not.toContain('offline-mode');
    expect(scaffold).not.toContain("localStorage.getItem('nodel.theme')");
  });

  it('keeps the catalogue component-first structure and guide boundaries', async () => {
    const source = await readFile(resolve(process.cwd(), 'components.html'), 'utf8');
    const template = document.createElement('template');
    template.innerHTML = source;
    const app = template.content.querySelector('nodel-app');
    const pages = Array.from(app?.children ?? []).filter((element): element is HTMLElement => element.matches('nodel-page'));
    expect(pages.map((page) => page.getAttribute('title'))).toEqual(['Quickstart', 'App & Layout', 'Controls', 'Display & Content', 'Guides']);

    const childTitles = (title: string) =>
      Array.from(pages.find((page) => page.getAttribute('title') === title)?.children ?? [])
        .filter((element): element is HTMLElement => element.matches('nodel-page'))
        .map((page) => page.getAttribute('title'));
    expect(childTitles('App & Layout')).toEqual(['App', 'Toolbar', 'Pages', 'Footer', 'Theme Toggle', 'Rows & Columns', 'Control Grid & Spacer', 'Groups', 'Collapse', 'Templates']);
    expect(childTitles('Controls')).toEqual(['Buttons', 'Toggles', 'Segmented Choices', 'Select', 'Faders', 'Steppers', 'Directional Pads', 'Palette', 'Keyboard Shortcuts']);
    expect(childTitles('Display & Content')).toEqual(['Titles', 'Text', 'Markdown', 'Images', 'Icons', 'QR Codes', 'Readouts', 'Meters', 'Status Indicators', 'Status Blocks', 'Clock', 'Host Icon', 'Links']);

    const guideGroup = pages.find((page) => page.getAttribute('title') === 'Guides');
    expect(
      Array.from(guideGroup?.children ?? [])
        .filter((element): element is HTMLElement => element.matches('nodel-page'))
        .map((page) => page.getAttribute('title'))
    ).toEqual(['Page Sizing', 'Actions & Signals', 'Visibility', 'Dynamic Options', 'Appearance', 'Confirmations']);
    expect(guideGroup?.querySelector('[data-catalogue-reference]')).toBeNull();
    expect(template.content.querySelector('[data-catalogue-example="select-stepper"]')).toBeNull();
    expect(template.content.querySelector('[data-catalogue-example="media-standalone-media"]')).toBeNull();
    expect(template.content.querySelector('[data-catalogue-example="media-image-options"]')).toBeNull();
    expect(template.content.querySelector('[data-catalogue-example="links-native-choices"]')).toBeNull();
    expect(template.content.querySelector('[data-catalogue-example="content-page-primitives"]')).toBeNull();
    expect(template.content.querySelector('nodel-page[title="Visibility Examples"]')).toBeNull();
    expect(template.content.querySelector('nodel-page[title="Control Grid"]')).toBeNull();

    const leafPages = Array.from(template.content.querySelectorAll<HTMLElement>('nodel-page')).filter((page) => !Array.from(page.children).some((child) => child.matches('nodel-page')));
    const leafIds = leafPages.map((page) => page.getAttribute('nav-id') || (page.getAttribute('title') ?? '').replace(/[^A-Za-z0-9]/g, ''));
    expect(leafPages).toHaveLength(39);
    expect(leafIds.filter(Boolean)).toHaveLength(39);
    expect(duplicateIds(leafIds)).toEqual([]);

    const linkedRoutes = Array.from(template.content.querySelectorAll<HTMLElement>('a[href^="#"], nodel-link[href^="#"]'))
      .map((link) => link.getAttribute('href')?.slice(1) ?? '')
      .filter(Boolean);
    expect(linkedRoutes.filter((route) => !leafIds.includes(route))).toEqual([]);

    for (const page of pages.filter((group) => group !== guideGroup).flatMap((group) => Array.from(group.children).filter((element): element is HTMLElement => element.matches('nodel-page')))) {
      const title = page.getAttribute('title') ?? '';
      expect(page.querySelector('h1')?.textContent?.trim(), title).toBe(title);
      const related = Array.from(page.querySelectorAll('section')).find((section) => section.querySelector('h2')?.textContent?.trim() === 'Related');
      expect(related, title).toBeDefined();
      const reference = page.querySelector('[data-catalogue-reference]');
      expect(reference, title).not.toBeNull();
      expect(page.querySelectorAll('pre.nodel-catalogue-code').length, title).toBeGreaterThan(0);
      if (!['App', 'Toolbar', 'Pages', 'Theme Toggle', 'Keyboard Shortcuts'].includes(title)) {
        expect(page.querySelector('[data-catalogue-example]'), title).not.toBeNull();
      }
      expect(reference?.compareDocumentPosition(related as Element), title).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    for (const guide of Array.from(guideGroup?.children ?? []).filter((element): element is HTMLElement => element.matches('nodel-page'))) {
      const title = guide.getAttribute('title') ?? '';
      expect(guide.querySelector('h1')?.textContent?.trim(), title).toBe(title);
      expect(guide.querySelector('.nodel-catalogue-description')?.textContent?.trim().length, title).toBeGreaterThan(80);
      expect(guide.querySelector('.nodel-catalogue-related'), title).not.toBeNull();
    }

    const exampleOwner = (id: string) => template.content.querySelector(`[data-catalogue-example="${id}"]`)?.closest('nodel-page')?.getAttribute('title');
    expect(exampleOwner('select-options')).toBe('Select');
    expect(exampleOwner('stepper-options')).toBe('Steppers');
    expect(exampleOwner('images-standalone')).toBe('Images');
    expect(exampleOwner('icons-standalone')).toBe('Icons');
    expect(exampleOwner('images-options')).toBe('Images');
    expect(exampleOwner('icons-options')).toBe('Icons');
    expect(exampleOwner('links')).toBe('Links');
    expect(exampleOwner('native-choices')).toBe('Appearance');
    expect(exampleOwner('markdown')).toBe('Markdown');
    expect(exampleOwner('clock')).toBe('Clock');
    expect(exampleOwner('status-links')).toBe('Status Blocks');
    expect(exampleOwner('footer-flow')).toBe('Footer');

    const nativeChoices = template.content.querySelector('[data-catalogue-example="native-choices"]');
    const nativeChoice = nativeChoices?.querySelector('input.nodel-choice[type="checkbox"]');
    const nativeField = nativeChoices?.querySelector('input.nodel-field');
    expect(nativeChoice).not.toBeNull();
    expect(nativeField).not.toBeNull();
    expect(Array.from(nativeChoices?.querySelectorAll('input') ?? []).map((input) => input.classList[0])).toEqual(['nodel-choice', 'nodel-field']);
    expect(nativeField?.getAttribute('value')).toBe('Field value');

    const footerExample = template.content.querySelector('[data-catalogue-example="footer-flow"]');
    const footerCode = template.content.querySelector<HTMLElement>('[data-catalogue-code-for="footer-flow"] code')?.textContent ?? '';
    expect(footerExample?.querySelector('nodel-link')?.getAttribute('href')).toBe('#Footer');
    expect(footerCode).toContain('href="#Footer"');

    const purposeBlock = (purpose: string) => template.content.querySelector<HTMLElement>(`pre[data-catalogue-purpose="${purpose}"]`);
    const singleDisplay = purposeBlock('single-display-composition');
    const viewportLayout = purposeBlock('viewport-page-layout');
    expect(template.content.querySelectorAll('[data-catalogue-purpose]')).toHaveLength(2);
    expect(singleDisplay?.closest('nodel-page')?.getAttribute('title')).toBe('Readouts');
    expect(singleDisplay?.closest('section')?.querySelector('h2')?.textContent?.trim()).toBe('Single-display composition');
    expect(singleDisplay?.textContent).toContain('<nodel-page title="Readout" min-height="viewport" bleed>');
    expect(singleDisplay?.textContent).toContain('<nodel-control-grid fill>');
    expect(singleDisplay?.textContent).toContain('ring-layout="edge" signal="Brightness"');
    expect(viewportLayout?.closest('nodel-page')?.getAttribute('title')).toBe('Page Sizing');
    expect(viewportLayout?.closest('section')?.querySelector('h2')?.textContent?.trim()).toBe('Viewport page layout');
    expect(viewportLayout?.textContent).toContain('<nodel-toolbar></nodel-toolbar>');
    expect(viewportLayout?.textContent).toContain('<nodel-page title="Controls" min-height="viewport">');
    expect(viewportLayout?.textContent).toContain('<nodel-footer>Ready</nodel-footer>');

    const normalizedPageText = (title: string) => template.content.querySelector(`nodel-page[title="${title}"]`)?.textContent?.replace(/\s+/g, ' ') ?? '';
    const dynamicOptionsText = normalizedPageText('Dynamic Options');
    expect(dynamicOptionsText).toContain('Authored child options remain visible during initial loading');
    expect(dynamicOptionsText).toContain('A valid empty array removes all choices');
    expect(dynamicOptionsText).toContain('invalid payload keeps the current, last-valid option set');
    expect(dynamicOptionsText).toContain('removing the options binding restores the authored options');

    const actionsSignalsText = normalizedPageText('Actions & Signals');
    expect(actionsSignalsText).toContain("unphased actions use the control's default trigger phase");
    expect(actionsSignalsText).toContain('ActionName:phase');
    expect(actionsSignalsText).toContain('signals="Name:target"');
    expect(actionsSignalsText).toContain('join="Name" combines the same-name default action and signal binding');
    expect(actionsSignalsText).toContain('active feedback matches the signal value against arg');
    const actionsSignalsCode = template.content.querySelector<HTMLElement>('[data-catalogue-code-for="buttons-actions-signals"] code')?.textContent ?? '';
    expect(actionsSignalsCode).toContain('actions="PrepareShow; StartShow:click"');
    expect(actionsSignalsCode).toContain('signals="ShowRunning:active; ControlsLocked:disabled"');
    expect(actionsSignalsCode).toContain('join="Power"');

    const expectedOwners: Record<string, string> = {
      'nodel-app': 'App',
      'nodel-toolbar': 'Toolbar',
      'nodel-page': 'Pages',
      'nodel-footer': 'Footer',
      'nodel-theme-toggle': 'Theme Toggle',
      'nodel-row': 'Rows & Columns',
      'nodel-column': 'Rows & Columns',
      'nodel-control-grid': 'Control Grid & Spacer',
      'nodel-control-space': 'Control Grid & Spacer',
      'nodel-group': 'Groups',
      'nodel-collapse': 'Collapse',
      'nodel-template': 'Templates',
      'nodel-button': 'Buttons',
      'nodel-toggle': 'Toggles',
      'nodel-segmented': 'Segmented Choices',
      'nodel-select': 'Select',
      'nodel-fader': 'Faders',
      'nodel-stepper': 'Steppers',
      'nodel-pad': 'Directional Pads',
      'nodel-palette': 'Palette',
      'nodel-shortcut': 'Keyboard Shortcuts',
      'nodel-title': 'Titles',
      'nodel-text': 'Text',
      'nodel-markdown': 'Markdown',
      'nodel-image': 'Images',
      'nodel-icon': 'Icons',
      'nodel-qrcode': 'QR Codes',
      'nodel-readout': 'Readouts',
      'nodel-meter': 'Meters',
      'nodel-status-indicator': 'Status Indicators',
      'nodel-status': 'Status Blocks',
      'nodel-clock': 'Clock',
      'nodel-host-icon': 'Host Icon',
      'nodel-link': 'Links'
    };
    for (const [component, owner] of Object.entries(expectedOwners)) {
      const marker = template.content.querySelector(`[data-catalogue-reference="${component}"]`);
      expect(marker, component).not.toBeNull();
      expect(marker?.closest('nodel-page')?.getAttribute('title'), component).toBe(owner);
    }
  });
});
