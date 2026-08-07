/** Compatibility facade. New contract consumers import from component-contract. */
export { commonNodelAttributes, findNodelElement, getEffectiveCatalogueAttributes, nodelDocumentElements } from './component-contract/legacy';
export type { NodelAttributeDefinition, NodelAttributeValueType, NodelElementDefinition, NodelNumericConstraint } from './component-contract/types';
