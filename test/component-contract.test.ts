import {
  componentContractDocument,
  componentContractStyles,
  componentContracts,
  diffComponentContracts,
  serializeComponentContract,
  validateComponentContract
} from '../src/component-contract';
import { findNodelElement, getEffectiveCatalogueAttributes, nodelDocumentElements } from '../src/nodel-component-metadata';
import { NodelPage } from '../src/components/nodel-page';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('component contract', () => {
  it('has explicit classifications, consumption, structured controls, and stable styles', () => {
    const page = componentContracts.find((element) => element.name === 'nodel-page')!;
    const button = componentContracts.find((element) => element.name === 'nodel-button')!;
    const pad = componentContracts.find((element) => element.name === 'nodel-pad')!;
    const link = componentContracts.find((element) => element.name === 'nodel-link')!;
    const host = componentContracts.find((element) => element.name === 'nodel-toast-host')!;
    expect(page.attributes.find((attribute) => attribute.name === 'title')).toMatchObject({ consumption: 'parent', lifecycle: 'initialization', consumer: 'nodel-app' });
    expect((NodelPage as typeof NodelPage & { observedAttributes?: string[] }).observedAttributes ?? []).toEqual(['action', 'actions', 'arg', 'arg-type']);
    expect(page.actionBindings).toEqual(expect.arrayContaining([{ attribute: 'action', phases: ['activate'], defaultPhase: 'activate' }, { attribute: 'actions', phases: ['activate'], defaultPhase: 'activate' }]));
    expect(button.actionBindings).toEqual(expect.arrayContaining([
      { attribute: 'action', phases: ['click', 'press', 'release'], defaultPhase: 'click' },
      { attribute: 'actions', phases: ['click', 'press', 'release'], defaultPhase: 'click' },
      { attribute: 'join', phases: ['click'], defaultPhase: 'click' },
      { attribute: 'action-on', phases: ['press'], defaultPhase: 'press' },
      { attribute: 'action-off', phases: ['release'], defaultPhase: 'release' }
    ]));
    expect(button.signalBindings.find((binding) => binding.attribute === 'signals')).toMatchObject({ defaultTarget: 'active', targets: expect.arrayContaining([{ name: 'active', aggregations: ['any', 'all'] }, { name: 'disabled', aggregations: ['any', 'all'] }]) });
    expect(button.signalBindings.find((binding) => binding.attribute === 'join')).toEqual({ attribute: 'join', defaultTarget: 'active', targets: [{ name: 'active', aggregations: [] }] });
    expect(pad.actionBindings.find((binding) => binding.attribute === 'up-action')?.phases).toEqual(['click', 'press', 'release']);
    expect(componentContracts.find((element) => element.name === 'nodel-editor')?.attributes.find((attribute) => attribute.name === 'default-file')?.lifecycle).toBe('initialization');
    expect(button.attributes.find((attribute) => attribute.name === 'value')).toMatchObject({ consumption: 'contextual-child' });
    expect(link).toMatchObject({ audience: 'core', registration: 'lazy', completion: 'advanced', catalogue: true });
    expect(host).toMatchObject({ audience: 'internal', registration: 'auto-host', completion: 'hidden' });
    expect(Object.values(componentContractStyles).flat().map((style) => style.name)).toEqual(expect.arrayContaining(['nodel-button', 'nodel-alert-danger', 'text-nodel-muted', 'rounded-panel']));
  });

  it('serializes a deterministic, JSON-safe schema document', () => {
    const first = serializeComponentContract('1.2.3');
    expect(first).toBe(serializeComponentContract('1.2.3'));
    expect(first.endsWith('\n')).toBe(true);
    const serialized = JSON.parse(first);
    expect(serialized).toMatchObject({ schemaVersion: 1, packageVersion: '1.2.3' });
    expect(serialized.elements.find((element: { name: string }) => element.name === 'nodel-node-list').attributes
      .map((attribute: { name: string }) => attribute.name)).not.toEqual(expect.arrayContaining(['show-filter', 'show-total']));
    expect(validateComponentContract(componentContractDocument('1.2.3'))).toEqual([]);
  });

  it('rejects invalid contract data with deterministic addressed errors', () => {
    const document = structuredClone(componentContractDocument('1.2.3'));
    document.elements[0].name = 'bad name';
    document.elements[1].name = 'bad name';
    document.elements[0].attributes[0].values = ['same', 'same'];
    document.elements[0].attributes[0].valueType = 'string';
    document.elements[0].attributes[0].numeric = { min: 2, max: 1 };
    document.elements[0].attributes[0].defaultValue = '0';
    document.elements[0].attributes[0].consumer = 'nodel-missing';
    document.elements[0].registration = 'auto-host';
    document.elements[0].audience = 'custom';
    document.elements[0].completion = 'recommended';
    document.elements[0].attributes[0].description = undefined as never;
    const errors = validateComponentContract(document);
    expect(errors).toEqual([...errors].sort((a, b) => a.localeCompare(b)));
    expect(errors.join('\n')).toContain('elements[0].name: invalid element name');
    expect(errors.join('\n')).toContain('elements[1].name: duplicate element bad name');
    expect(errors.join('\n')).toContain('auto-host elements must be internal');
    expect(errors.join('\n')).toContain('consumer: invalid reference nodel-missing');
    expect(errors.join('\n')).toContain('contains non-JSON plain data');
  });

  it('validates structured bindings, event detail, styles, and plain JSON objects', () => {
    const document = structuredClone(componentContractDocument('1.2.3'));
    const button = document.elements.find((element) => element.name === 'nodel-button')!;
    button.actionBindings.push({ ...button.actionBindings[0] });
    button.actionBindings[0].phases = [];
    const signals = button.signalBindings.find((binding) => binding.attribute === 'signals')!;
    signals.defaultTarget = 'missing';
    signals.targets[0].aggregations.push('any');
    button.events.push({ name: 'nodel-test', description: 'test', bubbles: true, composed: true, detailFields: ['value', 'value'] });
    document.styles.stateClasses.push({ ...document.styles.semanticClasses[0] });
    Object.setPrototypeOf(button.attributes[0], null);
    const errors = validateComponentContract(document);
    expect(errors).toEqual([...errors].sort((a, b) => a.localeCompare(b)));
    expect(errors).toEqual(expect.arrayContaining([
      'elements[10].actionBindings: duplicate action attribute',
      'elements[10].actionBindings.action.phases: must not be empty',
      'elements[10].signalBindings.signals.defaultTarget: absent target',
      'elements[10].signalBindings.signals.targets.active.aggregations: duplicate aggregation',
      'elements[10].events.nodel-test.detailFields: duplicate detail field',
      'styles: duplicate style name nodel-button'
    ]));
  });

  it('rejects invalid value-type defaults and empty enum declarations', () => {
    const document = structuredClone(componentContractDocument('1.2.3'));
    const button = document.elements.find((element) => element.name === 'nodel-button')!;
    button.attributes.find((attribute) => attribute.name === 'disabled')!.defaultValue = 'maybe';
    button.attributes.find((attribute) => attribute.name === 'variant')!.values = [];
    expect(validateComponentContract(document)).toEqual(expect.arrayContaining([
      'elements[10].attributes[0].values: must not be empty',
      'elements[10].attributes[11].defaultValue: boolean default must be true or false'
    ]));
  });

  it('removes phantom node-list attributes while preserving legacy projections', () => {
    const nodeList = findNodelElement('nodel-node-list')!;
    expect(nodeList.attributes.map((attribute) => attribute.name)).not.toEqual(expect.arrayContaining(['show-filter', 'show-total']));
    expect(nodelDocumentElements.map((element) => element.name)).toEqual(componentContracts.map((element) => element.name));
    expect(getEffectiveCatalogueAttributes('nodel-button').filter((attribute) => attribute.name === 'signals')).toHaveLength(1);
  });

  it('publishes every documented stable authoring class', async () => {
    const guidance = await readFile(resolve(process.cwd(), 'docs/web-components.md'), 'utf8');
    const section = guidance.slice(guidance.indexOf('## Shared Styling Classes'), guidance.indexOf('## Links'));
    const documented = Array.from(new Set(Array.from(section.matchAll(/`\.([a-z][a-z0-9-]+)`/g), (match) => match[1]))).sort();
    const published = Object.values(componentContractStyles).flat().map((style) => style.name).filter((name) => !name.startsWith('text-') && !name.startsWith('bg-') && !name.startsWith('border-') && !name.startsWith('ring-') && !name.startsWith('rounded-')).sort();
    expect(published).toEqual(documented);
  });

  it('classifies element, attribute, enum, style, and registration changes', () => {
    const before = componentContractDocument('1.2.3');
    const after = structuredClone(before);
    after.elements = after.elements.filter((element) => element.name !== 'nodel-clock');
    const button = after.elements.find((element) => element.name === 'nodel-button')!;
    button.attributes = button.attributes.filter((attribute) => attribute.name !== 'active');
    button.attributes.find((attribute) => attribute.name === 'variant')!.values!.push('new-tone');
    button.registration = 'lazy';
    button.completion = 'advanced';
    after.styles.semanticClasses = after.styles.semanticClasses.filter((style) => style.name !== 'nodel-button');
    const diff = diffComponentContracts(before, after);
    expect(diff.breaking).toEqual(expect.arrayContaining(['elements.nodel-clock: removed', 'elements.nodel-button.attributes.active: removed', 'styles.semanticClasses: removed nodel-button']));
    expect(diff.additive).toContain('elements.nodel-button.attributes.variant.values: added new-tone');
    expect(diff.breaking).toContain('elements.nodel-button.completion: downgraded');
    expect(diff.operational).toContain('elements.nodel-button.registration: changed');
  });

  it('classifies common attributes, consumption, completion, and numeric narrowing', () => {
    const before = componentContractDocument('1.2.3');
    const after = structuredClone(before);
    after.commonAttributes = after.commonAttributes.filter((attribute) => attribute.name !== 'visibility');
    const repeat = after.elements.find((element) => element.name === 'nodel-template')!.attributes.find((attribute) => attribute.name === 'repeat')!;
    repeat.numeric = { ...repeat.numeric, min: 2 };
    repeat.completion = 'hidden';
    repeat.consumption = 'parent';
    repeat.consumer = 'nodel-template';
    const diff = diffComponentContracts(before, after);
    expect(diff.breaking).toEqual(expect.arrayContaining([
      'commonAttributes.visibility: removed',
      'elements.nodel-template.attributes.repeat.completion: downgraded',
      'elements.nodel-template.attributes.repeat.consumption: changed',
      'elements.nodel-template.attributes.repeat.numeric: narrowed'
    ]));

    const widened = structuredClone(before);
    widened.elements.find((element) => element.name === 'nodel-template')!.attributes.find((attribute) => attribute.name === 'repeat')!.numeric = undefined;
    expect(diffComponentContracts(before, widened).breaking).not.toContain('elements.nodel-template.attributes.repeat.numeric: narrowed');
  });

  it('classifies catalogue, derived default, composition, event, and style-category changes', () => {
    const before = componentContractDocument('1.2.3');
    const after = structuredClone(before);
    const button = after.elements.find((element) => element.name === 'nodel-button')!;
    button.catalogue = false;
    button.attributes.find((attribute) => attribute.name === 'variant')!.defaultDescription = 'Different derived behavior.';
    const space = after.elements.find((element) => element.name === 'nodel-control-space')!;
    space.composition!.requiredParent = 'nodel-row';
    const appEvent = after.elements.find((element) => element.name === 'nodel-app')!.events[0];
    appEvent.description = 'Updated prose.';
    const style = after.styles.semanticClasses.shift()!;
    after.styles.stateClasses.push(style);
    const diff = diffComponentContracts(before, after);
    expect(diff.breaking).toEqual(expect.arrayContaining([
      'elements.nodel-button.catalogue: disabled',
      'elements.nodel-button.attributes.variant.defaultDescription: changed',
      'elements.nodel-control-space.composition: tightened',
      `styles.semanticClasses: removed ${style.name}`
    ]));
    expect(diff.additive).toContain(`styles.stateClasses: added ${style.name}`);
    expect(diff.informational).toContain(`elements.nodel-app.events.${appEvent.name}.description: changed`);
  });
});
