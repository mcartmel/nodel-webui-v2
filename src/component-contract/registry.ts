import { attributeDefaultMetadata } from './defaults';
import { booleanAttributeNames } from './values';
import { commonComponentAttributes } from './shared';
import { customControlElements } from './custom-controls';
import { customContentElements } from './custom-content';
import { customLayoutElements } from './custom-layout';
import { coreElements } from './core-elements';
import { internalHostElements } from './internal-hosts';
import { componentEventMap } from './events';
import type {
  AttributeConsumption,
  ComponentActionBindingContract,
  ComponentAttributeContract,
  ComponentAudience,
  ComponentCompletion,
  ComponentContract,
  ComponentRegistration,
  ComponentSignalBindingContract,
  NodelAttributeDefinition,
  NodelElementDefinition,
  NodelNumericConstraint
} from './types';

const coreNames = new Set(['nodel-description', 'nodel-node-list', 'nodel-add-node', 'nodel-node-menu', 'nodel-diagnostics', 'nodel-host-log', 'nodel-diagnostic-charts', 'nodel-toolkit', 'nodel-console', 'nodel-log', 'nodel-actsig', 'nodel-params', 'nodel-bindings', 'nodel-editor', 'nodel-link']);
const internalHosts = new Set(['nodel-toast-host', 'nodel-confirm-host', 'nodel-connectivity-host']);

const binding = (phases: string[], defaultPhase?: string): Omit<ComponentActionBindingContract, 'attribute'> => ({ phases, ...(defaultPhase ? { defaultPhase } : {}) });
const actionBindingMap: Record<string, Record<string, Omit<ComponentActionBindingContract, 'attribute'>>> = {
  'nodel-page': { action: binding(['activate'], 'activate'), actions: binding(['activate'], 'activate') },
  'nodel-button': { action: binding(['click', 'press', 'release'], 'click'), actions: binding(['click', 'press', 'release'], 'click'), join: binding(['click'], 'click'), 'action-on': binding(['press'], 'press'), 'action-off': binding(['release'], 'release') },
  'nodel-toggle': { action: binding(['toggle', 'on', 'off'], 'toggle'), actions: binding(['toggle', 'on', 'off'], 'toggle'), join: binding(['toggle'], 'toggle') },
  'nodel-segmented': { action: binding(['select'], 'select'), actions: binding(['select'], 'select'), join: binding(['select'], 'select') },
  'nodel-select': { action: binding(['select'], 'select'), actions: binding(['select'], 'select'), join: binding(['select'], 'select') },
  'nodel-fader': { action: binding(['live', 'commit'], 'commit'), actions: binding(['live', 'commit'], 'commit'), join: binding(['commit'], 'commit') },
  'nodel-stepper': { action: binding(['live', 'commit', 'increase', 'decrease'], 'commit'), actions: binding(['live', 'commit', 'increase', 'decrease'], 'commit'), join: binding(['commit'], 'commit') },
  'nodel-pad': Object.fromEntries(['action', 'actions', ...['up', 'down', 'left', 'right', 'center'].flatMap((direction) => [`${direction}-action`, `${direction}-actions`])].map((attribute) => [attribute, binding(['click', 'press', 'release'])])),
  'nodel-palette': { action: binding(['select', 'live', 'commit']), actions: binding(['select', 'live', 'commit']), join: binding(['select', 'commit']) }
};

const compositionMap: Record<string, ComponentContract['composition']> = {
  'nodel-control-space': { requiredParent: 'nodel-control-grid' },
  'nodel-template': { advisoryDirectChildren: ['template'] },
  'nodel-segmented': { advisoryDirectChildren: ['nodel-button'] },
  'nodel-select': { advisoryDirectChildren: ['nodel-button'] },
  'nodel-palette': { advisoryDirectChildren: ['nodel-button'] }
};

