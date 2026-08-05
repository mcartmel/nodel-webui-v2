import {
  CatalogueReferenceError,
  renderCatalogueReferences
} from '../src/catalogue/component-reference';

describe('catalogue component reference renderer', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('renders a semantic table with enum, boolean, numeric, syntax, and defaults', () => {
    document.body.innerHTML = '<div data-catalogue-reference="nodel-button"></div>';
    renderCatalogueReferences({ requiredElements: ['nodel-button'], strict: true });

    const reference = document.querySelector('[data-catalogue-reference-for="nodel-button"]')!;
    const table = reference.querySelector('table')!;
    expect(table.caption?.textContent).toBe('nodel-button attributes');
    expect(table.querySelectorAll('thead th')).toHaveLength(4);
    expect(table.querySelector('[data-catalogue-reference-row="variant"]')?.textContent).toContain('default');
    expect(table.querySelector('[data-catalogue-reference-row="disabled"]')?.textContent).toContain('present');
    expect(table.querySelector('[data-catalogue-reference-row="confirm"]')?.textContent).toContain('"text"');
    expect(table.querySelector('[data-catalogue-reference-row="action-on"]')?.textContent).toContain('Legacy:');
    expect(table.querySelector('[data-catalogue-reference-row="signals"]')).toBeTruthy();
    expect(table.querySelectorAll('[data-catalogue-reference-row="signals"]')).toHaveLength(1);
    expect(reference.querySelector('[data-catalogue-reference-badge]')?.textContent).toBe('common');
  });

  it('describes bounded and unbounded numeric values without inventing bounds', () => {
    document.body.innerHTML = `
      <div data-catalogue-reference="nodel-column"></div>
      <div data-catalogue-reference="nodel-fader"></div>
    `;
    renderCatalogueReferences({ requiredElements: ['nodel-column', 'nodel-fader'] });

    const bounded = document.querySelector('[data-catalogue-reference-for="nodel-column"]')!;
    expect(bounded.querySelector('[data-catalogue-reference-row="span"]')?.textContent).toContain('>= 1');
    expect(bounded.querySelector('[data-catalogue-reference-row="span"]')?.textContent).toContain('<= 12');
    expect(bounded.querySelector('[data-catalogue-reference-row="span"]')?.textContent).toContain('normalized to');

    const unbounded = document.querySelector('[data-catalogue-reference-for="nodel-fader"]')!;
    const value = unbounded.querySelector('[data-catalogue-reference-row="value"]')?.textContent ?? '';
    expect(value).toContain('Finite number');
    expect(value).not.toContain('>=');
    expect(value).not.toContain('<=');
  });

  it('renders binding, string, template syntax and default states', () => {
    document.body.innerHTML = `
      <div data-catalogue-reference="nodel-app"></div>
      <div data-catalogue-reference="nodel-template"></div>
    `;
    renderCatalogueReferences({ requiredElements: ['nodel-app', 'nodel-template'] });

    const app = document.querySelector('[data-catalogue-reference-for="nodel-app"]')!;
    expect(app.querySelector('[data-catalogue-reference-row="signal"]')?.textContent).toContain('SignalName');
    expect(app.querySelector('[data-catalogue-reference-row="theme"]')?.textContent).toContain('stored theme preference');
    expect(app.querySelector('[data-catalogue-reference-row="title"]')?.textContent).toContain('Not set');

    const template = document.querySelector('[data-catalogue-reference-for="nodel-template"]')!;
    expect(template.querySelector('[data-catalogue-reference-row="data-*"]')?.textContent).toContain('data-name');
  });

  it('renders specialized numeric syntax and a labelled keyboard-scroll region', () => {
    document.body.innerHTML = '<div data-catalogue-reference="nodel-qrcode"></div>';
    renderCatalogueReferences({ requiredElements: ['nodel-qrcode'], strict: true });

    const reference = document.querySelector('[data-catalogue-reference-for="nodel-qrcode"]')!;
    expect(reference.querySelector('[data-catalogue-reference-row="size"]')?.textContent).toContain('unsigned decimal');
    expect(reference.querySelector('[data-catalogue-reference-row="size"]')?.textContent).toContain('normalized to');
    const region = reference.querySelector<HTMLElement>('[role="region"]')!;
    expect(region.tabIndex).toBe(0);
    expect(region.getAttribute('aria-label')).toBe('nodel-qrcode attribute table');
  });

  it('shows suggested enum values without hiding accepted open aliases', () => {
    document.body.innerHTML = '<div data-catalogue-reference="nodel-status"></div>';
    renderCatalogueReferences({ requiredElements: ['nodel-status'], strict: true });

    const state = document.querySelector('[data-catalogue-reference-row="state"]')?.textContent ?? '';
    expect(state).toContain('success');
    expect(state).toContain('recognized state alias');
  });

  it('visibly degrades unknown, non-catalogue, and duplicate markers', () => {
    document.body.innerHTML = `
      <div data-catalogue-reference="missing-element"></div>
      <div data-catalogue-reference="nodel-editor"></div>
      <div data-catalogue-reference="nodel-button"></div>
      <div data-catalogue-reference="nodel-button"></div>
    `;
    const issues = renderCatalogueReferences({ requiredElements: [] });

    expect(issues.map((issue) => issue.code)).toEqual(['duplicate', 'duplicate', 'non-catalogue', 'unknown']);
    expect(document.querySelectorAll('[data-catalogue-reference-error]')).toHaveLength(4);
    expect(document.querySelectorAll('[data-catalogue-reference-for]')).toHaveLength(0);
  });

  it('throws after rendering strict missing-marker issues', () => {
    expect(() => renderCatalogueReferences({ strict: true, requiredElements: ['nodel-button'] }))
      .toThrow(CatalogueReferenceError);
    expect(document.querySelector('[data-catalogue-reference-error="missing"]')?.textContent)
      .toContain('nodel-button');
  });

  it('accepts a complete isolated marker set in strict mode', () => {
    document.body.innerHTML = '<div data-catalogue-reference="nodel-status"></div>';
    expect(() => renderCatalogueReferences({ strict: true, requiredElements: ['nodel-status'] })).not.toThrow();
    expect(document.querySelector('caption')?.textContent).toBe('nodel-status attributes');
  });
});
