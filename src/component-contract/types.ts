export type NodelAttributeValueType = 'boolean' | 'presence-or-text' | 'string' | 'binding' | 'enum' | 'enum-or-string' | 'number' | 'integer' | 'template-data';
export type ComponentAudience = 'custom' | 'core' | 'internal';
export type ComponentRegistration = 'eager' | 'lazy' | 'auto-host';
export type ComponentCompletion = 'recommended' | 'advanced' | 'hidden';
export type AttributeConsumption = 'observed' | 'initialization' | 'parent' | 'contextual-child' | 'wildcard';
export type AttributeLifecycle = 'dynamic' | 'initialization';

export interface NodelNumericConstraint {
  integer?: boolean;
  normalizesToInteger?: boolean;
  min?: number;
  exclusiveMin?: boolean;
  max?: number;
  unit?: string;
  clamp?: boolean;
}

export interface NodelAttributeDefinition {
  name: string;
  description: string;
  values?: string[];
  valueType?: NodelAttributeValueType;
  syntax?: string;
  numeric?: NodelNumericConstraint;
  defaultValue?: string;
  defaultDescription?: string;
  common?: boolean;
  legacy?: string;
  completable?: boolean;
}

export interface NodelElementDefinition {
  name: string;
  description: string;
  attributes: NodelAttributeDefinition[];
  snippet?: string;
  catalogue?: boolean;
  defaultSignalTarget?: string;
  aggregateSignalTargets?: string[];
}

export interface ComponentAttributeContract extends NodelAttributeDefinition {
  completion: ComponentCompletion;
  consumption: AttributeConsumption;
  lifecycle: AttributeLifecycle;
  consumer?: string;
}

export interface ComponentActionBindingContract {
  attribute: string;
  phases: string[];
  defaultPhase?: string;
}

export interface ComponentSignalTargetContract {
  name: string;
  aggregations: Array<'any' | 'all'>;
}

export interface ComponentSignalBindingContract {
  attribute: string;
  defaultTarget?: string;
  targets: ComponentSignalTargetContract[];
}

export interface ComponentEventContract {
  name: string;
  description: string;
  bubbles: boolean;
  composed: boolean;
  detailFields: string[];
}

export interface ComponentCompositionContract {
  requiredParent?: string;
  requiredDirectChildren?: string[];
  advisoryDirectChildren?: string[];
}

export interface ComponentContract extends Omit<NodelElementDefinition, 'attributes'> {
  audience: ComponentAudience;
  registration: ComponentRegistration;
  completion: ComponentCompletion;
  attributes: ComponentAttributeContract[];
  actionBindings: ComponentActionBindingContract[];
  signalBindings: ComponentSignalBindingContract[];
  events: ComponentEventContract[];
  composition?: ComponentCompositionContract;
}

export interface ComponentContractDocument {
  schemaVersion: 1;
  packageVersion: string;
  commonAttributes: ComponentAttributeContract[];
  elements: ComponentContract[];
  styles: ComponentContractStyles;
}

export interface ComponentStyleDefinition { name: string; description: string; }
export interface ComponentContractStyles {
  semanticClasses: ComponentStyleDefinition[];
  stateClasses: ComponentStyleDefinition[];
  tailwindUtilities: ComponentStyleDefinition[];
}

export interface ComponentContractDiff {
  breaking: string[];
  additive: string[];
  informational: string[];
  operational: string[];
}
