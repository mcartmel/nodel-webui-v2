import { bootstrapJsViews, getJQuery, linkTemplate } from '../src/jsviews/jsviews-runtime';

describe('JsViews runtime', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="fixture"></div><div id="fixture-attr"></div>';
  });

  it('supports live text bindings', async () => {
    const $ = await bootstrapJsViews();
    const data = { name: 'Alpha' };
    const template = $.templates('<div>{^{>name}}</div>');
    template.link('#fixture', data);

    expect(document.querySelector('#fixture')?.textContent).toBe('Alpha');

    $.observable(data).setProperty('name', 'Beta');
    await Promise.resolve();

    expect(document.querySelector('#fixture')?.textContent).toBe('Beta');
  });

  it('supports attribute binding with data-link', async () => {
    const $ = await bootstrapJsViews();
    const data = { url: '/first', active: true, label: 'Link' };

    const template = $.templates(
      '<a id="bound-link" data-link="href{:url} class{:active ? \'is-active\' : \'is-idle\'}">{^{>label}}</a>'
    );

    template.link('#fixture-attr', data);

    const link = document.querySelector('#bound-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/first');
    expect(link.className).toContain('is-active');

    $.observable(data).setProperty('url', '/second');
    $.observable(data).setProperty('active', false);
    $.observable(data).setProperty('label', 'Updated');
    await Promise.resolve();

    expect(link.getAttribute('href')).toBe('/second');
    expect(link.className).toContain('is-idle');
    expect(link.textContent).toBe('Updated');
    expect(getJQuery()).toBe($);
  });
});
