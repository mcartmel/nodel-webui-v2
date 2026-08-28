import { isStrictActionBindingList } from '../src/utils/action-binding-validation';

describe('strict action binding validation', () => {
  it.each([
    ['Run', true], ['Run:trigger', true], [' First ; Second:trigger ', true],
    [':trigger', false], ['Run:', false], ['Run:other', false], ['Run;', false],
    [';Run', false], [' ', false], ['\uFEFFRun\uFEFF', true], ['\uFEFF', true]
  ])('validates %j consistently', (value, expected) => {
    expect(isStrictActionBindingList(value)).toBe(expected);
  });

  it('accepts absent values but rejects present empty values', () => {
    expect(isStrictActionBindingList(null)).toBe(true);
    expect(isStrictActionBindingList(undefined)).toBe(true);
    expect(isStrictActionBindingList('')).toBe(false);
  });
});
