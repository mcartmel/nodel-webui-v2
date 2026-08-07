// @vitest-environment node

import { componentContractDocument, serializeComponentContract, validateComponentContract } from '../src/component-contract';
// @ts-expect-error Release validators are intentionally plain Node ESM.
import { validateComponentContractArtifact } from '../scripts/component-contract-validator.mjs';

describe('component contract artifact validator parity', () => {
  it('accepts the canonical serialized document in both validation layers', () => {
    const source = serializeComponentContract('1.2.3');
    expect(validateComponentContract(componentContractDocument('1.2.3'))).toEqual([]);
    expect(validateComponentContractArtifact(source, '1.2.3')).toEqual(JSON.parse(source));
  });

  it.each([
    ['invalid value type', (document: any) => { document.elements[0].attributes[0].valueType = 'anything'; }],
    ['nonnumeric constraints', (document: any) => { document.elements[0].attributes[0].numeric = { min: 1 }; }],
    ['invalid style', (document: any) => { document.styles.semanticClasses[0].description = ''; }],
    ['unexpected key', (document: any) => { document.elements[0].attributes[0].sourcePath = '/tmp/source.ts'; }]
  ])('rejects %s before serialization and at artifact boundaries', (_label, mutate) => {
    const document = structuredClone(componentContractDocument('1.2.3')) as any;
    mutate(document);
    expect(validateComponentContract(document)).not.toEqual([]);
    expect(() => validateComponentContractArtifact(JSON.stringify(document), '1.2.3')).toThrow(/Component contract/);
  });
});
