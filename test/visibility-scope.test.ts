import { observeNodelVisibility } from '../src/data/visibility-scope';
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
});
