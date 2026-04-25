import '../src/components/nodel-app';
import '../src/components/nodel-toolbar';
import '../src/components/nodel-page';
import '../src/components/nodel-row';
import '../src/components/nodel-column';
import '../src/components/nodel-text';

async function waitForNavigation() {
  await customElements.whenDefined('nodel-app');
  await customElements.whenDefined('nodel-toolbar');
  await customElements.whenDefined('nodel-page');
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function renderNavigationFixture() {
  document.body.innerHTML = `
    <nodel-app theme="default" title="Nodel">
      <nodel-toolbar title="Nodel" icon-src="./v2/img/logo.png" icon-alt="Nodel"></nodel-toolbar>

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

  it('selects submenu pages without Bootstrap or jQuery', async () => {
    renderNavigationFixture();
    await waitForNavigation();

    const groupButton = document.querySelector('[data-nav-group-id="Areas"]') as HTMLButtonElement;
    groupButton.click();
    await waitForNavigation();

    const menu = document.querySelector('#nodel-menu-Areas') as HTMLElement;
    const downstairsButton = document.querySelector('[data-nav-page-id="Downstairs"]') as HTMLButtonElement;
    expect(menu.hidden).toBe(false);

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
});
