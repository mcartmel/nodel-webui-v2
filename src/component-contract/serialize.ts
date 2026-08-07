import { componentContractCommonAttributes, componentContracts } from './registry';
import { componentContractStyles } from './styles';
import { assertValidComponentContract } from './validation';
import type { ComponentContractDocument } from './types';

export function componentContractDocument(packageVersion: string): ComponentContractDocument {
  const document: ComponentContractDocument = { schemaVersion: 1, packageVersion, commonAttributes: componentContractCommonAttributes, elements: componentContracts, styles: componentContractStyles };
  assertValidComponentContract(document);
  return document;
}

export function serializeComponentContract(packageVersion: string): string { return `${JSON.stringify(componentContractDocument(packageVersion), null, 2)}\n`; }
