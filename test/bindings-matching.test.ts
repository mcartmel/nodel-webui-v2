import { bindingSimilarity, buildSuggestion, definitionsToOptions, mergeTargetDefinitions, normalizeDefinitions } from '../src/features/bindings-matching';

describe('bindings matching helpers', () => {
  it('normalizes action definitions and filters target options', () => {
    const definitions = normalizeDefinitions({
      PowerOn: { name: 'PowerOn', title: 'Power On', group: 'Display' },
      Volume: { name: 'Volume', group: 'Audio' }
    });

    expect(definitions).toEqual([
      { name: 'PowerOn', title: 'Power On', group: 'Display' },
      { name: 'Volume', title: 'Volume', group: 'Audio' }
    ]);
    expect(definitionsToOptions(definitions, 'audio')).toEqual([
      { label: 'Volume', value: 'Volume', detail: '[Audio] Volume' }
    ]);
  });

  it('scores Unicode-equivalent names as exact matches', () => {
    expect(bindingSimilarity('Café Power', 'Café Power')).toBe(1);
  });

  it('builds high, none, and ambiguous suggestions without component state', () => {
    expect(buildSuggestion({ alias: 'ProjectorPower', title: 'Projector Power' }, [
      { name: 'ProjectorPower', title: 'Projector Power', group: 'Display' },
      { name: 'Volume', title: 'Volume', group: 'Audio' }
    ])).toEqual({ value: 'ProjectorPower', label: 'high: ProjectorPower', confidence: 'high' });

    expect(buildSuggestion({ alias: 'CompletelyDifferent', title: 'Completely Different' }, [
      { name: 'Volume', title: 'Volume', group: 'Audio' }
    ])).toEqual({ value: '', label: 'No match', confidence: 'none' });

    expect(buildSuggestion({ alias: 'Power', title: 'Power' }, [
      { name: 'PowerOn', title: 'Power On', group: 'Display' },
      { name: 'PowerOff', title: 'Power Off', group: 'Display' }
    ])).toEqual({ value: '', label: 'Ambiguous (2 matches)', confidence: 'ambiguous' });
  });

  it('keeps the first target definition when merging duplicates', () => {
    expect(mergeTargetDefinitions([
      { name: 'Power', title: 'Power One', group: 'A' },
      { name: 'Power', title: 'Power Two', group: 'B' },
      { name: 'Volume', title: 'Volume', group: 'Audio' }
    ])).toEqual([
      { name: 'Power', title: 'Power One', group: 'A' },
      { name: 'Volume', title: 'Volume', group: 'Audio' }
    ]);
  });
});
