import { findComponentContract } from '../src/component-contract';
import '../src/components/nodel-button';
import '../src/components/nodel-column';
import '../src/components/nodel-control-grid';

function attribute(tagName: string, attributeName: string) {
  const definition = findComponentContract(tagName)?.attributes.find((candidate) => candidate.name === attributeName);
  if (!definition) throw new Error(`Missing contract attribute ${tagName}.${attributeName}`);
  return definition;
}

describe('component contract runtime behavior', () => {
  beforeEach(() => document.body.replaceChildren());

  it.each([
    { tagName: 'nodel-column', attributeName: 'span', value: '99', expected: '12', property: '--nodel-column-span' },
    { tagName: 'nodel-column', attributeName: 'span', value: '1.9', expected: '1', property: '--nodel-column-span' },
    { tagName: 'nodel-control-grid', attributeName: 'columns', value: '0', expected: '1', property: '--nodel-control-grid-columns' }
  ])('matches declared numeric normalization for $tagName.$attributeName=$value', ({ tagName, attributeName, value, expected, property }) => {
    const definition = attribute(tagName, attributeName);
    expect(definition.valueType).toBe('number');
    expect(definition.numeric).toMatchObject({ min: 1, max: 12, clamp: true, normalizesToInteger: true });
    const element = document.createElement(tagName) as HTMLElement;
    element.setAttribute(attributeName, value);
    document.body.append(element);
    expect(element.style.getPropertyValue(property)).toBe(expected);
  });

  it.each([
    { attributeName: 'variant', value: 'danger', className: 'nodel-button-danger' },
    { attributeName: 'tone', value: 'outline', className: 'nodel-button-outline' }
  ])('matches declared enum and observed updates for nodel-button.$attributeName', ({ attributeName, value, className }) => {
    const definition = attribute('nodel-button', attributeName);
    expect(definition.values).toContain(value);
    expect(definition.consumption).toBe('observed');
    const element = document.createElement('nodel-button');
    document.body.append(element);
    element.setAttribute(attributeName, value);
    expect(element.querySelector('button')?.classList.contains(className)).toBe(true);
  });

  it('matches declared defaults in DOM-visible state', () => {
    const column = document.createElement('nodel-column') as HTMLElement;
    const button = document.createElement('nodel-button');
    document.body.append(column, button);
    expect(attribute('nodel-column', 'span').defaultValue).toBe('12');
    expect(column.dataset.span).toBe('12');
    expect(attribute('nodel-button', 'variant').defaultValue).toBe('default');
    expect(button.querySelector('button')?.className).not.toMatch(/nodel-button-(?:primary|danger|warning|success|info|ghost|link)/);
  });
});