const signalTargetMap: Record<string, string[]> = {
  'nodel-app': ['title'], 'nodel-button': ['active', 'label', 'disabled'], 'nodel-toggle': ['state', 'label', 'disabled'], 'nodel-segmented': ['value', 'label', 'disabled', 'options'],
  'nodel-select': ['value', 'label', 'disabled', 'options'], 'nodel-fader': ['value', 'label', 'disabled'], 'nodel-stepper': ['value', 'label', 'disabled'],
  'nodel-pad': ['disabled', 'label', 'center-disabled'], 'nodel-readout': ['value', 'label', 'variant', 'suffix', 'prefix'], 'nodel-palette': ['value', 'label', 'disabled', 'custom-color'],
  'nodel-meter': ['value', 'peak', 'label'], 'nodel-image': ['src', 'alt', 'label'], 'nodel-icon': ['name', 'family', 'style', 'alt', 'label', 'tone'], 'nodel-qrcode': ['value', 'help', 'label'],
  'nodel-status-indicator': ['value', 'label'], 'nodel-status': ['value', 'state', 'level', 'message', 'label'], 'nodel-text': ['value'], 'nodel-title': ['value'],
  'nodel-markdown': ['value'], 'nodel-clock': ['value'], 'nodel-host-icon': ['host', 'icon-host', 'href', 'title', 'alt']
};

const moduleElements: Array<{ readonly owner: string; readonly elements: readonly NodelElementDefinition[] }> = [
  { owner: 'custom-layout', elements: customLayoutElements },
  { owner: 'custom-controls', elements: customControlElements },
  { owner: 'custom-content', elements: customContentElements },
  { owner: 'core-elements', elements: coreElements },
  { owner: 'internal-hosts', elements: internalHostElements }
];

const moduleOwnership = new Map<string, string[]>();
const elementRegistryMap = new Map<string, NodelElementDefinition>();

for (const { owner, elements } of moduleElements) {
  for (const element of elements) {
    const owners = moduleOwnership.get(element.name) ?? [];
    owners.push(owner);
    moduleOwnership.set(element.name, owners);

    if (!elementRegistryMap.has(element.name)) {
      elementRegistryMap.set(element.name, element);
    }
  }
}

const duplicateOwnership = [...moduleOwnership.entries()]
  .filter(([, owners]) => owners.length > 1)
  .map(([name, owners]) => `${name} (${owners.join(', ')})`);

const historicalContractOrder: string[] = [
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
  'nodel-button',
  'nodel-toggle',
  'nodel-segmented',
  'nodel-select',
  'nodel-fader',
  'nodel-stepper',
  'nodel-pad',
  'nodel-readout',
  'nodel-palette',
  'nodel-meter',
  'nodel-image',
  'nodel-icon',
  'nodel-link',
  'nodel-qrcode',
  'nodel-status-indicator',
  'nodel-status',
  'nodel-collapse',
  'nodel-description',
  'nodel-text',
  'nodel-title',
  'nodel-markdown',
  'nodel-clock',
  'nodel-theme-toggle',
  'nodel-host-icon',
  'nodel-node-list',
  'nodel-add-node',
  'nodel-node-menu',
  'nodel-diagnostics',
  'nodel-host-log',
  'nodel-diagnostic-charts',
  'nodel-toolkit',
  'nodel-console',
  'nodel-log',
  'nodel-actsig',
  'nodel-params',
  'nodel-bindings',
  'nodel-editor',
  'nodel-toast-host',
  'nodel-confirm-host',
  'nodel-connectivity-host'
];

const historicalContractNameSet = new Set(historicalContractOrder);
const missingFromModules = historicalContractOrder.filter((name) => !elementRegistryMap.has(name));
const extraFromModules = [...elementRegistryMap.keys()].filter((name) => !historicalContractNameSet.has(name));

if (duplicateOwnership.length > 0) {
  throw new Error(`Duplicate element ownership detected in split modules: ${duplicateOwnership.join('; ')}`);
}

if (missingFromModules.length > 0) {
  throw new Error(`Missing contract definitions for: ${missingFromModules.join(', ')}`);
}

if (extraFromModules.length > 0) {
  throw new Error(`Unexpected split contract definitions not in historical order: ${extraFromModules.join(', ')}`);
}

export const historicalElementOrder = Object.freeze([...historicalContractOrder]);

export const historicalElementIndex = Object.freeze(
  historicalContractOrder.reduce<Record<string, NodelElementDefinition>>((acc, name) => {
    const definition = elementRegistryMap.get(name);
    if (!definition) {
      throw new Error(`Missing contract definition while building map for ${name}`);
    }
    acc[name] = definition;
    return acc;
  }, {})
);

export const rawNodelDocumentElements: NodelElementDefinition[] = historicalContractOrder.map((name) => {
  const definition = historicalElementIndex[name];
  if (!definition) throw new Error(`Missing contract definition while building ordered list for ${name}`);
  return definition;
});

