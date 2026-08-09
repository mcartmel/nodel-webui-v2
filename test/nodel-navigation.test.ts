import { flush } from './helpers';
import '../src/components/nodel-app';
import '../src/components/nodel-toolbar';
import '../src/components/nodel-page';
import '../src/components/nodel-row';
import '../src/components/nodel-column';
import '../src/components/nodel-text';
import '../src/components/nodel-image';
import { findComponentContract } from '../src/component-contract';

async function waitForNavigation() {
  await customElements.whenDefined('nodel-app');
  await customElements.whenDefined('nodel-toolbar');
  await customElements.whenDefined('nodel-page');
  await flush();
}

function renderNavigationFixture() {
  document.body.innerHTML = `
    <nodel-app theme="default" title="Nodel">
      <nodel-toolbar icon-src="./v2/img/logo.png"></nodel-toolbar>

        <nodel-page title="Overview">
          <nodel-row>
          <nodel-column span="12"><nodel-text id="overview-content">Overview</nodel-text></nodel-column>
          </nodel-row>
        </nodel-page>

      <nodel-page title="Areas">
        <nodel-page title="Upstairs">
          <nodel-row>
            <nodel-column span="12"><nodel-text id="upstairs-content">Upstairs</nodel-text></nodel-column>
          </nodel-row>
        </nodel-page>

        <nodel-page title="Downstairs">
          <nodel-row>
            <nodel-column span="12"><nodel-text id="downstairs-content">Downstairs</nodel-text></nodel-column>
          </nodel-row>
        </nodel-page>
      </nodel-page>
    </nodel-app>
  `;
}

