import type { ComponentAttributeContract, ComponentContract, ComponentContractDiff, ComponentContractDocument, ComponentSignalBindingContract } from './types';

const compareCodeUnits = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function compareSet(label: string, before: readonly string[], after: readonly string[], diff: ComponentContractDiff) {
  const oldValues = new Set(before); const newValues = new Set(after);
  for (const value of oldValues) if (!newValues.has(value)) diff.breaking.push(`${label}: removed ${value}`);
  for (const value of newValues) if (!oldValues.has(value)) diff.additive.push(`${label}: added ${value}`);
}
function infoIfChanged(label: string, before: unknown, after: unknown, diff: ComponentContractDiff) { if (JSON.stringify(before) !== JSON.stringify(after)) diff.informational.push(`${label}: changed`); }
function signalMap(bindings: ComponentSignalBindingContract[]) { return new Map(bindings.map((binding) => [binding.attribute, binding])); }

const completionRank = { hidden: 0, advanced: 1, recommended: 2 } as const;

function numericNarrowed(before: ComponentAttributeContract['numeric'], after: ComponentAttributeContract['numeric']): boolean {
  if (!after) return false;
  const minimumNarrowed = after.min !== undefined
    && (before?.min === undefined || after.min > before.min || (after.min === before.min && after.exclusiveMin === true && before.exclusiveMin !== true));
  const maximumNarrowed = after.max !== undefined && (before?.max === undefined || after.max < before.max);
  return minimumNarrowed || maximumNarrowed;
}

function compareAttributes(label: string, before: ComponentAttributeContract[], after: ComponentAttributeContract[], diff: ComponentContractDiff) {
  const oldAttributes = new Map(before.map((attribute) => [attribute.name, attribute]));
  const newAttributes = new Map(after.map((attribute) => [attribute.name, attribute]));
  for (const [name, attribute] of oldAttributes) {
    const prefix = `${label}.${name}`;
    const next = newAttributes.get(name);
    if (!next) {
      diff.breaking.push(`${prefix}: removed`);
      continue;
    }
    compareSet(`${prefix}.values`, attribute.values ?? [], next.values ?? [], diff);
    if (attribute.valueType !== next.valueType) {
      if (attribute.valueType === 'enum' && next.valueType === 'enum-or-string') diff.informational.push(`${prefix}.valueType: widened`);
      else diff.breaking.push(`${prefix}.valueType: changed`);
    }
    if (attribute.defaultValue !== next.defaultValue) diff.breaking.push(`${prefix}.defaultValue: changed`);
    if (numericNarrowed(attribute.numeric, next.numeric)) diff.breaking.push(`${prefix}.numeric: narrowed`);
    else infoIfChanged(`${prefix}.numeric`, attribute.numeric, next.numeric, diff);
    if (attribute.completion !== next.completion) {
      (completionRank[next.completion] < completionRank[attribute.completion] ? diff.breaking : diff.informational)
        .push(`${prefix}.completion: ${completionRank[next.completion] < completionRank[attribute.completion] ? 'downgraded' : 'upgraded'}`);
    }
    if (attribute.consumption !== next.consumption || attribute.consumer !== next.consumer) diff.breaking.push(`${prefix}.consumption: changed`);
    if (attribute.lifecycle !== next.lifecycle) diff.breaking.push(`${prefix}.lifecycle: changed`);
    infoIfChanged(`${prefix}.description`, attribute.description, next.description, diff);
    infoIfChanged(`${prefix}.syntax`, attribute.syntax, next.syntax, diff);
    if (attribute.defaultDescription !== next.defaultDescription) diff.breaking.push(`${prefix}.defaultDescription: changed`);
    infoIfChanged(`${prefix}.legacy`, attribute.legacy, next.legacy, diff);
  }
  for (const name of newAttributes.keys()) if (!oldAttributes.has(name)) diff.additive.push(`${label}.${name}: added`);
}

