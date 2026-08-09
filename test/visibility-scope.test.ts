import { claimNodelPageActive, observeNodelVisibility } from '../src/data/visibility-scope';
import { reportConnectivityFailure, reportConnectivityResponse } from '../src/data/connectivity';
import { waitFor } from './helpers';

describe('visibility scope', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('notifies observers when connectivity changes', async () => {
    let online = true;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const host = document.createElement('div');
    document.body.append(host);
    const states: boolean[] = [];
    const dispose = observeNodelVisibility(host, (visible) => states.push(visible));
    expect(states).toEqual([true]);

    online = false;
    window.dispatchEvent(new Event('offline'));
    await waitFor(() => states.at(-1) === false);
    online = true;
    window.dispatchEvent(new Event('online'));
    await waitFor(() => states.at(-1) === true);

    expect(states).toEqual([true, false, true]);
    dispose();
    vi.unstubAllGlobals();
  });

  it('pauses visibility for connectivity-confirmed network outages', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network unavailable');
    }));
    const host = document.createElement('div');
    document.body.append(host);
    const states: boolean[] = [];
    const dispose = observeNodelVisibility(host, (visible) => states.push(visible));

    reportConnectivityFailure('/REST', new TypeError('request failed'));
    await waitFor(() => states.at(-1) === false);
    reportConnectivityResponse('/REST');
    await waitFor(() => states.at(-1) === true);

    expect(states).toEqual([true, false, true]);
    dispose();
    vi.unstubAllGlobals();
  });

  it('treats app-managed pages without active as inactive before navigation', async () => {
    const app = document.createElement('nodel-app');
    const page = document.createElement('nodel-page');
    const host = document.createElement('div');
    page.append(host);
    app.append(page);
    document.body.append(app);
    const states: boolean[] = [];

    const dispose = observeNodelVisibility(host, (visible) => states.push(visible));

    expect(states).toEqual([false]);
    page.setAttribute('active', '');
    claimNodelPageActive(page, app);
    await waitFor(() => states.at(-1) === true);
    expect(states).toEqual([false, true]);

    dispose();
  });

  it('requires every nested app-managed page to be active', async () => {
    const app = document.createElement('nodel-app');
    const group = document.createElement('nodel-page');
    const leaf = document.createElement('nodel-page');
    const host = document.createElement('div');
    leaf.append(host);
    group.append(leaf);
    app.append(group);
    document.body.append(app);
    const states: boolean[] = [];
    const dispose = observeNodelVisibility(host, (visible) => states.push(visible));

    leaf.setAttribute('active', '');
    claimNodelPageActive(leaf, app);
    await Promise.resolve();
    expect(states).toEqual([false]);
    group.setAttribute('active', '');
    claimNodelPageActive(group, app);
    await waitFor(() => states.at(-1) === true);
    expect(states).toEqual([false, true]);
    group.setAttribute('hidden', '');
    await waitFor(() => states.at(-1) === false);
    expect(states).toEqual([false, true, false]);
    group.removeAttribute('hidden');
    await waitFor(() => states.at(-1) === true);
    expect(states).toEqual([false, true, false, true]);

    dispose();
  });

  it('keeps standalone pages active unless explicitly hidden', async () => {
    const page = document.createElement('nodel-page');
    const host = document.createElement('div');
    page.append(host);
    document.body.append(page);
    const states: boolean[] = [];
    const dispose = observeNodelVisibility(host, (visible) => states.push(visible));

    expect(states).toEqual([true]);
    page.setAttribute('active', '');
    expect(states).toEqual([true]);
    page.setAttribute('hidden', '');
    await waitFor(() => states.at(-1) === false);
    expect(states).toEqual([true, false]);

    dispose();
  });

  it('does not trust a preserved active page attribute after moving between apps', async () => {
    const sourceApp = document.createElement('nodel-app');
    const destinationApp = document.createElement('nodel-app');
    const page = document.createElement('nodel-page');
    const host = document.createElement('div');
    page.setAttribute('active', '');
    page.append(host);
    sourceApp.append(page);
    document.body.append(sourceApp, destinationApp);
    claimNodelPageActive(page, sourceApp);

    const states: boolean[] = [];
    const dispose = observeNodelVisibility(host, (visible) => states.push(visible));
    expect(states).toEqual([true]);

    destinationApp.append(page);
    await waitFor(() => states.at(-1) === false);
    expect(states).toEqual([true, false]);

    dispose();
  });

  it('allows a page-only observer to ignore document and connectivity suspension', async () => {
    let online = true;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    const documentHidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const host = document.createElement('div');
    const app = document.createElement('nodel-app');
    const page = document.createElement('nodel-page');
    page.setAttribute('active', '');
    page.append(host);
    app.append(page);
    claimNodelPageActive(page, app);
    document.body.append(app);
    const states: boolean[] = [];
    const dispose = observeNodelVisibility(host, (visible) => states.push(visible), {
      suspendOnDocumentHidden: false,
      suspendOnConnectivity: false
    });

    documentHidden.mockReturnValue(true);
    online = false;
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('offline'));
    await Promise.resolve();
    expect(states).toEqual([true]);

    page.removeAttribute('active');
    await waitFor(() => states.at(-1) === false);
    page.setAttribute('active', '');
    claimNodelPageActive(page, app);
    await waitFor(() => states.at(-1) === true);

    dispose();
    vi.unstubAllGlobals();
  });
});
