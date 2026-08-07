import { componentContractCommonAttributes, componentContracts, findComponentContract } from './registry';
import { visibilitySignalsDescription } from './shared';
import type { ComponentAttributeContract, NodelAttributeDefinition, NodelElementDefinition } from './types';

function projectAttribute(attribute: NodelAttributeDefinition | ComponentAttributeContract): NodelAttributeDefinition {
  const { name, description, values, valueType, syntax, numeric, defaultValue, defaultDescription, common, legacy } = attribute;
  const completion = 'completion' in attribute ? attribute.completion : undefined;
  const completable = 'completable' in attribute ? attribute.completable : undefined;
  return { name, description, ...(values ? { values: [...values] } : {}), ...(valueType ? { valueType } : {}), ...(syntax ? { syntax } : {}), ...(numeric ? { numeric: { ...numeric } } : {}), ...(defaultValue !== undefined ? { defaultValue } : {}), ...(defaultDescription ? { defaultDescription } : {}), ...(common ? { common } : {}), ...(legacy ? { legacy } : {}), ...(completion === 'hidden' || completable === false ? { completable: false } : {}) };
}

function projectElement(element: typeof componentContracts[number]): NodelElementDefinition {
  const { name, description, snippet, catalogue } = element;
  const signal = element.signalBindings.find((binding) => binding.defaultTarget);
  const aggregateSignalTargets = signal?.targets.filter((target) => target.aggregations.length).map((target) => target.name);
  return { name, description, attributes: element.attributes.map(projectAttribute), ...(snippet ? { snippet } : {}), ...(catalogue ? { catalogue } : {}), ...(signal?.defaultTarget ? { defaultSignalTarget: signal.defaultTarget } : {}), ...(aggregateSignalTargets?.length ? { aggregateSignalTargets } : {}) };
}

export const commonNodelAttributes = componentContractCommonAttributes.map(projectAttribute);
export const nodelDocumentElements = componentContracts.map(projectElement);
export function findNodelElement(name: string): NodelElementDefinition | undefined { return nodelDocumentElements.find((element) => element.name === name); }
export function getEffectiveCatalogueAttributes(elementOrName: NodelElementDefinition | string): NodelAttributeDefinition[] {
  const element = typeof elementOrName === 'string' ? findNodelElement(elementOrName) : elementOrName;
  if (!element) return [];
  const attributes = element.attributes.map(projectAttribute);
  const signalsIndex = attributes.findIndex((attribute) => attribute.name === 'signals');
  if (signalsIndex !== -1 && !attributes[signalsIndex].description.includes('SignalName[.path]:visibility')) {
    attributes[signalsIndex] = { ...attributes[signalsIndex], description: `${attributes[signalsIndex].description}${visibilitySignalsDescription}`, syntax: `${attributes[signalsIndex].syntax}; SignalName[.path]:visibility(any|all)` };
  }
  for (const common of commonNodelAttributes) if (!attributes.some((attribute) => attribute.name === common.name)) attributes.push(projectAttribute(common));
  return attributes;
}

export { findComponentContract };
