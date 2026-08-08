import type { ComponentAttributeContract, ComponentContract, ComponentContractDocument, ComponentStyleDefinition } from './types';

const tagName = /^nodel-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const attributeName = /^(?:[a-z0-9][a-z0-9-]*|data-\*)$/;
const eventName = /^[a-z][a-z0-9]+(?:-[a-z0-9]+)+$/;
const packageVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const completions = new Set(['recommended', 'advanced', 'hidden']);
const consumptions = new Set(['observed', 'initialization', 'parent', 'contextual-child', 'wildcard']);
const lifecycles = new Set(['dynamic', 'initialization']);
const audiences = new Set(['custom', 'core', 'internal']);
const registrations = new Set(['eager', 'lazy', 'auto-host']);
const aggregations = new Set(['any', 'all']);
const valueTypes = new Set(['boolean', 'presence-or-text', 'string', 'binding', 'enum', 'enum-or-string', 'number', 'integer', 'template-data']);

function isJsonPlain(value: unknown, stack = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || stack.has(value) || Object.getOwnPropertySymbols(value).length) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
  stack.add(value);
  const valid = Object.values(value).every((item) => isJsonPlain(item, stack));
  stack.delete(value);
  return valid;
}

function duplicates(values: string[]): string[] { return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))]; }
function validateKeys(value: object, allowed: string[], path: string, errors: string[]) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) errors.push(`${path}: unexpected keys ${unexpected.sort().join(', ')}`);
}

function validateAttribute(attribute: ComponentAttributeContract, path: string, errors: string[]) {
  validateKeys(attribute, ['name', 'description', 'values', 'valueType', 'syntax', 'numeric', 'defaultValue', 'defaultDescription', 'common', 'legacy', 'completion', 'consumption', 'lifecycle', 'consumer'], path, errors);
  if (!attributeName.test(attribute.name)) errors.push(`${path}.name: invalid attribute name`);
  if (typeof attribute.description !== 'string' || !attribute.description.trim()) errors.push(`${path}.description: required`);
  if (!valueTypes.has(attribute.valueType ?? '')) errors.push(`${path}.valueType: invalid value type`);
  if (!completions.has(attribute.completion)) errors.push(`${path}.completion: invalid completion`);
  if (!consumptions.has(attribute.consumption)) errors.push(`${path}.consumption: invalid consumption`);
  if (!lifecycles.has(attribute.lifecycle)) errors.push(`${path}.lifecycle: invalid lifecycle`);
  if (attribute.name === 'data-*' && attribute.consumption !== 'wildcard') errors.push(`${path}.consumption: data-* must be wildcard`);
  if (attribute.consumption === 'wildcard' && attribute.name !== 'data-*') errors.push(`${path}.consumption: wildcard is only valid for data-*`);
  if (['parent', 'contextual-child'].includes(attribute.consumption) && !attribute.consumer) errors.push(`${path}.consumer: required for ${attribute.consumption}`);
  if (attribute.consumer !== undefined && !attribute.consumer.trim()) errors.push(`${path}.consumer: must not be empty`);
  if (attribute.values !== undefined) {
    if (attribute.values.length === 0) errors.push(`${path}.values: must not be empty`);
    if (!['enum', 'enum-or-string'].includes(attribute.valueType ?? '')) errors.push(`${path}.valueType: values require enum or enum-or-string`);
    if (duplicates(attribute.values).length) errors.push(`${path}.values: duplicate enum value`);
    if (attribute.defaultValue !== undefined && !attribute.values.includes(attribute.defaultValue)) errors.push(`${path}.defaultValue: enum default is not accepted`);
  }
  if (attribute.defaultValue !== undefined && attribute.valueType === 'boolean' && !['true', 'false'].includes(attribute.defaultValue)) errors.push(`${path}.defaultValue: boolean default must be true or false`);
  if (attribute.defaultValue !== undefined && attribute.valueType === 'number' && !Number.isFinite(Number(attribute.defaultValue))) errors.push(`${path}.defaultValue: must be a finite number`);
  if (attribute.defaultValue !== undefined && attribute.valueType === 'integer' && !Number.isInteger(Number(attribute.defaultValue))) errors.push(`${path}.defaultValue: must be an integer`);
  if (attribute.values?.length && attribute.numeric) errors.push(`${path}: enum and numeric constraints are ambiguous`);
  if (attribute.numeric) {
    if (!['number', 'integer'].includes(attribute.valueType ?? '')) errors.push(`${path}.valueType: numeric constraints require a numeric type`);
    validateKeys(attribute.numeric, ['integer', 'normalizesToInteger', 'min', 'exclusiveMin', 'max', 'unit', 'clamp'], `${path}.numeric`, errors);
    const { min, max, exclusiveMin } = attribute.numeric;
    if (min !== undefined && !Number.isFinite(min)) errors.push(`${path}.numeric.min: must be finite`);
    if (max !== undefined && !Number.isFinite(max)) errors.push(`${path}.numeric.max: must be finite`);
    if (min !== undefined && max !== undefined && (min > max || (min === max && exclusiveMin))) errors.push(`${path}.numeric: invalid range`);
    if (attribute.defaultValue !== undefined && (attribute.valueType === 'number' || attribute.valueType === 'integer')) {
      const value = Number(attribute.defaultValue);
      if (!Number.isFinite(value) || (min !== undefined && (exclusiveMin ? value <= min : value < min)) || (max !== undefined && value > max)) errors.push(`${path}.defaultValue: outside numeric range`);
    }
  }
  if (!isJsonPlain(attribute)) errors.push(`${path}: contains non-JSON plain data`);
}

