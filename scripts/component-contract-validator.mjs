const tagName = /^nodel-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const attributeName = /^(?:[a-z0-9][a-z0-9-]*|data-\*)$/;
const eventName = /^[a-z][a-z0-9]+(?:-[a-z0-9]+)+$/;
const semanticVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const audiences = new Set(['custom', 'core', 'internal']);
const registrations = new Set(['eager', 'lazy', 'auto-host']);
const completions = new Set(['recommended', 'advanced', 'hidden']);
const consumptions = new Set(['observed', 'initialization', 'parent', 'contextual-child', 'wildcard']);
const lifecycles = new Set(['dynamic', 'initialization']);
const valueTypes = new Set(['boolean', 'presence-or-text', 'string', 'binding', 'enum', 'enum-or-string', 'number', 'integer', 'template-data']);
const aggregations = new Set(['any', 'all']);

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, required, optional = []) {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key));
}
function unique(values) { return new Set(values).size === values.length; }
function fail(path, message) { throw new Error(`Component contract ${path}: ${message}`); }
function requireCondition(condition, path, message) { if (!condition) fail(path, message); }
function stringArray(value, path) {
  requireCondition(Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.length > 0) && unique(value), path, 'must be a unique non-empty string array');
}

function validateNumeric(value, path) {
  requireCondition(exactKeys(value, [], ['integer', 'normalizesToInteger', 'min', 'exclusiveMin', 'max', 'unit', 'clamp']), path, 'has invalid numeric keys');
  for (const key of ['integer', 'normalizesToInteger', 'exclusiveMin', 'clamp']) if (value[key] !== undefined) requireCondition(typeof value[key] === 'boolean', `${path}.${key}`, 'must be boolean');
  for (const key of ['min', 'max']) if (value[key] !== undefined) requireCondition(typeof value[key] === 'number' && Number.isFinite(value[key]), `${path}.${key}`, 'must be finite');
  if (value.unit !== undefined) requireCondition(typeof value.unit === 'string' && value.unit.length > 0, `${path}.unit`, 'must be non-empty');
  if (value.min !== undefined && value.max !== undefined) requireCondition(value.min < value.max || (value.min === value.max && !value.exclusiveMin), path, 'has an invalid range');
}

function validateAttribute(attribute, path) {
  const optional = ['values', 'syntax', 'numeric', 'defaultValue', 'defaultDescription', 'common', 'legacy', 'consumer'];
  requireCondition(exactKeys(attribute, ['name', 'description', 'valueType', 'completion', 'consumption', 'lifecycle'], optional), path, 'has invalid keys');
  requireCondition(attributeName.test(attribute.name), `${path}.name`, 'is invalid');
  requireCondition(typeof attribute.description === 'string' && attribute.description.length > 0, `${path}.description`, 'is required');
  requireCondition(valueTypes.has(attribute.valueType), `${path}.valueType`, 'is invalid');
  requireCondition(completions.has(attribute.completion), `${path}.completion`, 'is invalid');
  requireCondition(consumptions.has(attribute.consumption), `${path}.consumption`, 'is invalid');
  requireCondition(lifecycles.has(attribute.lifecycle), `${path}.lifecycle`, 'is invalid');
  if (attribute.consumer !== undefined) requireCondition(typeof attribute.consumer === 'string' && attribute.consumer.length > 0, `${path}.consumer`, 'is invalid');
  if (attribute.consumption === 'parent' || attribute.consumption === 'contextual-child') requireCondition(Boolean(attribute.consumer), `${path}.consumer`, 'is required');
  requireCondition((attribute.name === 'data-*') === (attribute.consumption === 'wildcard'), `${path}.consumption`, 'wildcard must be bounded to data-*');
  if (attribute.values !== undefined) {
    stringArray(attribute.values, `${path}.values`);
    requireCondition(attribute.valueType === 'enum' || attribute.valueType === 'enum-or-string', `${path}.valueType`, 'values require an enum type');
    if (attribute.defaultValue !== undefined) requireCondition(attribute.values.includes(attribute.defaultValue), `${path}.defaultValue`, 'is not accepted');
  }
  if (attribute.defaultValue !== undefined && attribute.valueType === 'boolean') requireCondition(attribute.defaultValue === 'true' || attribute.defaultValue === 'false', `${path}.defaultValue`, 'must be true or false');
  if (attribute.defaultValue !== undefined && attribute.valueType === 'number') requireCondition(Number.isFinite(Number(attribute.defaultValue)), `${path}.defaultValue`, 'must be a finite number');
  if (attribute.defaultValue !== undefined && attribute.valueType === 'integer') requireCondition(Number.isInteger(Number(attribute.defaultValue)), `${path}.defaultValue`, 'must be an integer');
  if (attribute.numeric !== undefined) {
    requireCondition(attribute.values === undefined, path, 'cannot combine enum values and numeric constraints');
    requireCondition(attribute.valueType === 'number' || attribute.valueType === 'integer', `${path}.valueType`, 'numeric constraints require a numeric type');
    validateNumeric(attribute.numeric, `${path}.numeric`);
    if (attribute.defaultValue !== undefined) {
      const number = Number(attribute.defaultValue);
      requireCondition(Number.isFinite(number), `${path}.defaultValue`, 'must be numeric');
      if (attribute.numeric.min !== undefined) requireCondition(attribute.numeric.exclusiveMin ? number > attribute.numeric.min : number >= attribute.numeric.min, `${path}.defaultValue`, 'is below the minimum');
      if (attribute.numeric.max !== undefined) requireCondition(number <= attribute.numeric.max, `${path}.defaultValue`, 'is above the maximum');
    }
  }
  for (const key of ['syntax', 'defaultValue', 'defaultDescription', 'legacy']) if (attribute[key] !== undefined) requireCondition(typeof attribute[key] === 'string', `${path}.${key}`, 'must be a string');
  if (attribute.common !== undefined) requireCondition(attribute.common === true, `${path}.common`, 'must be true when present');
}

