import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
describe('production refinement Stage 0 baseline', () => {
  it('retains immutable pre-contract registry and metadata evidence', async () => {
    const baseline = JSON.parse(await readFile(resolve(process.cwd(), 'test/fixtures/production-refinement-stage0-component-contract.json'), 'utf8')) as {
      baselineSchema: string;
      packageVersion: string;
      registry: { eager: string[]; lazy: string[]; documentedCustom: string[]; documentedCore: string[] };
      commonAttributes: Array<{ name: string }>;
      elements: Array<{ name: string; attributes: Array<{ name: string }> }>;
    };
    expect(baseline).toMatchObject({ baselineSchema: 'pre-component-contract', packageVersion: '0.1.2' });
    expect(baseline.registry.eager).toHaveLength(35);
    expect(baseline.registry.lazy).toHaveLength(15);
    expect(baseline.registry.documentedCustom).toHaveLength(32);
    expect(baseline.registry.documentedCore).toHaveLength(18);
    expect(baseline.commonAttributes.map((attribute) => attribute.name)).toEqual(['signals', 'visibility', 'visible-value', 'visible-values']);
    expect(baseline.elements).toHaveLength(50);
    expect(baseline.elements.find((element) => element.name === 'nodel-node-list')?.attributes.map((attribute) => attribute.name))
      .toEqual(expect.arrayContaining(['show-filter', 'show-total']));
  });
});