function numericMetadataFor(elementName: string, attribute: NodelAttributeDefinition): NodelNumericConstraint | undefined {
  const name = attribute.name;
  if (elementName === 'nodel-template' && name === 'repeat') return { min: 0, max: 200, clamp: true, normalizesToInteger: true };
  if (elementName === 'nodel-template' && (name === 'start' || name === 'step')) return {};
  if (elementName === 'nodel-control-grid' && name === 'columns') return { min: 1, max: 12, clamp: true, normalizesToInteger: true };
  if (['span', 'sm', 'md', 'lg', 'xl', '2xl'].includes(name) && (elementName === 'nodel-column' || elementName === 'nodel-control-grid')) return { min: 1, max: 12, clamp: true, normalizesToInteger: true };
  if (elementName === 'nodel-column' && ['order', 'sm-order', 'md-order', 'lg-order', 'xl-order', '2xl-order'].includes(name)) return { min: -12, max: 12, clamp: true, normalizesToInteger: true };
  if (['nodel-fader', 'nodel-stepper'].includes(elementName) && ['value', 'min', 'max'].includes(name)) return {};
  if (['nodel-fader', 'nodel-stepper'].includes(elementName) && ['step', 'nudge'].includes(name)) return { min: 0, exclusiveMin: true };
  if (elementName === 'nodel-fader' && name === 'live-interval') return { min: 50, unit: 'ms', clamp: true };
  if (elementName === 'nodel-stepper' && name === 'precision') return { min: 0, max: 10, clamp: true, normalizesToInteger: true };
  if (elementName === 'nodel-stepper' && name === 'repeat-delay') return { min: 0, unit: 'ms', clamp: true };
  if (elementName === 'nodel-stepper' && name === 'repeat-interval') return { min: 50, unit: 'ms', clamp: true };
  if (elementName === 'nodel-readout' && ['min', 'max', 'warn', 'danger'].includes(name)) return {};
  if (elementName === 'nodel-readout' && name === 'precision') return { min: 0, max: 10, clamp: true, normalizesToInteger: true };
  if (elementName === 'nodel-meter' && ['value', 'min', 'max', 'warn', 'danger'].includes(name)) return {};
  if (elementName === 'nodel-node-list' && name === 'poll-interval') return { min: 0, exclusiveMin: true, unit: 'ms' };
  return undefined;
}

function consumptionFor(elementName: string, name: string): { consumption: AttributeConsumption; consumer?: string } {
  if (['visibility', 'visible-value', 'visible-values'].includes(name)) return { consumption: 'observed', consumer: 'signal-visibility-bindings' };
  if (name === 'signals') return { consumption: 'observed' };
  if (elementName === 'nodel-page' && ['title', 'nav-label', 'nav-id'].includes(name)) return { consumption: 'parent', consumer: 'nodel-app' };
  if (elementName === 'nodel-template' && name === 'data-*') return { consumption: 'wildcard' };
  if (elementName === 'nodel-button' && ['value', 'color', 'border'].includes(name)) return { consumption: 'contextual-child', consumer: 'nodel-segmented,nodel-select,nodel-palette' };
  if (elementName === 'nodel-console' && name === 'collapse-preview') return { consumption: 'contextual-child', consumer: 'nodel-collapse' };
  if (['nodel-group', 'nodel-control-grid'].includes(elementName) && name === 'fill') return { consumption: 'parent', consumer: 'nodel-column,nodel-page' };
  return { consumption: 'observed' };
}

function actionBindingsFor(element: NodelElementDefinition): ComponentActionBindingContract[] {
  const bindings = actionBindingMap[element.name] ?? {};
  return element.attributes.flatMap((attribute) => {
    const binding = bindings[attribute.name];
    return binding ? [{ attribute: attribute.name, ...binding }] : [];
  });
}

function signalBindingsFor(element: NodelElementDefinition): ComponentSignalBindingContract[] {
  const targets = signalTargetMap[element.name] ?? [];
  const aggregateTargets = new Set(element.aggregateSignalTargets ?? []);
  return element.attributes.filter((attribute) => attribute.name === 'signal' || attribute.name === 'signals' || attribute.name === 'options-signal' || (attribute.name === 'join' && element.defaultSignalTarget)).flatMap((attribute) => {
    if (attribute.name === 'join') {
      const defaultTarget = element.defaultSignalTarget;
      return defaultTarget ? [{ attribute: attribute.name, defaultTarget, targets: [{ name: defaultTarget, aggregations: [] }] }] : [];
    }
    const bindingTargets = attribute.name === 'options-signal'
      ? ['options']
      : element.name === 'nodel-icon' && attribute.name === 'signal'
        ? ['name']
        : attribute.name === 'signals' && !targets.includes('visibility') ? [...targets, 'visibility'] : targets;
    return [{
      attribute: attribute.name,
      ...(attribute.name !== 'options-signal' && element.defaultSignalTarget ? { defaultTarget: element.defaultSignalTarget } : {}),
      targets: bindingTargets.map((name) => ({ name, aggregations: aggregateTargets.has(name) || name === 'visibility' ? ['any', 'all'] : [] }))
    }];
  });
}

