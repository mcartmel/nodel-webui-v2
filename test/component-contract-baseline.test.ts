// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  componentContractDocument,
  diffComponentContracts,
  serializeComponentContract,
  validateComponentContract
} from '../src/component-contract';
import type {
  ComponentAttributeContract,
  ComponentContractDiff,
  ComponentContractDocument,
  NodelAttributeDefinition,
  NodelElementDefinition
} from '../src/component-contract';

interface StageZeroSnapshot {
  packageVersion: string;
  commonAttributes: NodelAttributeDefinition[];
  elements: NodelElementDefinition[];
}

interface ReviewedBaseline {
  baseline: string;
  golden: string;
  serializedSha256: string;
  reviewedDiff: ComponentContractDiff;
  contractAnnotations: Record<string, unknown>;
}

function annotateAttribute(attribute: NodelAttributeDefinition, current: ComponentAttributeContract | undefined, completion: ComponentAttributeContract['completion']): ComponentAttributeContract {
  return {
    ...attribute,
    valueType: attribute.valueType ?? 'string',
    completion: current?.completion ?? completion,
    consumption: current?.consumption ?? 'observed',
    lifecycle: current?.lifecycle ?? 'dynamic',
    ...(current?.consumer ? { consumer: current.consumer } : {})
  };
}

function legacySurfaceDocument(snapshot: StageZeroSnapshot): ComponentContractDocument {
  const current = componentContractDocument(snapshot.packageVersion);
  const currentElements = new Map(current.elements.map((element) => [element.name, element]));
  return {
    ...current,
    commonAttributes: snapshot.commonAttributes.map((attribute) => annotateAttribute(
      attribute,
      current.commonAttributes.find((candidate) => candidate.name === attribute.name),
      'recommended'
    )),
    elements: snapshot.elements.map((element) => {
      const canonical = currentElements.get(element.name);
      if (!canonical) throw new Error(`Stage 0 contains an unknown element: ${element.name}`);
      return {
        ...canonical,
        description: element.description,
        ...(element.catalogue === undefined ? {} : { catalogue: element.catalogue }),
        ...(element.snippet === undefined ? {} : { snippet: element.snippet }),
        attributes: element.attributes.map((attribute) => annotateAttribute(
          attribute,
          canonical.attributes.find((candidate) => candidate.name === attribute.name),
          canonical.completion
        ))
      };
    })
  };
}

function annotationSummary(document: ComponentContractDocument) {
  const attributes = document.elements.flatMap((element) => element.attributes);
  const count = (values: string[], value: string) => values.filter((candidate) => candidate === value).length;
  const audiences = document.elements.map((element) => element.audience);
  const registrations = document.elements.map((element) => element.registration);
  const completions = document.elements.map((element) => element.completion);
  const consumptions = attributes.map((attribute) => attribute.consumption);
  return {
    elements: document.elements.length,
    attributes: attributes.length,
    audiences: { custom: count(audiences, 'custom'), core: count(audiences, 'core'), internal: count(audiences, 'internal') },
    registrations: { eager: count(registrations, 'eager'), lazy: count(registrations, 'lazy'), 'auto-host': count(registrations, 'auto-host') },
    completion: { recommended: count(completions, 'recommended'), advanced: count(completions, 'advanced'), hidden: count(completions, 'hidden') },
    consumption: {
      observed: count(consumptions, 'observed'),
      initialization: count(consumptions, 'initialization'),
      parent: count(consumptions, 'parent'),
      'contextual-child': count(consumptions, 'contextual-child'),
      wildcard: count(consumptions, 'wildcard')
    },
    actionBindings: document.elements.reduce((total, element) => total + element.actionBindings.length, 0),
    signalBindings: document.elements.reduce((total, element) => total + element.signalBindings.length, 0),
    signalTargets: document.elements.reduce((total, element) => total + element.signalBindings.reduce((subtotal, binding) => subtotal + binding.targets.length, 0), 0),
    events: document.elements.reduce((total, element) => total + element.events.length, 0),
    compositionRules: document.elements.filter((element) => element.composition).length,
    commonAttributes: document.commonAttributes.length,
    styles: Object.fromEntries(Object.entries(document.styles).map(([category, styles]) => [category, styles.length]))
  };
}

describe('Stage 1 reviewed component API baseline', () => {
  it('matches the reviewed Stage 0 API diff and canonical annotation counts', async () => {
    const fixtureRoot = resolve(process.cwd(), 'test/fixtures');
    const reviewed = JSON.parse(await readFile(resolve(fixtureRoot, 'production-refinement-stage1-api-diff.json'), 'utf8')) as ReviewedBaseline;
    const stageZero = JSON.parse(await readFile(resolve(fixtureRoot, reviewed.baseline), 'utf8')) as StageZeroSnapshot;
    const goldenSource = await readFile(resolve(fixtureRoot, reviewed.golden), 'utf8');
    const golden = JSON.parse(goldenSource) as ComponentContractDocument;
    const current = componentContractDocument(stageZero.packageVersion);
    expect(diffComponentContracts(legacySurfaceDocument(stageZero), current)).toEqual(reviewed.reviewedDiff);
    expect(annotationSummary(current)).toEqual(reviewed.contractAnnotations);
    expect(validateComponentContract(golden)).toEqual([]);
    expect(diffComponentContracts(golden, current)).toEqual({ breaking: [], additive: [], informational: [], operational: [] });
    expect(goldenSource).toBe(serializeComponentContract(stageZero.packageVersion));
    expect(createHash('sha256').update(serializeComponentContract(stageZero.packageVersion)).digest('hex')).toBe(reviewed.serializedSha256);
  });
});