function validateStructuredElement(element: ComponentContract, path: string, names: Set<string>, errors: string[]) {
  validateKeys(element, ['name', 'description', 'snippet', 'catalogue', 'audience', 'registration', 'completion', 'attributes', 'actionBindings', 'signalBindings', 'events', 'composition'], path, errors);
  if (!audiences.has(element.audience)) errors.push(`${path}.audience: invalid audience`);
  if (!registrations.has(element.registration)) errors.push(`${path}.registration: invalid registration`);
  if (!completions.has(element.completion)) errors.push(`${path}.completion: invalid completion`);
  if (element.registration === 'auto-host' && (element.audience !== 'internal' || element.completion !== 'hidden' || element.catalogue)) errors.push(`${path}: auto-host elements must be internal, hidden, and not catalogue-visible`);
  const actionAttributes = element.actionBindings.map((binding) => binding.attribute);
  if (duplicates(actionAttributes).length) errors.push(`${path}.actionBindings: duplicate action attribute`);
  for (const binding of element.actionBindings) {
    const bindingPath = `${path}.actionBindings.${binding.attribute}`;
    validateKeys(binding, ['attribute', 'phases', 'defaultPhase'], bindingPath, errors);
    if (!element.attributes.some((attribute) => attribute.name === binding.attribute)) errors.push(`${bindingPath}: invalid attribute reference`);
    if (binding.phases.length === 0) errors.push(`${bindingPath}.phases: must not be empty`);
    if (duplicates(binding.phases).length) errors.push(`${bindingPath}.phases: duplicate phase`);
    if (binding.phases.some((phase) => typeof phase !== 'string' || !phase.trim())) errors.push(`${bindingPath}.phases: invalid phase`);
    if (binding.defaultPhase !== undefined && !binding.phases.includes(binding.defaultPhase)) errors.push(`${bindingPath}.defaultPhase: absent phase`);
  }
  const signalAttributes = element.signalBindings.map((binding) => binding.attribute);
  if (duplicates(signalAttributes).length) errors.push(`${path}.signalBindings: duplicate signal attribute`);
  for (const binding of element.signalBindings) {
    const bindingPath = `${path}.signalBindings.${binding.attribute}`;
    validateKeys(binding, ['attribute', 'defaultTarget', 'targets'], bindingPath, errors);
    if (!element.attributes.some((attribute) => attribute.name === binding.attribute)) errors.push(`${bindingPath}: invalid attribute reference`);
    const targets = binding.targets.map((target) => target.name);
    if (targets.length === 0) errors.push(`${bindingPath}.targets: must not be empty`);
    if (duplicates(targets).length) errors.push(`${bindingPath}.targets: duplicate target`);
    if (binding.defaultTarget && !targets.includes(binding.defaultTarget)) errors.push(`${bindingPath}.defaultTarget: absent target`);
    for (const target of binding.targets) {
      validateKeys(target, ['name', 'aggregations'], `${bindingPath}.targets.${target.name}`, errors);
      if (!target.name.trim()) errors.push(`${bindingPath}.targets: invalid target`);
      if (duplicates(target.aggregations).length) errors.push(`${bindingPath}.targets.${target.name}.aggregations: duplicate aggregation`);
      if (target.aggregations.some((aggregation) => !aggregations.has(aggregation))) errors.push(`${bindingPath}.targets.${target.name}.aggregations: invalid aggregation`);
    }
  }
  const eventNames = element.events.map((event) => event.name);
  if (duplicates(eventNames).length) errors.push(`${path}.events: duplicate event`);
  for (const event of element.events) {
    validateKeys(event, ['name', 'description', 'bubbles', 'composed', 'detailFields'], `${path}.events.${event.name}`, errors);
    if (!eventName.test(event.name)) errors.push(`${path}.events.${event.name}.name: invalid event name`);
    if (typeof event.bubbles !== 'boolean' || typeof event.composed !== 'boolean') errors.push(`${path}.events.${event.name}: propagation flags are required`);
    if (duplicates(event.detailFields).length) errors.push(`${path}.events.${event.name}.detailFields: duplicate detail field`);
  }
  for (const reference of [element.composition?.requiredParent, ...(element.composition?.requiredDirectChildren ?? []), ...(element.composition?.advisoryDirectChildren ?? [])]) {
    if (reference && reference !== 'template' && !names.has(reference)) errors.push(`${path}.composition: invalid reference ${reference}`);
  }
  if (element.composition) validateKeys(element.composition, ['requiredParent', 'requiredDirectChildren', 'advisoryDirectChildren'], `${path}.composition`, errors);
  for (const attribute of element.attributes) for (const reference of attribute.consumer?.split(',') ?? []) if (reference.startsWith('nodel-') && !names.has(reference)) errors.push(`${path}.attributes.${attribute.name}.consumer: invalid reference ${reference}`);
  if (!isJsonPlain(element)) errors.push(`${path}: contains non-JSON plain data`);
}