function enrichAttribute(element: NodelElementDefinition, attribute: NodelAttributeDefinition, completion: ComponentCompletion): ComponentAttributeContract {
  const numeric = attribute.numeric ?? numericMetadataFor(element.name, attribute);
  const binding = attribute.name === 'signal' || attribute.name === 'signals';
  const optionSignal = attribute.name === 'options-signal';
  const confirmationCodeSignal = attribute.name === 'confirm-code-signal';
  const actionAlias = attribute.name === 'action-on' || attribute.name === 'action-off';
  const action = !actionAlias && (attribute.name === 'action' || attribute.name === 'actions' || attribute.name.endsWith('-action') || attribute.name.endsWith('-actions'));
  const signalSyntax = binding ? (() => {
    const hasDefault = Boolean(element.defaultSignalTarget);
    const target = hasDefault ? 'SignalName[.path][:target]' : 'SignalName[.path]:target';
    const aggregate = element.aggregateSignalTargets?.map((value) => `${value}(any|all)`).join(', ');
    return `${target}[; or , ${target} ...]${aggregate ? `; aggregate targets: ${aggregate}` : ''}`;
  })() : undefined;
  const consumption = consumptionFor(element.name, attribute.name);
  const lifecycle = (element.name === 'nodel-page' && ['title', 'nav-label', 'nav-id'].includes(attribute.name))
    || (element.name === 'nodel-editor' && attribute.name === 'default-file') ? 'initialization' : 'dynamic';
  const { completable, ...canonicalAttribute } = attribute;
  return {
    ...attributeDefaultMetadata[`${element.name}.${attribute.name}`], ...canonicalAttribute,
    ...(binding ? { valueType: 'binding' as const, syntax: signalSyntax ?? 'SignalName[.path]:target' } : optionSignal ? { valueType: 'binding' as const, syntax: 'SignalName[.path]' } : confirmationCodeSignal ? { valueType: 'string' as const, syntax: 'LocalSignalAlias' } : action ? { valueType: 'string' as const, syntax: 'ActionName[:phase][; or , ActionName[:phase] ...]' } : {}),
    valueType: binding || optionSignal ? 'binding' : confirmationCodeSignal || action ? 'string' : attribute.valueType ?? (attribute.values ? 'enum' : numeric ? (numeric.integer ? 'integer' : 'number') : booleanAttributeNames.has(attribute.name) ? 'boolean' : 'string'),
    ...(numeric ? { numeric } : {}), completion: completable === false ? 'hidden' : completion, lifecycle, ...consumption
  };
}

function classify(name: string): { audience: ComponentAudience; registration: ComponentRegistration; completion: ComponentCompletion } {
  if (internalHosts.has(name)) return { audience: 'internal', registration: 'auto-host', completion: 'hidden' };
  if (coreNames.has(name)) return { audience: 'core', registration: 'lazy', completion: 'advanced' };
  return { audience: 'custom', registration: 'eager', completion: 'recommended' };
}

export const componentContracts: ComponentContract[] = rawNodelDocumentElements.map((raw) => {
  const classification = classify(raw.name);
  const element = { ...raw };
  const canonical = { ...element };
  delete canonical.defaultSignalTarget;
  delete canonical.aggregateSignalTargets;
  const composition = compositionMap[raw.name];
  return { ...canonical, ...classification, attributes: raw.attributes.map((attribute) => enrichAttribute(element, attribute, classification.completion)), actionBindings: actionBindingsFor(element), signalBindings: signalBindingsFor(element), events: componentEventMap[raw.name] ?? [], ...(composition ? { composition } : {}) };
});

export const componentContractCommonAttributes = commonComponentAttributes;

export function findComponentContract(name: string): ComponentContract | undefined {
  return componentContracts.find((element) => element.name === name);
}
