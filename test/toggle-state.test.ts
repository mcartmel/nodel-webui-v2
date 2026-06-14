import { isToggleOnish, resolveToggleState, toggleAriaChecked } from '../src/utils/toggle-state';

describe('toggle-state', () => {
  it('resolves common boolean-like states', () => {
    expect(resolveToggleState('on')).toBe('on');
    expect(resolveToggleState('true')).toBe('on');
    expect(resolveToggleState('1')).toBe('on');
    expect(resolveToggleState('off')).toBe('off');
    expect(resolveToggleState('false')).toBe('off');
    expect(resolveToggleState('0')).toBe('off');
  });

  it('resolves partial state aliases', () => {
    expect(resolveToggleState('partiallyon')).toBe('partially-on');
    expect(resolveToggleState('partial-on')).toBe('partially-on');
    expect(resolveToggleState('mixed-off')).toBe('partially-off');
  });

  it('honours exact override values before aliases', () => {
    expect(resolveToggleState('2', { partialOnValue: '2' })).toBe('partially-on');
    expect(resolveToggleState('0', { onValue: '0' })).toBe('on');
  });

  it('maps onish and aria state consistently', () => {
    expect(isToggleOnish('partially-on')).toBe(true);
    expect(isToggleOnish('partially-off')).toBe(false);
    expect(toggleAriaChecked('on')).toBe('true');
    expect(toggleAriaChecked('off')).toBe('false');
    expect(toggleAriaChecked('partially-off')).toBe('mixed');
  });
});