function validateElement(element, index, names) {
  const path = `elements[${index}]`;
  requireCondition(exactKeys(element, ['name', 'description', 'audience', 'registration', 'completion', 'attributes', 'actionBindings', 'signalBindings', 'events'], ['snippet', 'catalogue', 'composition']), path, 'has invalid keys');
  requireCondition(tagName.test(element.name), `${path}.name`, 'is invalid');
  requireCondition(typeof element.description === 'string' && element.description.length > 0, `${path}.description`, 'is required');
  requireCondition(audiences.has(element.audience), `${path}.audience`, 'is invalid');
  requireCondition(registrations.has(element.registration), `${path}.registration`, 'is invalid');
  requireCondition(completions.has(element.completion), `${path}.completion`, 'is invalid');
  if (element.snippet !== undefined) requireCondition(typeof element.snippet === 'string', `${path}.snippet`, 'must be a string');
  if (element.catalogue !== undefined) requireCondition(typeof element.catalogue === 'boolean', `${path}.catalogue`, 'must be boolean');
  if (element.registration === 'auto-host') requireCondition(element.audience === 'internal' && element.completion === 'hidden' && element.catalogue !== true, path, 'auto-host must be internal, hidden, and outside the catalogue');
  requireCondition(Array.isArray(element.attributes), `${path}.attributes`, 'must be an array');
  requireCondition(unique(element.attributes.map((attribute) => attribute.name)), `${path}.attributes`, 'contains duplicate names');
  element.attributes.forEach((attribute, attributeIndex) => validateAttribute(attribute, `${path}.attributes[${attributeIndex}]`));

  requireCondition(Array.isArray(element.actionBindings), `${path}.actionBindings`, 'must be an array');
  requireCondition(unique(element.actionBindings.map((binding) => binding.attribute)), `${path}.actionBindings`, 'contains duplicate attributes');
  element.actionBindings.forEach((binding, bindingIndex) => {
    const bindingPath = `${path}.actionBindings[${bindingIndex}]`;
    requireCondition(exactKeys(binding, ['attribute', 'phases'], ['defaultPhase']), bindingPath, 'has invalid keys');
    requireCondition(element.attributes.some((attribute) => attribute.name === binding.attribute), `${bindingPath}.attribute`, 'does not reference an attribute');
    stringArray(binding.phases, `${bindingPath}.phases`);
    if (binding.defaultPhase !== undefined) requireCondition(binding.phases.includes(binding.defaultPhase), `${bindingPath}.defaultPhase`, 'is absent from phases');
  });

  requireCondition(Array.isArray(element.signalBindings), `${path}.signalBindings`, 'must be an array');
  requireCondition(unique(element.signalBindings.map((binding) => binding.attribute)), `${path}.signalBindings`, 'contains duplicate attributes');
  element.signalBindings.forEach((binding, bindingIndex) => {
    const bindingPath = `${path}.signalBindings[${bindingIndex}]`;
    requireCondition(exactKeys(binding, ['attribute', 'targets'], ['defaultTarget']), bindingPath, 'has invalid keys');
    requireCondition(element.attributes.some((attribute) => attribute.name === binding.attribute), `${bindingPath}.attribute`, 'does not reference an attribute');
    requireCondition(Array.isArray(binding.targets) && binding.targets.length > 0, `${bindingPath}.targets`, 'must not be empty');
    requireCondition(unique(binding.targets.map((target) => target.name)), `${bindingPath}.targets`, 'contains duplicate names');
    binding.targets.forEach((target, targetIndex) => {
      const targetPath = `${bindingPath}.targets[${targetIndex}]`;
      requireCondition(exactKeys(target, ['name', 'aggregations']), targetPath, 'has invalid keys');
      requireCondition(typeof target.name === 'string' && target.name.length > 0, `${targetPath}.name`, 'is required');
      requireCondition(Array.isArray(target.aggregations) && target.aggregations.every((aggregation) => aggregations.has(aggregation)) && unique(target.aggregations), `${targetPath}.aggregations`, 'is invalid');
    });
    if (binding.defaultTarget !== undefined) requireCondition(binding.targets.some((target) => target.name === binding.defaultTarget), `${bindingPath}.defaultTarget`, 'is absent from targets');
  });

  requireCondition(Array.isArray(element.events), `${path}.events`, 'must be an array');
  requireCondition(unique(element.events.map((event) => event.name)), `${path}.events`, 'contains duplicate names');
  element.events.forEach((componentEvent, eventIndex) => {
    const eventPath = `${path}.events[${eventIndex}]`;
    requireCondition(exactKeys(componentEvent, ['name', 'description', 'bubbles', 'composed', 'detailFields']), eventPath, 'has invalid keys');
    requireCondition(eventName.test(componentEvent.name), `${eventPath}.name`, 'is invalid');
    requireCondition(typeof componentEvent.description === 'string' && componentEvent.description.length > 0, `${eventPath}.description`, 'is required');
    requireCondition(typeof componentEvent.bubbles === 'boolean' && typeof componentEvent.composed === 'boolean', eventPath, 'has invalid propagation flags');
    stringArray(componentEvent.detailFields, `${eventPath}.detailFields`);
  });

  if (element.composition !== undefined) {
    requireCondition(exactKeys(element.composition, [], ['requiredParent', 'requiredDirectChildren', 'advisoryDirectChildren']), `${path}.composition`, 'has invalid keys');
    if (element.composition.requiredParent !== undefined) requireCondition(names.has(element.composition.requiredParent), `${path}.composition.requiredParent`, 'is unknown');
    for (const key of ['requiredDirectChildren', 'advisoryDirectChildren']) if (element.composition[key] !== undefined) {
      stringArray(element.composition[key], `${path}.composition.${key}`);
      requireCondition(element.composition[key].every((name) => name === 'template' || names.has(name)), `${path}.composition.${key}`, 'contains an unknown element');
    }
  }
  for (const attribute of element.attributes) for (const consumer of (attribute.consumer ?? '').split(',')) {
    if (consumer.startsWith('nodel-')) requireCondition(names.has(consumer), `${path}.attributes.${attribute.name}.consumer`, 'references an unknown element');
  }
}

