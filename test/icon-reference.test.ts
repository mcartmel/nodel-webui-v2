import { formatIconReference, parseIconReference, resolveIconReferenceName, selectIconReference } from '../src/icons/icon-reference';

describe('shared icon reference syntax', () => {
  it('trims authored names and gives the exact MDI namespace precedence', () => {
    expect(parseIconReference('  mdi:lightbulb  ')).toEqual({ valid: true, library: 'mdi', name: 'lightbulb', prefixed: true });
    expect(selectIconReference(parseIconReference('mdi:lightbulb'), 'brands', 'brands')).toEqual({ library: 'mdi', family: 'mdi', style: 'default' });
    expect(parseIconReference(' Lightbulb ')).toMatchObject({ valid: false });
  });

  it('rejects malformed namespaces instead of treating them as FA names', () => {
    for (const name of ['mdi:', 'mdi:Lightbulb', 'mdi:lightbulb-outline:small', 'MDI:power', 'other:power', 'a/b']) {
      expect(parseIconReference(name).valid, name).toBe(false);
      expect(selectIconReference(parseIconReference(name))).toBeNull();
    }
  });

  it('leaves omitted FA styles unresolved for manifest defaults, including curated icons', () => {
    expect(selectIconReference(parseIconReference('image'))).toEqual({ library: 'fontawesome', family: 'classic', style: '' });
    expect(selectIconReference(parseIconReference('image'), 'classic', 'solid')).toEqual({ library: 'fontawesome', family: 'classic', style: 'solid' });
    expect(selectIconReference(parseIconReference('image'), 'classic', 'regular')).toEqual({ library: 'fontawesome', family: 'classic', style: 'regular' });
  });

  it('keeps aliases Font Awesome-only and formats canonical MDI names', () => {
    const aliases = { power: 'power-off', bulb: 'lightbulb' };
    expect(resolveIconReferenceName(parseIconReference('power'), aliases)).toBe('power-off');
    expect(resolveIconReferenceName(parseIconReference('mdi:power'), aliases)).toBe('power');
    expect(resolveIconReferenceName(parseIconReference('mdi:bulb'), aliases)).toBe('bulb');
    expect(formatIconReference('mdi', 'lightbulb')).toBe('mdi:lightbulb');
    expect(formatIconReference('fontawesome', 'lightbulb')).toBe('lightbulb');
  });
});
