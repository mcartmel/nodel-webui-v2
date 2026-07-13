import { DynamicOptionsController, normalizeDynamicOptions } from '../src/data/dynamic-options';

function optionTexts(container: HTMLElement) {
  return Array.from(container.querySelectorAll('nodel-button')).map((option) => `${option.getAttribute('value')}:${option.textContent}`);
}

describe('dynamic options', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('normalizes scalar, modern, v1, mixed, and empty payloads', () => {
    expect(normalizeDynamicOptions(['HDMI 1', 42, true])).toEqual({ ok: true, options: [
      { value: 'HDMI 1', label: 'HDMI 1' },
      { value: '42', label: '42' },
      { value: 'true', label: 'true' }
    ] });
    expect(normalizeDynamicOptions([{ value: 'HDMI1', label: 'HDMI 1' }, { key: '203', value: 'Input 1 - HDMI' }, { key: '', value: 'Fallback' }, { value: 'Missing key fallback' }])).toEqual({ ok: true, options: [
      { value: 'HDMI1', label: 'HDMI 1' },
      { value: '203', label: 'Input 1 - HDMI' },
      { value: 'Fallback', label: 'Fallback' },
      { value: 'Missing key fallback', label: 'Missing key fallback' }
    ] });
    expect(normalizeDynamicOptions([])).toEqual({ ok: true, options: [] });
  });

  it('preserves non-blank scalar text after string conversion', () => {
    expect(normalizeDynamicOptions([' HDMI 1 ', { value: ' raw ', label: ' Raw label ' }])).toEqual({ ok: true, options: [
      { value: ' HDMI 1 ', label: ' HDMI 1 ' },
      { value: ' raw ', label: ' Raw label ' }
    ] });
  });

  it('rejects invalid payloads atomically', () => {
    expect(normalizeDynamicOptions('not-array').ok).toBe(false);
    expect(normalizeDynamicOptions([null]).ok).toBe(false);
    expect(normalizeDynamicOptions(['']).ok).toBe(false);
    expect(normalizeDynamicOptions([Number.POSITIVE_INFINITY]).ok).toBe(false);
    expect(normalizeDynamicOptions([{ label: 'Missing value' }]).ok).toBe(false);
    expect(normalizeDynamicOptions([{ value: 'A', label: null }]).ok).toBe(false);
    expect(normalizeDynamicOptions([{ value: 'A', label: '' }]).ok).toBe(false);
    expect(normalizeDynamicOptions([{ value: { nested: true }, label: 'Nested' }]).ok).toBe(false);
    expect(normalizeDynamicOptions([{ key: { nested: true }, value: 'Nested key' }]).ok).toBe(false);
    expect(normalizeDynamicOptions([{ key: ['nested'], value: 'Nested key' }]).ok).toBe(false);
    expect(normalizeDynamicOptions([{ key: Number.NaN, value: 'NaN key' }]).ok).toBe(false);
    expect(normalizeDynamicOptions(['A', { value: 'A', label: 'Duplicate' }]).ok).toBe(false);
    expect(normalizeDynamicOptions(Array.from({ length: 201 }, (_, index) => index)).ok).toBe(false);
  });

  it('reconciles generated options and restores fallback nodes', () => {
    const container = document.createElement('div');
    const fallback = document.createElement('nodel-button');
    fallback.setAttribute('value', 'Fallback');
    fallback.textContent = 'Fallback source';
    container.appendChild(fallback);
    document.body.appendChild(container);

    const controller = new DynamicOptionsController(container, (option) => {
      const node = document.createElement('nodel-button');
      node.setAttribute('value', option.value);
      node.textContent = option.label;
      return node;
    });

    controller.setBindingActive(true);
    expect(controller.applyPayload([{ value: 'A', label: '<b>A</b>' }, { value: 'B', label: 'B' }]).ok).toBe(true);
    expect(optionTexts(container)).toEqual(['A:<b>A</b>', 'B:B']);
    const firstA = container.querySelector('nodel-button[value="A"]');

    expect(controller.applyPayload([{ value: 'B', label: 'Bee' }, { value: 'A', label: 'A' }]).ok).toBe(true);
    expect(container.querySelector('nodel-button[value="A"]')).toBe(firstA);
    expect(optionTexts(container)).toEqual(['B:Bee', 'A:A']);

    expect(controller.applyPayload(['B', 'B']).ok).toBe(false);
    expect(optionTexts(container)).toEqual(['B:Bee', 'A:A']);

    controller.setBindingActive(false);
    expect(Array.from(container.children)).toEqual([fallback]);
  });

  it('does not report focus removal for another controller container', () => {
    const focusedContainer = document.createElement('div');
    const updatedContainer = document.createElement('div');
    const focusedOption = document.createElement('nodel-button');
    const focusedButton = document.createElement('button');
    focusedOption.dataset.nodelDynamicOption = '';
    focusedOption.setAttribute('value', 'A');
    focusedOption.appendChild(focusedButton);
    focusedContainer.appendChild(focusedOption);
    document.body.append(focusedContainer, updatedContainer);
    focusedButton.focus();

    const controller = new DynamicOptionsController(updatedContainer, (option) => {
      const node = document.createElement('nodel-button');
      node.setAttribute('value', option.value);
      node.textContent = option.label;
      return node;
    });
    controller.setBindingActive(true);

    const result = controller.applyPayload(['B']);

    expect(result.removedFocused).toBe(false);
    expect(document.activeElement).toBe(focusedButton);
  });
});