export function validateComponentContractArtifact(content, packageVersion) {
  requireCondition(typeof packageVersion === 'string' && semanticVersion.test(packageVersion), 'packageVersion', 'expected version is invalid');
  let document;
  try { document = JSON.parse(Buffer.isBuffer(content) ? content.toString('utf8') : content); }
  catch { throw new Error('Component contract is not valid JSON'); }
  requireCondition(exactKeys(document, ['schemaVersion', 'packageVersion', 'commonAttributes', 'elements', 'styles']), 'document', 'has invalid keys');
  requireCondition(document.schemaVersion === 1, 'schemaVersion', 'must be 1');
  requireCondition(document.packageVersion === packageVersion, 'packageVersion', `must be ${packageVersion}`);
  requireCondition(Array.isArray(document.commonAttributes) && document.commonAttributes.length > 0, 'commonAttributes', 'must not be empty');
  requireCondition(unique(document.commonAttributes.map((attribute) => attribute.name)), 'commonAttributes', 'contains duplicate names');
  document.commonAttributes.forEach((attribute, index) => validateAttribute(attribute, `commonAttributes[${index}]`));
  requireCondition(Array.isArray(document.elements) && document.elements.length > 0, 'elements', 'must not be empty');
  const names = new Set(document.elements.map((element) => element.name));
  requireCondition(names.size === document.elements.length, 'elements', 'contains duplicate names');
  document.elements.forEach((element, index) => validateElement(element, index, names));
  requireCondition(exactKeys(document.styles, ['semanticClasses', 'stateClasses', 'tailwindUtilities']), 'styles', 'has invalid keys');
  const styleNames = [];
  for (const category of ['semanticClasses', 'stateClasses', 'tailwindUtilities']) {
    requireCondition(Array.isArray(document.styles[category]) && document.styles[category].length > 0, `styles.${category}`, 'must not be empty');
    document.styles[category].forEach((style, index) => {
      requireCondition(exactKeys(style, ['name', 'description']), `styles.${category}[${index}]`, 'has invalid keys');
      requireCondition(typeof style.name === 'string' && style.name.length > 0 && typeof style.description === 'string' && style.description.length > 0, `styles.${category}[${index}]`, 'is invalid');
      styleNames.push(style.name);
    });
  }
  requireCondition(unique(styleNames), 'styles', 'contains duplicate names');
  return document;
}
