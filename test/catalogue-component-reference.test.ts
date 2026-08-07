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

  it('shows element classifications, including the core nodel-link reference', () => {
    document.body.innerHTML = '<div data-catalogue-reference="nodel-link"></div>';
    renderCatalogueReferences({ requiredElements: ['nodel-link'], strict: true });

    const reference = document.querySelector<HTMLElement>('[data-catalogue-reference-for="nodel-link"]')!;
    expect(reference.dataset.catalogueReferenceAudience).toBe('core');
    expect(reference.dataset.catalogueReferenceRegistration).toBe('lazy');
    expect(reference.dataset.catalogueReferenceCompletion).toBe('advanced');
    expect(reference.querySelector('[data-catalogue-reference-classification="audience"]')?.textContent).toBe('core');
    expect(reference.querySelector('.nodel-collapse-preview')?.textContent).toContain('audience: core');
    expect(reference.querySelector('.nodel-collapse-preview')?.textContent).toContain('registration: lazy');
    expect(reference.querySelector('.nodel-collapse-preview')?.textContent).toContain('completion: advanced');
  });

  it('renders attribute consumption and completion without duplicate common rows', () => {
    document.body.innerHTML = '<div data-catalogue-reference="nodel-button"></div>';
    renderCatalogueReferences({ requiredElements: ['nodel-button'], strict: true });

    const reference = document.querySelector<HTMLElement>('[data-catalogue-reference-for="nodel-button"]')!;
    const action = reference.querySelector('[data-catalogue-reference-row="action"]')!;
    expect(action.querySelector('[data-catalogue-reference-consumption="observed"]')).toBeTruthy();
    expect(action.querySelector('[data-catalogue-reference-completion="recommended"]')).toBeTruthy();

    const value = reference.querySelector('[data-catalogue-reference-row="value"]')!;
    expect(value.querySelector('[data-catalogue-reference-consumption="contextual-child"]')?.getAttribute('title'))
      .toContain('nodel-segmented,nodel-select,nodel-palette');
    expect(reference.querySelectorAll('[data-catalogue-reference-row="signals"]')).toHaveLength(1);
    expect(reference.querySelectorAll('[data-catalogue-reference-row="visibility"]')).toHaveLength(1);
    expect(reference.querySelector('[data-catalogue-reference-row="signals"] [data-catalogue-reference-badge="common"]')).toBeTruthy();
  });

  it('renders structured action and signal contract metadata', () => {
    document.body.innerHTML = '<div data-catalogue-reference="nodel-button"></div>';
    renderCatalogueReferences({ requiredElements: ['nodel-button'], strict: true });

    const reference = document.querySelector<HTMLElement>('[data-catalogue-reference-for="nodel-button"]')!;
    expect(reference.querySelector('[data-catalogue-reference-actions] [data-catalogue-reference-action-binding="actions"]')?.textContent)
      .toContain('click');
    expect(reference.querySelector('[data-catalogue-reference-actions] [data-catalogue-reference-action-binding="actions"]')?.textContent)
      .toContain('press');

    const signals = reference.querySelector('[data-catalogue-reference-signals] [data-catalogue-reference-signal-binding="signal"]')!;
    expect(signals.textContent).toContain('default: active');
    expect(signals.textContent).toContain('active (any/all)');
    expect(signals.textContent).toContain('disabled (any/all)');
    expect(reference.querySelector('[data-catalogue-reference-signal-binding="signals"]')?.textContent).toContain('visibility (any/all)');
    expect(reference.querySelector('[data-catalogue-reference-row="signals"]')?.textContent).toContain('visibility');
  });

  it('renders public events and composition only when supplied by the contract', () => {
    document.body.innerHTML = `
      <div data-catalogue-reference="nodel-page"></div>
      <div data-catalogue-reference="nodel-segmented"></div>
    `;
    renderCatalogueReferences({ requiredElements: ['nodel-page', 'nodel-segmented'], strict: true });

    const page = document.querySelector('[data-catalogue-reference-for="nodel-page"]')!;
    expect(page.querySelector('[data-catalogue-reference-row="title"] [data-catalogue-reference-lifecycle="initialization"]')).toBeTruthy();
    expect(page.querySelector('[data-catalogue-reference-events] [data-catalogue-reference-event="nodel-page-action-error"]')?.textContent)
      .toContain('action');

    const segmented = document.querySelector('[data-catalogue-reference-for="nodel-segmented"]')!;
    expect(segmented.querySelector('[data-catalogue-reference-composition]')?.textContent)
      .toContain('Advisory direct children: nodel-button');
    expect(page.querySelector('[data-catalogue-reference-composition]')).toBeNull();
  });

  it('does not render removed node-list attributes', () => {
    document.body.innerHTML = '<div data-catalogue-reference="nodel-node-list"></div>';
    renderCatalogueReferences({ requiredElements: [] });

    const names = [...document.querySelectorAll('[data-catalogue-reference-row]')]
      .map((row) => row.getAttribute('data-catalogue-reference-row'));
    expect(names).not.toEqual(expect.arrayContaining(['show-filter', 'show-total']));
  });
});