export function validateComponentContract(document: ComponentContractDocument): string[] {
  const errors: string[] = [];
  validateKeys(document, ['schemaVersion', 'packageVersion', 'commonAttributes', 'elements', 'styles'], 'document', errors);
  if (document.schemaVersion !== 1) errors.push('schemaVersion: must be 1');
  if (typeof document.packageVersion !== 'string' || !packageVersion.test(document.packageVersion)) errors.push('packageVersion: must be a semantic version');
  if (document.elements.length === 0) errors.push('elements: must not be empty');
  if (document.commonAttributes.length === 0) errors.push('commonAttributes: must not be empty');
  const names = new Set<string>();
  document.elements.forEach((element, index) => { const path = `elements[${index}]`; if (!tagName.test(element.name)) errors.push(`${path}.name: invalid element name`); if (names.has(element.name)) errors.push(`${path}.name: duplicate element ${element.name}`); names.add(element.name); });
  document.elements.forEach((element, index) => {
    const path = `elements[${index}]`; const attributes = element.attributes.map((attribute) => attribute.name);
    for (const name of duplicates(attributes)) errors.push(`${path}.attributes: duplicate attribute ${name}`);
    element.attributes.forEach((attribute, attributeIndex) => validateAttribute(attribute, `${path}.attributes[${attributeIndex}]`, errors));
    validateStructuredElement(element, path, names, errors);
  });
  for (const name of duplicates(document.commonAttributes.map((attribute) => attribute.name))) errors.push(`commonAttributes: duplicate attribute ${name}`);
  document.commonAttributes.forEach((attribute, index) => validateAttribute(attribute, `commonAttributes[${index}]`, errors));
  validateKeys(document.styles, ['semanticClasses', 'stateClasses', 'tailwindUtilities'], 'styles', errors);
  const styleGroups: ComponentStyleDefinition[][] = [document.styles.semanticClasses, document.styles.stateClasses, document.styles.tailwindUtilities];
  const styleNames = styleGroups.flat().map((style) => style.name);
  for (const name of duplicates(styleNames)) errors.push(`styles: duplicate style name ${name}`);
  for (const [category, styles] of Object.entries(document.styles) as [string, ComponentStyleDefinition[]][] ) {
    if (!Array.isArray(styles) || styles.length === 0) errors.push(`styles.${category}: must not be empty`);
    else styles.forEach((style, index) => {
      validateKeys(style, ['name', 'description'], `styles.${category}[${index}]`, errors);
      if (typeof style.name !== 'string' || !style.name || typeof style.description !== 'string' || !style.description) errors.push(`styles.${category}[${index}]: invalid style`);
    });
  }
  if (!isJsonPlain(document)) errors.push('document: contains non-JSON plain data');
  return errors.sort((a, b) => a.localeCompare(b));
}

export function assertValidComponentContract(document: ComponentContractDocument): void { const errors = validateComponentContract(document); if (errors.length) throw new Error(errors.join('\n')); }