function compareElement(before: ComponentContract, after: ComponentContract, diff: ComponentContractDiff) {
  const prefix = `elements.${before.name}`;
  const audienceRank = { custom: 0, core: 1, internal: 2 } as const;
  if (before.audience !== after.audience) (audienceRank[after.audience] > audienceRank[before.audience] ? diff.breaking : diff.informational).push(`${prefix}.audience: ${audienceRank[after.audience] > audienceRank[before.audience] ? 'restricted' : 'broadened'}`);
  if (before.completion !== after.completion) (completionRank[after.completion] < completionRank[before.completion] ? diff.breaking : diff.informational).push(`${prefix}.completion: ${completionRank[after.completion] < completionRank[before.completion] ? 'downgraded' : 'upgraded'}`);
  if (Boolean(before.catalogue) !== Boolean(after.catalogue)) {
    (after.catalogue ? diff.additive : diff.breaking).push(`${prefix}.catalogue: ${after.catalogue ? 'enabled' : 'disabled'}`);
  }
  if (before.registration !== after.registration) {
    diff.operational.push(`${prefix}.registration: changed`);
    if (before.registration === 'lazy' || after.registration === 'auto-host') diff.breaking.push(`${prefix}.registration: lazy availability lost`);
  }
  const oldActions = new Map(before.actionBindings.map((binding) => [binding.attribute, binding])); const newActions = new Map(after.actionBindings.map((binding) => [binding.attribute, binding]));
  for (const [name, binding] of oldActions) { const next = newActions.get(name); if (!next) diff.breaking.push(`${prefix}.actionBindings.${name}: removed`); else { compareSet(`${prefix}.actionBindings.${name}.phases`, binding.phases, next.phases, diff); if (binding.defaultPhase !== next.defaultPhase) diff.breaking.push(`${prefix}.actionBindings.${name}.defaultPhase: changed`); } }
  for (const name of newActions.keys()) if (!oldActions.has(name)) diff.additive.push(`${prefix}.actionBindings.${name}: added`);
  const oldSignals = signalMap(before.signalBindings); const newSignals = signalMap(after.signalBindings);
  for (const [name, binding] of oldSignals) {
    const next = newSignals.get(name); if (!next) { diff.breaking.push(`${prefix}.signalBindings.${name}: removed`); continue; }
    if (binding.defaultTarget !== next.defaultTarget) diff.breaking.push(`${prefix}.signalBindings.${name}.defaultTarget: changed`);
    const oldTargets = new Map(binding.targets.map((target) => [target.name, target])); const newTargets = new Map(next.targets.map((target) => [target.name, target]));
    for (const [target, definition] of oldTargets) { const following = newTargets.get(target); if (!following) diff.breaking.push(`${prefix}.signalBindings.${name}.targets.${target}: removed`); else compareSet(`${prefix}.signalBindings.${name}.targets.${target}.aggregations`, definition.aggregations, following.aggregations, diff); }
    for (const target of newTargets.keys()) if (!oldTargets.has(target)) diff.additive.push(`${prefix}.signalBindings.${name}.targets.${target}: added`);
  }
  for (const name of newSignals.keys()) if (!oldSignals.has(name)) diff.additive.push(`${prefix}.signalBindings.${name}: added`);
  const oldEvents = new Map(before.events.map((event) => [event.name, event])); const newEvents = new Map(after.events.map((event) => [event.name, event]));
  for (const [name, event] of oldEvents) { const next = newEvents.get(name); if (!next) diff.breaking.push(`${prefix}.events.${name}: removed`); else { compareSet(`${prefix}.events.${name}.detailFields`, event.detailFields, next.detailFields, diff); if (event.bubbles !== next.bubbles || event.composed !== next.composed) diff.breaking.push(`${prefix}.events.${name}: propagation changed`); infoIfChanged(`${prefix}.events.${name}.description`, event.description, next.description, diff); } }
  for (const name of newEvents.keys()) if (!oldEvents.has(name)) diff.additive.push(`${prefix}.events.${name}: added`);
  compareAttributes(`${prefix}.attributes`, before.attributes, after.attributes, diff);
  if (JSON.stringify(before.composition) !== JSON.stringify(after.composition)) {
    const tightened = (after.composition?.requiredParent !== undefined && after.composition.requiredParent !== before.composition?.requiredParent)
      || (after.composition?.requiredDirectChildren?.some((child) => !before.composition?.requiredDirectChildren?.includes(child)) ?? false);
    (tightened ? diff.breaking : diff.informational).push(`${prefix}.composition: ${tightened ? 'tightened' : 'changed'}`);
  }
  infoIfChanged(`${prefix}.description`, before.description, after.description, diff); infoIfChanged(`${prefix}.snippet`, before.snippet, after.snippet, diff);
}
export function diffComponentContracts(before: ComponentContractDocument, after: ComponentContractDocument): ComponentContractDiff {
  const diff: ComponentContractDiff = { breaking: [], additive: [], informational: [], operational: [] };
  const oldElements = new Map(before.elements.map((element) => [element.name, element])); const newElements = new Map(after.elements.map((element) => [element.name, element]));
  for (const [name, element] of oldElements) { const next = newElements.get(name); if (!next) diff.breaking.push(`elements.${name}: removed`); else compareElement(element, next, diff); }
  for (const name of newElements.keys()) if (!oldElements.has(name)) diff.additive.push(`elements.${name}: added`);
  compareAttributes('commonAttributes', before.commonAttributes, after.commonAttributes, diff);
  for (const category of Object.keys(before.styles) as Array<keyof ComponentContractDocument['styles']>) {
    compareSet(`styles.${category}`, before.styles[category].map((style) => style.name), after.styles[category].map((style) => style.name), diff);
    const nextStyles = new Map(after.styles[category].map((style) => [style.name, style]));
    for (const style of before.styles[category]) infoIfChanged(`styles.${category}.${style.name}.description`, style.description, nextStyles.get(style.name)?.description, diff);
  }
  for (const category of Object.keys(diff) as Array<keyof ComponentContractDiff>) diff[category].sort(compareCodeUnits);
  return diff;
}
