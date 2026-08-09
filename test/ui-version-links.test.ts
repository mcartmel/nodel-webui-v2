import { bootstrapLegacyUiLinks, legacyHostUiHref } from '../src/navigation/ui-version-links';

describe('UI version links', () => {
  beforeEach(() => {
    document.body.innerHTML = '<a data-nodel-v1-link="host">V1</a><a data-nodel-v1-link="toolkit">V1</a>';
    window.history.replaceState(undefined, '', '/nodes.html#Locals');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('maps V2 host sections to their V1 equivalents', () => {
    expect(legacyHostUiHref('#Locals')).toBe('/locals.xml');
    expect(legacyHostUiHref('#Network')).toBe('/nodes.xml');
    expect(legacyHostUiHref('#Diagnostics')).toBe('/diagnostics.xml');
    expect(legacyHostUiHref('#Unknown')).toBe('/locals.xml');
  });

  it('keeps the host toggle synchronized with hash navigation', () => {
    const dispose = bootstrapLegacyUiLinks();
    const link = document.querySelector<HTMLAnchorElement>('[data-nodel-v1-link="host"]')!;
    const toolkit = document.querySelector<HTMLAnchorElement>('[data-nodel-v1-link="toolkit"]')!;
    expect(link.getAttribute('href')).toBe('/locals.xml');
    expect(toolkit.getAttribute('href')).toBe('/toolkit.xml');

    window.history.replaceState(undefined, '', '/nodes.html#Network');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(link.getAttribute('href')).toBe('/nodes.xml');

    dispose();
    window.history.replaceState(undefined, '', '/nodes.html#Diagnostics');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(link.getAttribute('href')).toBe('/nodes.xml');
  });
});
