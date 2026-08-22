import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { componentContracts } from '../src/component-contract';
import { loadNodelComponent } from '../src/nodel-component-loader';
import '../src/main';

const nonReactiveAttributes = new Set([
  'nodel-page.nav-id',
  'nodel-page.nav-label',
  'nodel-page.title',
  'nodel-template.data-*',
  'nodel-button.border',
  'nodel-button.color',
  'nodel-button.value',
  'nodel-console.collapse-preview',
  'nodel-control-grid.fill',
  'nodel-group.fill'
]);

const internalComponentEvents = new Set([
  'nodel-app-title-change',
  'nodel-navigation-change',
  'nodel-nav-select',
  'nodel-toast'
]);

function importedComponents(source: string, prefix: string) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Array.from(source.matchAll(new RegExp(`['"]${escaped}(nodel-[a-z0-9-]+)['"]`, 'g')), (match) => match[1])
    .filter((name): name is string => name !== undefined);
}

describe('component contract runtime alignment', () => {
  beforeAll(async () => {
    await Promise.all(componentContracts
      .filter((element) => element.registration === 'lazy')
      .map((element) => loadNodelComponent(element.name)));
  });

  it('keeps observed attributes and canonical consumption modes bidirectionally aligned', () => {
    for (const element of componentContracts) {
      const constructor = customElements.get(element.name) as (CustomElementConstructor & { observedAttributes?: string[] }) | undefined;
      expect(constructor, element.name).toBeDefined();
      const observed = new Set(constructor?.observedAttributes ?? []);
      const declared = new Map(element.attributes.map((attribute) => [attribute.name, attribute]));

      for (const attribute of observed) {
        if (attribute.startsWith('data-nodel-native-')) continue;
        expect(declared.get(attribute)?.consumption, `${element.name}.${attribute}`).toBe('observed');
      }

      for (const attribute of element.attributes) {
        if (attribute.consumption === 'observed') {
          expect(observed.has(attribute.name), `${element.name}.${attribute.name}`).toBe(true);
        } else {
          expect(observed.has(attribute.name), `${element.name}.${attribute.name}`).toBe(false);
        }
      }
    }
  });

  it('keeps parent-consumed fill out of child observed attributes', () => {
    for (const name of ['nodel-group', 'nodel-control-grid']) {
      const element = componentContracts.find((candidate) => candidate.name === name)!;
      const constructor = customElements.get(name) as { observedAttributes?: string[] };
       expect(element.attributes.find((attribute) => attribute.name === 'fill')).toMatchObject({ consumption: 'parent', consumer: 'nodel-column,nodel-page' });
      expect(constructor.observedAttributes ?? []).not.toContain('fill');
    }
  });

  it('keeps every non-reactive attribute explicit and reviewable', () => {
    const actual = componentContracts.flatMap((element) => element.attributes
      .filter((attribute) => attribute.consumption !== 'observed')
      .map((attribute) => `${element.name}.${attribute.name}`));
    expect(new Set(actual)).toEqual(nonReactiveAttributes);
  });

  it('keeps registration and audience aligned with eager and lazy source ownership', async () => {
    const [mainSource, loaderSource] = await Promise.all([
      readFile(resolve(process.cwd(), 'src/main.ts'), 'utf8'),
      readFile(resolve(process.cwd(), 'src/nodel-component-loader.ts'), 'utf8')
    ]);
    const eagerImports = new Set(importedComponents(mainSource, './components/'));
    const lazyImports = new Set(importedComponents(loaderSource, './components/'));

    for (const element of componentContracts) {
      if (element.registration === 'eager') {
        expect(eagerImports.has(element.name), element.name).toBe(true);
        expect(element.audience, element.name).toBe('custom');
      } else if (element.registration === 'lazy') {
        expect(lazyImports.has(element.name), element.name).toBe(true);
        expect(element.audience, element.name).toBe('core');
      } else {
        expect(element.audience, element.name).toBe('internal');
        expect(element.completion, element.name).toBe('hidden');
      }
    }
  });

  it('keeps declared public events aligned with component dispatch sites', async () => {
    for (const element of componentContracts) {
      const source = await readFile(resolve(process.cwd(), `src/components/${element.name}.ts`), 'utf8');
      const dispatched = new Set([
        ...Array.from(source.matchAll(/new CustomEvent(?:<[^>]+>)?\(\s*['"](nodel-[a-z0-9-]+)['"]/g), (match) => match[1]),
        ...Array.from(source.matchAll(/eventName:\s*['"](nodel-[a-z0-9-]+)['"]/g), (match) => match[1])
      ].filter((name): name is string => name !== undefined && !internalComponentEvents.has(name)));
      expect(new Set(element.events.map((event) => event.name)), element.name).toEqual(dispatched);
    }
  });
});
