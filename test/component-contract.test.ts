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

function required<T>(value: T | undefined | null, description: string): T {
  if (value === undefined || value === null) throw new Error(`Missing ${description}`);
  return value;
}

describe('component contract', () => {
  it('has explicit classifications, consumption, structured controls, and stable styles', () => {
    const page = required(componentContracts.find((element) => element.name === 'nodel-page'), 'page contract');
    const button = required(componentContracts.find((element) => element.name === 'nodel-button'), 'button contract');
    const pad = required(componentContracts.find((element) => element.name === 'nodel-pad'), 'pad contract');
    const link = required(componentContracts.find((element) => element.name === 'nodel-link'), 'link contract');
    const host = required(componentContracts.find((element) => element.name === 'nodel-toast-host'), 'toast host contract');
    expect(page.attributes.find((attribute) => attribute.name === 'title')).toMatchObject({ consumption: 'parent', lifecycle: 'initialization', consumer: 'nodel-app' });
    expect(page.attributes.find((attribute) => attribute.name === 'min-height')).toMatchObject({ values: ['auto', 'viewport'], defaultValue: 'auto', consumption: 'observed', lifecycle: 'dynamic' });
    expect((NodelPage as typeof NodelPage & { observedAttributes?: string[] }).observedAttributes ?? []).toEqual(['action', 'actions', 'arg', 'arg-type', 'min-height']);
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

  it('publishes fill only as a dynamic parent-consumed boolean on group and control grid', () => {
    const supported = componentContracts.filter((element) => element.attributes.some((attribute) => attribute.name === 'fill'));
    expect(supported.map((element) => element.name)).toEqual(['nodel-control-grid', 'nodel-group']);
    for (const name of ['nodel-page', 'nodel-row', 'nodel-column']) {
      expect(componentContracts.find((element) => element.name === name)?.attributes.some((attribute) => attribute.name === 'fill')).toBe(false);
    }
    for (const element of supported) {
      expect(element.attributes.find((attribute) => attribute.name === 'fill')).toMatchObject({
        valueType: 'boolean', defaultValue: 'false', consumption: 'parent', consumer: 'nodel-column,nodel-page', lifecycle: 'dynamic', completion: 'recommended'
      });
    }
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
    const first = required(document.elements[0], 'first element');
    const second = required(document.elements[1], 'second element');
    const firstAttribute = required(first.attributes[0], 'first attribute');
    first.name = 'bad name';
    second.name = 'bad name';
    firstAttribute.values = ['same', 'same'];
    firstAttribute.valueType = 'string';
    firstAttribute.numeric = { min: 2, max: 1 };
    firstAttribute.defaultValue = '0';
    firstAttribute.consumer = 'nodel-missing';
    first.registration = 'auto-host';
    first.audience = 'custom';
    first.completion = 'recommended';
    Reflect.defineProperty(firstAttribute, 'description', { value: undefined, enumerable: true, configurable: true, writable: true });
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
    const button = required(document.elements.find((element) => element.name === 'nodel-button'), 'button contract');
    const action = required(button.actionBindings[0], 'button action binding');
    button.actionBindings.push({ attribute: action.attribute, phases: [...action.phases], ...(action.defaultPhase === undefined ? {} : { defaultPhase: action.defaultPhase }) });
    action.phases = [];
    const signals = required(button.signalBindings.find((binding) => binding.attribute === 'signals'), 'signals binding');
    signals.defaultTarget = 'missing';
    required(signals.targets[0], 'active signal target').aggregations.push('any');
    button.events.push({ name: 'nodel-test', description: 'test', bubbles: true, composed: true, detailFields: ['value', 'value'] });
    const semanticStyle = required(document.styles.semanticClasses[0], 'semantic style');
    document.styles.stateClasses.push({ name: semanticStyle.name, description: semanticStyle.description });
    Object.setPrototypeOf(required(button.attributes[0], 'button attribute'), null);
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
    const button = required(document.elements.find((element) => element.name === 'nodel-button'), 'button contract');
    required(button.attributes.find((attribute) => attribute.name === 'disabled'), 'disabled attribute').defaultValue = 'maybe';
    required(button.attributes.find((attribute) => attribute.name === 'variant'), 'variant attribute').values = [];
    expect(validateComponentContract(document)).toEqual(expect.arrayContaining([
      'elements[10].attributes[0].values: must not be empty',
      'elements[10].attributes[11].defaultValue: boolean default must be true or false'
    ]));
  });

  it('removes phantom node-list attributes while preserving legacy projections', () => {
    const nodeList = required(findNodelElement('nodel-node-list'), 'node-list element');
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
    const button = required(after.elements.find((element) => element.name === 'nodel-button'), 'button contract');
    button.attributes = button.attributes.filter((attribute) => attribute.name !== 'active');
    required(required(button.attributes.find((attribute) => attribute.name === 'variant'), 'variant attribute').values, 'variant values').push('new-tone');
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
    const repeat = required(required(after.elements.find((element) => element.name === 'nodel-template'), 'template contract').attributes.find((attribute) => attribute.name === 'repeat'), 'repeat attribute');
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
    delete required(required(widened.elements.find((element) => element.name === 'nodel-template'), 'template contract').attributes.find((attribute) => attribute.name === 'repeat'), 'repeat attribute').numeric;
    expect(diffComponentContracts(before, widened).breaking).not.toContain('elements.nodel-template.attributes.repeat.numeric: narrowed');
  });

  it('classifies catalogue, derived default, composition, event, and style-category changes', () => {
    const before = componentContractDocument('1.2.3');
    const after = structuredClone(before);
    const button = required(after.elements.find((element) => element.name === 'nodel-button'), 'button contract');
    button.catalogue = false;
    required(button.attributes.find((attribute) => attribute.name === 'variant'), 'variant attribute').defaultDescription = 'Different derived behavior.';
    const space = required(after.elements.find((element) => element.name === 'nodel-control-space'), 'control-space contract');
    required(space.composition, 'control-space composition').requiredParent = 'nodel-row';
    const appEvent = required(required(after.elements.find((element) => element.name === 'nodel-app'), 'app contract').events[0], 'app event');
    appEvent.description = 'Updated prose.';
    const style = required(after.styles.semanticClasses.shift(), 'semantic style');
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

  it('classifies enum-to-string icon widening without weakening aliases or toggle contracts', () => {
    const after = componentContractDocument('1.2.3');
    const before = structuredClone(after);
    const icon = required(before.elements.find((element) => element.name === 'nodel-icon'), 'icon contract');
    const toggle = required(before.elements.find((element) => element.name === 'nodel-toggle'), 'toggle contract');
    required(icon.attributes.find((attribute) => attribute.name === 'name'), 'icon name').valueType = 'enum';
    icon.attributes = icon.attributes.filter((attribute) => attribute.name !== 'family' && attribute.name !== 'style');
    const signals = required(icon.signalBindings.find((binding) => binding.attribute === 'signals'), 'icon signals');
    signals.targets = signals.targets.filter((target) => target.name !== 'family' && target.name !== 'style');
    const diff = diffComponentContracts(before, after);
    expect(diff.breaking).toEqual([]);
    expect(diff.informational).toContain('elements.nodel-icon.attributes.name.valueType: widened');
    expect(new Set(toggle.attributes.find((attribute) => attribute.name === 'on-icon')?.values)).toEqual(new Set(icon.attributes.find((attribute) => attribute.name === 'name')?.values));
    expect(diffComponentContracts(after, before).breaking).toContain('elements.nodel-icon.attributes.name.valueType: changed');
    const aliasesRemoved = structuredClone(after);
    const aliases = required(required(aliasesRemoved.elements.find((element) => element.name === 'nodel-icon'), 'icon contract').attributes.find((attribute) => attribute.name === 'name'), 'icon name');
    aliases.values = required(aliases.values, 'icon aliases').slice(1);
    expect(diffComponentContracts(after, aliasesRemoved).breaking).toContain('elements.nodel-icon.attributes.name.values: removed image');
  });

  it('keeps icon signal shorthand narrow while exposing family and style through signals', () => {
    const icon = required(componentContracts.find((element) => element.name === 'nodel-icon'), 'icon contract');
    expect(icon.signalBindings.find((binding) => binding.attribute === 'signal')).toEqual({
      attribute: 'signal', defaultTarget: 'name', targets: [{ name: 'name', aggregations: [] }]
    });
    expect(icon.signalBindings.find((binding) => binding.attribute === 'signals')?.targets.map((target) => target.name)).toEqual(['name', 'family', 'style', 'alt', 'label', 'tone', 'visibility']);
  });
});
