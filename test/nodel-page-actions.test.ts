import { installControlRuntime } from '../src/data/control-runtime';
import '../src/components/nodel-app';
import '../src/components/nodel-page';
import '../src/components/nodel-toolbar';
import { flush, waitFor } from './helpers';

describe('nodel-page activation actions', () => {
  const callAction = vi.fn();
  let restoreRuntime: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState(undefined, '', '/');
    callAction.mockReset().mockResolvedValue(undefined);
    restoreRuntime = installControlRuntime({
      callAction,
      subscribeSignals: () => ({ dispose() {} })
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    restoreRuntime?.();
    restoreRuntime = null;
  });

  function renderFixture() {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-toolbar></nodel-toolbar>
        <nodel-page title="Overview" action="OpenOverview"></nodel-page>
        <nodel-page title="Details" action="OpenDetails"></nodel-page>
      </nodel-app>
    `;
  }

  function deferred() {
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((_resolve, nextReject) => {
      reject = nextReject;
    });
    return { promise, reject };
  }

  it('invokes the initial page once with the V1 empty-object payload', async () => {
    renderFixture();
    await waitFor(() => callAction.mock.calls.length === 1);

    expect(callAction.mock.calls[0].slice(0, 2)).toEqual(['OpenOverview', {}]);
  });

  it('activates the startup hash page and later hash navigation', async () => {
    window.history.replaceState(undefined, '', '/#Details');
    renderFixture();
    await waitFor(() => callAction.mock.calls.length === 1);
    expect(callAction.mock.calls.at(-1)?.slice(0, 2)).toEqual(['OpenDetails', {}]);

    window.history.replaceState(undefined, '', '/#Overview');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => callAction.mock.calls.length === 2);
    expect(callAction.mock.calls.at(-1)?.slice(0, 2)).toEqual(['OpenOverview', {}]);
  });

  it('invokes on explicit selection and explicit reselection', async () => {
    renderFixture();
    await waitFor(() => callAction.mock.calls.length === 1);
    callAction.mockClear();
    document.querySelector<HTMLButtonElement>('[data-nav-page-id="Details"]')?.click();
    await waitFor(() => callAction.mock.calls.length === 1);
    document.querySelector<HTMLButtonElement>('[data-nav-page-id="Details"]')?.click();
    await waitFor(() => callAction.mock.calls.length === 2);

    expect(callAction.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['OpenDetails', {}],
      ['OpenDetails', {}]
    ]);
  });

  it('does not reactivate when a mutation rediscovers the active page', async () => {
    renderFixture();
    await waitFor(() => callAction.mock.calls.length === 1);
    document.querySelector('nodel-app')?.append(document.createElement('div'));
    await flush();
    await flush();

    expect(callAction).toHaveBeenCalledTimes(1);
  });

  it('does not reactivate merely because the same app reconnects', async () => {
    renderFixture();
    await waitFor(() => callAction.mock.calls.length === 1);
    const app = document.querySelector('nodel-app')!;
    app.remove();
    document.body.append(app);
    await flush();
    await flush();

    expect(callAction).toHaveBeenCalledTimes(1);
  });

  it('activates a valid hash selected while the app was disconnected', async () => {
    renderFixture();
    await waitFor(() => callAction.mock.calls.length === 1);
    const app = document.querySelector('nodel-app')!;
    app.remove();
    window.history.replaceState(undefined, '', '/#Details');
    document.body.append(app);
    await waitFor(() => callAction.mock.calls.length === 2);

    expect(callAction.mock.calls.at(-1)?.slice(0, 2)).toEqual(['OpenDetails', {}]);
    expect(app.getAttribute('data-active-page')).toBe('Details');
  });

  it('does not report stale action failures after disconnect', async () => {
    const pending = deferred();
    callAction.mockReturnValue(pending.promise);
    renderFixture();
    await waitFor(() => callAction.mock.calls.length === 1);
    const app = document.querySelector('nodel-app')!;
    app.remove();
    document.body.append(app);
    pending.reject(new Error('stale failure'));
    await flush();
    await flush();

    expect(document.querySelector('.nodel-toast-message')).toBeNull();
    expect(callAction).toHaveBeenCalledTimes(1);
  });

  it('does not start later activation bindings after the page disconnects', async () => {
    let resolveFirst!: () => void;
    callAction.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }));
    document.body.innerHTML = '<nodel-page actions="Prepare; Present"></nodel-page>';
    const page = document.querySelector<HTMLElement & { activate(): Promise<void> }>('nodel-page')!;
    const activation = page.activate();
    await waitFor(() => callAction.mock.calls.length === 1);

    page.remove();
    resolveFirst();
    await activation;

    expect(callAction).toHaveBeenCalledTimes(1);
  });

  it('runs multiple actions with a typed argument payload', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Commands" actions="Prepare; Present" arg='{"mode":"preview"}' arg-type="json"></nodel-page>
      </nodel-app>
    `;
    await waitFor(() => callAction.mock.calls.length === 2);

    expect(callAction.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['Prepare', { arg: { mode: 'preview' } }],
      ['Present', { arg: { mode: 'preview' } }]
    ]);
  });

  it('keeps navigation immediate and reports action failures through the toast host', async () => {
    callAction.mockImplementation((name: string) => name === 'OpenDetails' ? Promise.reject(new Error('controller unavailable')) : Promise.resolve());
    renderFixture();
    await waitFor(() => callAction.mock.calls.length === 1);
    document.querySelector<HTMLButtonElement>('[data-nav-page-id="Details"]')?.click();

    expect(document.querySelector('nodel-app')?.getAttribute('data-active-page')).toBe('Details');
    await waitFor(() => document.querySelector('.nodel-toast-message')?.textContent === 'Page action failed');
    expect(document.querySelector('.nodel-toast-detail')?.textContent).toContain('controller unavailable');
  });

  it('does nothing when a detached page is activated', async () => {
    const page = document.createElement('nodel-page') as HTMLElement & { activate(): Promise<void> };
    page.setAttribute('action', 'OpenDetached');

    await page.activate();

    expect(callAction).not.toHaveBeenCalled();
  });

  it('emits structured partial page action failures while retaining the toast', async () => {
    callAction
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Present failed'));
    document.body.innerHTML = '<nodel-page actions="Prepare; Present"></nodel-page>';
    const page = document.querySelector<HTMLElement & { activate(): Promise<void> }>('nodel-page')!;
    const error = vi.fn();
    const toast = vi.fn();
    page.addEventListener('nodel-page-action-error', error);
    page.addEventListener('nodel-toast', toast);

    await page.activate();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0].detail).toMatchObject({
      action: 'Prepare',
      phase: 'activate',
      results: [
        { action: 'Prepare', phase: 'activate', ok: true },
        { action: 'Present', phase: 'activate', ok: false, error: 'Present failed' }
      ],
      failures: [{ action: 'Present', phase: 'activate', ok: false, error: 'Present failed' }]
    });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0].detail.detail).toContain('Present failed');
  });
});