describe('nodel page navigation', () => {
  beforeEach(() => {
    window.history.replaceState(undefined, '', '/');
    document.body.innerHTML = '';
  });

  it('discovers top-level pages and nested page groups', async () => {
    renderNavigationFixture();
    await waitForNavigation();

    const app = document.querySelector('nodel-app') as HTMLElement;
    const overviewPage = document.querySelector('nodel-page[title="Overview"]') as HTMLElement;
    const areasPage = document.querySelector('nodel-page[title="Areas"]') as HTMLElement;
    const upstairsPage = document.querySelector('nodel-page[title="Upstairs"]') as HTMLElement;

    expect(app.dataset.activePage).toBe('Overview');
    expect(document.querySelector('[data-nav-page-id="Overview"]')).not.toBeNull();
    expect(document.querySelector('[data-nav-group-id="Areas"]')).not.toBeNull();
    expect(document.querySelector('[data-nav-page-id="Upstairs"]')).not.toBeNull();
    expect(overviewPage.hidden).toBe(false);
    expect(areasPage.hidden).toBe(true);
    expect(upstairsPage.hidden).toBe(true);
  });

  it('suspends every page synchronously before the initial navigation sync', () => {
    renderNavigationFixture();

    for (const page of document.querySelectorAll<HTMLElement>('nodel-page')) {
      expect(page.hidden).toBe(true);
      expect(page.hasAttribute('active')).toBe(false);
      expect(page.dataset.activePage).toBe('false');
    }
  });

  it('synchronously removes old media and suspends every route across reconnect hash navigation', async () => {
    renderNavigationFixture();
    const app = document.querySelector('nodel-app') as HTMLElement;
    const overview = document.querySelector('nodel-page[title="Overview"]') as HTMLElement;
    const upstairs = document.querySelector('nodel-page[title="Upstairs"]') as HTMLElement;
    overview.insertAdjacentHTML('beforeend', '<nodel-image src="old.png"></nodel-image>');
    upstairs.insertAdjacentHTML('beforeend', '<nodel-image src="latest.png"></nodel-image>');
    await waitForNavigation();

    expect(overview.querySelector('.nodel-image-media')).not.toBeNull();
    app.remove();
    expect(overview.querySelector('.nodel-image-media')).toBeNull();

    window.history.replaceState(undefined, '', '/#Upstairs');
    document.body.append(app);
    for (const page of app.querySelectorAll<HTMLElement>('nodel-page')) {
      expect(page.hidden).toBe(true);
      expect(page.hasAttribute('active')).toBe(false);
      expect(page.querySelector('.nodel-image-media')).toBeNull();
    }

    await waitForNavigation();
    expect(upstairs.querySelector('.nodel-image-media')?.getAttribute('src')).toBe('latest.png');
    expect(app.querySelectorAll('.nodel-image-media')).toHaveLength(1);
  });

  it('releases nested active-page claims during rapid remove and reinsert', async () => {
    window.history.replaceState(undefined, '', '/#Upstairs');
    renderNavigationFixture();
    const app = document.querySelector('nodel-app') as HTMLElement;
    const group = document.querySelector('nodel-page[title="Areas"]') as HTMLElement;
    const leaf = document.querySelector('nodel-page[title="Upstairs"]') as HTMLElement;
    leaf.insertAdjacentHTML('beforeend', '<nodel-image src="nested-latest.png"></nodel-image>');
    await waitForNavigation();
    await flush();

    expect(group.hasAttribute('active')).toBe(true);
    expect(leaf.querySelector('.nodel-image-media')).not.toBeNull();

    group.remove();
    expect(leaf.querySelector('.nodel-image-media')).toBeNull();
    app.append(group);
    expect(group.hasAttribute('active')).toBe(true);
    expect(leaf.hasAttribute('active')).toBe(true);
    expect(leaf.querySelector('.nodel-image-media')).toBeNull();

    await waitForNavigation();
    expect(group.hasAttribute('active')).toBe(true);
    expect(leaf.hasAttribute('active')).toBe(true);
    expect(leaf.querySelector('.nodel-image-media')?.getAttribute('src')).toBe('nested-latest.png');
  });

  it('releases an active nested leaf claim during rapid leaf remove and reinsert', async () => {
    window.history.replaceState(undefined, '', '/#Upstairs');
    renderNavigationFixture();
    const app = document.querySelector('nodel-app') as HTMLElement;
    const group = document.querySelector('nodel-page[title="Areas"]') as HTMLElement;
    const leaf = document.querySelector('nodel-page[title="Upstairs"]') as HTMLElement;
    leaf.insertAdjacentHTML('beforeend', '<nodel-image src="leaf-latest.png"></nodel-image>');
    await waitForNavigation();
    await flush();

    expect(leaf.querySelector('.nodel-image-media')).not.toBeNull();
    leaf.remove();
    expect(leaf.querySelector('.nodel-image-media')).toBeNull();
    group.append(leaf);
    expect(leaf.hasAttribute('active')).toBe(true);
    expect(leaf.querySelector('.nodel-image-media')).toBeNull();

    await waitForNavigation();
    expect(leaf.querySelector('.nodel-image-media')?.getAttribute('src')).toBe('leaf-latest.png');
    expect(app.querySelectorAll('.nodel-image-media')).toHaveLength(1);
  });

  it('treats page navigation attributes as initialization-time parent inputs', async () => {
    renderNavigationFixture();
    await waitForNavigation();
    const page = document.querySelector('nodel-page[title="Overview"]') as HTMLElement;
    for (const name of ['title', 'nav-label', 'nav-id']) {
      expect(findComponentContract('nodel-page')?.attributes.find((attribute) => attribute.name === name))
        .toMatchObject({ consumption: 'parent', consumer: 'nodel-app' });
    }

    page.setAttribute('title', 'Changed title');
    page.setAttribute('nav-label', 'Changed label');
    page.setAttribute('nav-id', 'ChangedId');
    await flush();

    expect(document.querySelector('[data-nav-page-id="Overview"]')?.textContent).toContain('Overview');
    expect(document.querySelector('[data-nav-page-id="ChangedId"]')).toBeNull();
  });

  it('selects the page matching the startup hash', async () => {
    window.history.replaceState(undefined, '', '/#Downstairs');
    renderNavigationFixture();
    await waitForNavigation();

    const app = document.querySelector('nodel-app') as HTMLElement;
    const overviewPage = document.querySelector('nodel-page[title="Overview"]') as HTMLElement;
    const areasPage = document.querySelector('nodel-page[title="Areas"]') as HTMLElement;
    const downstairsPage = document.querySelector('nodel-page[title="Downstairs"]') as HTMLElement;

    expect(app.dataset.activePage).toBe('Downstairs');
    expect(overviewPage.hidden).toBe(true);
    expect(areasPage.hidden).toBe(false);
    expect(downstairsPage.hidden).toBe(false);
  });

  it('activates the nested startup hash group and leaf only', async () => {
    window.history.replaceState(undefined, '', '/#Upstairs');
    renderNavigationFixture();
    await waitForNavigation();

    const overviewPage = document.querySelector('nodel-page[title="Overview"]') as HTMLElement;
    const areasPage = document.querySelector('nodel-page[title="Areas"]') as HTMLElement;
    const upstairsPage = document.querySelector('nodel-page[title="Upstairs"]') as HTMLElement;
    const downstairsPage = document.querySelector('nodel-page[title="Downstairs"]') as HTMLElement;

    expect(overviewPage.hasAttribute('active')).toBe(false);
    expect(areasPage.hasAttribute('active')).toBe(true);
    expect(upstairsPage.hasAttribute('active')).toBe(true);
    expect(downstairsPage.hasAttribute('active')).toBe(false);
    expect(areasPage.hidden).toBe(false);
    expect(upstairsPage.hidden).toBe(false);
    expect(downstairsPage.hidden).toBe(true);
  });

  it('selects submenu pages without Bootstrap or jQuery', async () => {
    renderNavigationFixture();
    await waitForNavigation();

    const groupButton = document.querySelector('[data-nav-group-id="Areas"]') as HTMLButtonElement;
    groupButton.click();
    await waitForNavigation();

    const menu = document.querySelector('#nodel-menu-Areas') as HTMLElement;
    const downstairsButton = document.querySelector('[data-nav-page-id="Downstairs"]') as HTMLButtonElement;
    const openGroupButton = document.querySelector('[data-nav-group-id="Areas"]') as HTMLButtonElement;
    expect(menu.hidden).toBe(false);
    expect(openGroupButton.getAttribute('aria-expanded')).toBe('true');
    expect(openGroupButton.getAttribute('aria-controls')).toBe(menu.id);
    expect(menu.getAttribute('role')).toBe('menu');
    expect(document.querySelector('[data-toolbar-nav-list]')).not.toBeNull();

    downstairsButton.click();
    await waitForNavigation();

    const app = document.querySelector('nodel-app') as HTMLElement;
    const overviewPage = document.querySelector('nodel-page[title="Overview"]') as HTMLElement;
    const areasPage = document.querySelector('nodel-page[title="Areas"]') as HTMLElement;
    const downstairsPage = document.querySelector('nodel-page[title="Downstairs"]') as HTMLElement;

    expect(app.dataset.activePage).toBe('Downstairs');
    expect(window.location.hash).toBe('#Downstairs');
    expect(overviewPage.hidden).toBe(true);
    expect(areasPage.hidden).toBe(false);
    expect(downstairsPage.hidden).toBe(false);
  });

  it('encodes unpaired page and group navigation IDs without throwing', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-toolbar></nodel-toolbar>
        <nodel-page nav-id="group\ud800" title="Group \ud800">
          <nodel-page nav-id="page\udc00" title="Page \udc00"><nodel-text>Page</nodel-text></nodel-page>
        </nodel-page>
      </nodel-app>
    `;
    await waitForNavigation();

    expect(document.querySelector('[data-nav-group-id]')?.textContent).toContain('Group \ud800');
    const pageButton = document.querySelector('[data-nav-page-id]') as HTMLButtonElement;
    expect(pageButton.textContent).toContain('Page \udc00');
    expect(() => pageButton.click()).not.toThrow();
    await waitForNavigation();
    expect(window.location.hash).toBe('#page%EF%BF%BD');
  });
});
