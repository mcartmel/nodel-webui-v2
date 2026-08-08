// @vitest-environment node

import { componentContractDocument } from '../src/component-contract';
import { canonicalDiff, canonicalizeContract, semanticContractHash } from '../scripts/report-component-contract.mjs';
import { readFile } from 'node:fs/promises';

describe('canonical component contract report', () => {
  it('hashes semantic content independent of object whitespace and key ordering', async () => {
    const first = '{"b":2,"a":{"y":1,"x":[3,2]}}';
    const second = '{\n  "a": { "x": [3, 2], "y": 1 },\n  "b": 2\n}';
    expect(semanticContractHash(first)).toBe(semanticContractHash(second));
    expect(canonicalizeContract(JSON.parse(first))).toEqual({ a: { x: [3, 2], y: 1 }, b: 2 });
    expect(await readFile('scripts/report-component-contract.mjs', 'utf8')).not.toContain('dist/v2/nodel-components.json');
  });

  it('preserves canonical enum, default, phase, target, prose, and operational categories', async () => {
    const before = componentContractDocument('1.2.3');
    const after = structuredClone(before);
    const button = after.elements.find((element) => element.name === 'nodel-button')!;
    const variant = button.attributes.find((attribute) => attribute.name === 'variant')!;
    variant.values = variant.values!.slice(0, 1);
    variant.defaultValue = 'changed';
    button.actionBindings[0]!.phases = button.actionBindings[0]!.phases.slice(0, 1);
    const signals = button.signalBindings.find((binding) => binding.targets.length > 1)!;
    signals.targets = signals.targets.slice(0, 1);
    button.description = `${button.description} changed`;
    button.registration = button.registration === 'eager' ? 'lazy' : 'eager';
    const diff = await canonicalDiff(before, after);
    expect(diff.breaking).toEqual(expect.arrayContaining([
      'elements.nodel-button.attributes.variant.values: removed danger',
      'elements.nodel-button.attributes.variant.defaultValue: changed',
      'elements.nodel-button.actionBindings.action.phases: removed press',
    ]));
    expect(diff.breaking.some((item) => item.includes('.signalBindings.signal.targets.') && item.endsWith(': removed'))).toBe(true);
    expect(diff.informational).toContain('elements.nodel-button.description: changed');
    expect(diff.operational).toContain('elements.nodel-button.registration: changed');
  });
});
