const restartMock = vi.hoisted(() => ({
  isNodePage: vi.fn(),
  listener: null as null | ((detail: { previousTimestamp: string | null; timestamp: string }) => void),
  eventListener: null as null | ((event: any) => void),
  dispose: vi.fn(),
  pageOwnerRelease: vi.fn(),
  acquireNodeRestartPageOwner: vi.fn(() => ({ release: restartMock.pageOwnerRelease })),
  completeNodeRestartExpectation: vi.fn(() => true),
  watchNodeRestart: vi.fn((listener: (detail: { previousTimestamp: string | null; timestamp: string }) => void, eventListener?: (event: any) => void) => {
    restartMock.listener = listener;
    restartMock.eventListener = eventListener ?? null;
    return { dispose: restartMock.dispose };
  })
}));

const sourceMock = vi.hoisted(() => ({
  refreshNodeActivity: vi.fn(),
  refreshNodeConsole: vi.fn(async () => undefined),
  refreshNodeActivityForRestart: vi.fn(async (): Promise<any> => ({ status: 'verified' })),
  refreshNodeConsoleForRestart: vi.fn(async (): Promise<any> => ({ status: 'verified' })),
  resetNodeConsoleCursor: vi.fn()
}));

vi.mock('../src/data/node-restart-source', () => ({
  isNodePage: restartMock.isNodePage,
  watchNodeRestart: restartMock.watchNodeRestart,
  acquireNodeRestartPageOwner: restartMock.acquireNodeRestartPageOwner,
  completeNodeRestartExpectation: restartMock.completeNodeRestartExpectation
}));

vi.mock('../src/data/node-activity-source', () => ({
  refreshNodeActivity: sourceMock.refreshNodeActivity,
  refreshNodeActivityForRestart: sourceMock.refreshNodeActivityForRestart
}));

vi.mock('../src/data/node-console-source', () => ({
  refreshNodeConsole: sourceMock.refreshNodeConsole,
  refreshNodeConsoleForRestart: sourceMock.refreshNodeConsoleForRestart,
  resetNodeConsoleCursor: sourceMock.resetNodeConsoleCursor
}));

import { flush, waitFor } from './helpers';
import '../src/components/nodel-app';

describe('nodel-app restart coordination', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    restartMock.isNodePage.mockReset().mockReturnValue(true);
    restartMock.watchNodeRestart.mockClear();
    restartMock.dispose.mockClear();
    restartMock.pageOwnerRelease.mockClear();
    restartMock.acquireNodeRestartPageOwner.mockClear();
    restartMock.listener = null;
    restartMock.eventListener = null;
    restartMock.completeNodeRestartExpectation.mockClear().mockReturnValue(true);
    sourceMock.refreshNodeActivity.mockClear();
    sourceMock.refreshNodeConsole.mockClear();
    sourceMock.refreshNodeActivityForRestart.mockClear().mockResolvedValue({ status: 'verified' });
    sourceMock.refreshNodeConsoleForRestart.mockClear().mockResolvedValue({ status: 'verified' });
    sourceMock.resetNodeConsoleCursor.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('starts on node pages, dispatches restart events, and refreshes v2 children', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Activity">
          <nodel-description></nodel-description>
          <nodel-actsig></nodel-actsig>
          <nodel-editor></nodel-editor>
        </nodel-page>
      </nodel-app>
    `;
    await customElements.whenDefined('nodel-app');
    const app = document.querySelector('nodel-app')!;
    const detail = { previousTimestamp: 'start-1', timestamp: 'start-2' };
    const restarted = vi.fn();
    const refreshes = Array.from(app.querySelectorAll<HTMLElement>('nodel-description,nodel-actsig,nodel-editor')).map((element) => {
      const refresh = vi.fn(async () => ({ status: 'verified' as const }));
      Object.assign(element, { refreshAfterRestart: refresh });
      return refresh;
    });
    app.addEventListener('nodel-node-restarted', restarted);

    restartMock.listener?.(detail);

    expect(document.body.textContent).toContain('Node restarted. Refreshing view...');

    await waitFor(() => sourceMock.refreshNodeConsoleForRestart.mock.calls.length === 1);

    expect(restarted).toHaveBeenCalledWith(expect.objectContaining({ detail }));
    for (const refresh of refreshes) {
      expect(refresh).toHaveBeenCalledTimes(1);
    }
    expect(sourceMock.resetNodeConsoleCursor).toHaveBeenCalledTimes(1);
    expect(sourceMock.refreshNodeConsoleForRestart).toHaveBeenCalledTimes(1);
    expect(sourceMock.refreshNodeActivityForRestart).toHaveBeenCalledTimes(1);
    expect(sourceMock.refreshNodeConsoleForRestart).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    expect(sourceMock.refreshNodeActivityForRestart).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    expect(document.body.textContent).toContain('Node reloaded. View is up to date.');
  });

  it('shows the restart toast and dispatches before synchronously starting child refreshes', async () => {
    document.body.innerHTML = '<nodel-app><nodel-page title="Activity"><nodel-description></nodel-description></nodel-page></nodel-app>';
    await customElements.whenDefined('nodel-app');
    const app = document.querySelector('nodel-app')!;
    const order: string[] = [];
    app.addEventListener('nodel-node-restarted', () => order.push('event'));
    Object.assign(app.querySelector('nodel-description')!, {
      refreshAfterRestart: () => {
        expect(document.body.textContent).toContain('Node restarted. Refreshing view...');
        order.push('child');
        return { status: 'verified' as const };
      }
    });

    restartMock.listener?.({ previousTimestamp: 'start-1', timestamp: 'start-2' });

    expect(order).toEqual(['event', 'child']);
    await waitFor(() => sourceMock.refreshNodeConsoleForRestart.mock.calls.length === 1);
  });

  it('shows a warning toast when a restart refresh partly fails', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Activity">
          <nodel-description></nodel-description>
        </nodel-page>
      </nodel-app>
    `;
    await customElements.whenDefined('nodel-app');
    const app = document.querySelector('nodel-app')!;
    const description = app.querySelector<HTMLElement>('nodel-description')!;
    Object.assign(description, { refreshAfterRestart: vi.fn(async () => Promise.reject(new Error('Refresh failed'))) });

    restartMock.listener?.({ previousTimestamp: 'start-1', timestamp: 'start-2' });

    await waitFor(() => document.body.textContent?.includes('Node reloaded, but view verification failed.'));

    const toast = document.querySelector<HTMLElement>('.nodel-toast')!;
    expect(toast.className).toContain('nodel-toast-warning');
    expect(document.body.textContent).toContain('Description: Refresh failed');
  });

  it('shows app-level toasts for save and error events', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Config">
          <div data-event-source></div>
        </nodel-page>
      </nodel-app>
    `;
    await customElements.whenDefined('nodel-app');
    const source = document.querySelector<HTMLElement>('[data-event-source]')!;

    source.dispatchEvent(new CustomEvent('nodel-params-saved', { bubbles: true }));
    expect(document.body.textContent).toContain('Parameters saved');

    source.dispatchEvent(new CustomEvent('nodel-bindings-saved', { bubbles: true }));
    expect(document.body.textContent).toContain('Bindings saved');

    source.dispatchEvent(new CustomEvent('nodel-editor-file-saved', {
      bubbles: true,
      detail: { path: 'script.py' }
    }));
    expect(document.body.textContent).toContain('script.py saved. Waiting for node reload...');
    expect(document.body.textContent).toContain('script.py');

    source.dispatchEvent(new CustomEvent('nodel-params-error', {
      bubbles: true,
      detail: { error: 'Save failed' }
    }));
    expect(document.body.textContent).toContain('Failed to save parameters');
    expect(document.body.textContent).toContain('Save failed');

    source.dispatchEvent(new CustomEvent('nodel-add-node-error', {
      bubbles: true,
      detail: { error: 'A node with that name already exists.' }
    }));
    expect(document.body.textContent).toContain('Failed to add node');
    expect(document.body.textContent).toContain('A node with that name already exists.');
  });

  it('does not start the restart watcher outside node pages', async () => {
    restartMock.isNodePage.mockReturnValue(false);
    document.body.innerHTML = '<nodel-app></nodel-app>';
    await customElements.whenDefined('nodel-app');

    expect(restartMock.watchNodeRestart).not.toHaveBeenCalled();
  });

  it('reports expected pending, timeout, and verified dirty-preserved states', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Activity">
          <nodel-editor></nodel-editor>
        </nodel-page>
      </nodel-app>
    `;
    await customElements.whenDefined('nodel-app');
    const editor = document.querySelector('nodel-editor')!;
    Object.assign(editor, { refreshAfterRestart: vi.fn(async () => ({ status: 'dirty-preserved', detail: 'local edits' })) });
    const expectation = {
      id: 4,
      generation: 4,
      baselineTimestamp: 'start-1',
      state: 'pending'
    };

    restartMock.eventListener?.({ type: 'expected-pending', expectation });
    expect(document.body.textContent).toContain('script.py saved. Waiting for node reload...');

    restartMock.eventListener?.({ type: 'expected-timeout', expectation: { ...expectation, state: 'unconfirmed' } });
    expect(document.body.textContent).toContain('Reload was not confirmed within 30 seconds.');
    await waitFor(() => sourceMock.refreshNodeConsoleForRestart.mock.calls.length === 1);
    await waitFor(() => sourceMock.refreshNodeActivityForRestart.mock.calls.length === 1);

    const detail = { previousTimestamp: 'start-1', timestamp: 'start-2' };
    restartMock.eventListener?.({
      type: 'expected-confirmed',
      expectation: { ...expectation, state: 'refreshing' },
      detail
    });
    await waitFor(() => document.body.textContent?.includes('unsaved editor changes were preserved.') ?? false);
    expect(restartMock.completeNodeRestartExpectation).toHaveBeenCalledWith(4, expect.objectContaining({ status: 'dirty-preserved' }));
    expect(document.body.textContent).not.toContain('View is up to date.');
  });

  it('does not claim an up-to-date view for explicit false or conflict results', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Activity">
          <nodel-description></nodel-description>
        </nodel-page>
      </nodel-app>
    `;
    await customElements.whenDefined('nodel-app');
    const description = document.querySelector<HTMLElement>('nodel-description')!;
    Object.assign(description, { refreshAfterRestart: vi.fn(async () => false) });
    restartMock.eventListener?.({
      type: 'expected-confirmed',
      expectation: { id: 5, generation: 5, baselineTimestamp: 'start-1', state: 'refreshing' },
      detail: { previousTimestamp: 'start-1', timestamp: 'start-2' }
    });
    await waitFor(() => document.body.textContent?.includes('view verification failed') ?? false);
    expect(document.body.textContent).not.toContain('View is up to date.');

    document.body.innerHTML = '';
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Activity">
          <nodel-description></nodel-description>
        </nodel-page>
      </nodel-app>
    `;
    await customElements.whenDefined('nodel-app');
    const secondDescription = document.querySelector<HTMLElement>('nodel-description')!;
    Object.assign(secondDescription, { refreshAfterRestart: vi.fn(async () => ({ status: 'conflict' })) });
    restartMock.eventListener?.({
      type: 'expected-confirmed',
      expectation: { id: 6, generation: 6, baselineTimestamp: 'start-1', state: 'refreshing' },
      detail: { previousTimestamp: 'start-1', timestamp: 'start-2' }
    });
    await waitFor(() => document.body.textContent?.includes('local editor content could not be reconciled') ?? false);
    expect(document.body.textContent).not.toContain('View is up to date.');
  });

  it('treats a non-reporting restart-aware child as verification failure', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Activity">
          <nodel-description></nodel-description>
        </nodel-page>
      </nodel-app>
    `;
    await customElements.whenDefined('nodel-app');
    Object.assign(document.querySelector('nodel-description')!, {
      refreshAfterRestart: vi.fn(async () => undefined)
    });

    restartMock.eventListener?.({
      type: 'expected-confirmed',
      expectation: { id: 7, generation: 7, baselineTimestamp: 'start-1', state: 'refreshing' },
      detail: { previousTimestamp: 'start-1', timestamp: 'start-2' }
    });

    await waitFor(() => document.body.textContent?.includes('view verification failed') ?? false);
    expect(document.body.textContent).not.toContain('View is up to date.');
  });

  it('reports diagnostic refresh failures without failing a verified view refresh', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Activity">
          <nodel-description></nodel-description>
        </nodel-page>
      </nodel-app>
    `;
    await customElements.whenDefined('nodel-app');
    Object.assign(document.querySelector('nodel-description')!, {
      refreshAfterRestart: vi.fn(async () => ({ status: 'verified' as const }))
    });
    sourceMock.refreshNodeConsoleForRestart.mockResolvedValueOnce({ status: 'failed', detail: 'Console unavailable' });

    restartMock.eventListener?.({
      type: 'expected-confirmed',
      expectation: { id: 9, generation: 9, baselineTimestamp: 'start-1', state: 'refreshing' },
      detail: { previousTimestamp: 'start-1', timestamp: 'start-2' }
    });

    await waitFor(() => document.body.textContent?.includes('diagnostics need refresh') ?? false);
    expect(restartMock.completeNodeRestartExpectation).toHaveBeenCalledWith(9, expect.objectContaining({ status: 'verified' }));
    expect(document.body.textContent).toContain('Console: Console unavailable');
  });

  it('warns for non-success diagnostics and treats absent diagnostic sources as successful', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Activity">
          <nodel-description></nodel-description>
        </nodel-page>
      </nodel-app>
    `;
    await customElements.whenDefined('nodel-app');
    Object.assign(document.querySelector('nodel-description')!, {
      refreshAfterRestart: vi.fn(async () => ({ status: 'verified' as const }))
    });

    sourceMock.refreshNodeConsoleForRestart.mockResolvedValueOnce({ status: 'skipped' });
    restartMock.eventListener?.({
      type: 'expected-confirmed',
      expectation: { id: 10, generation: 10, baselineTimestamp: 'start-1', state: 'refreshing' },
      detail: { previousTimestamp: 'start-1', timestamp: 'start-2' }
    });
    await waitFor(() => document.body.textContent?.includes('diagnostics need refresh') ?? false);
    expect(restartMock.completeNodeRestartExpectation).toHaveBeenCalledWith(10, expect.objectContaining({ status: 'verified' }));
    expect(document.body.textContent).toContain('Console: skipped');

    document.body.innerHTML = '';
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Activity">
          <nodel-description></nodel-description>
        </nodel-page>
      </nodel-app>
    `;
    await customElements.whenDefined('nodel-app');
    Object.assign(document.querySelector('nodel-description')!, {
      refreshAfterRestart: vi.fn(async () => ({ status: 'verified' as const }))
    });
    sourceMock.refreshNodeConsoleForRestart.mockResolvedValueOnce({ status: 'absent' });
    sourceMock.refreshNodeActivityForRestart.mockResolvedValueOnce({ status: 'absent' });
    restartMock.eventListener?.({
      type: 'expected-confirmed',
      expectation: { id: 11, generation: 11, baselineTimestamp: 'start-1', state: 'refreshing' },
      detail: { previousTimestamp: 'start-1', timestamp: 'start-2' }
    });
    await waitFor(() => document.body.textContent?.includes('View is up to date.') ?? false);
    expect(restartMock.completeNodeRestartExpectation).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'verified' }));
  });

  it('does not refresh console or activity after a stale expectation is superseded', async () => {
    let resolveRefresh!: () => void;
    const refreshPromise = new Promise<{ status: 'verified' }>((resolve) => {
      resolveRefresh = () => resolve({ status: 'verified' });
    });
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Activity">
          <nodel-description></nodel-description>
        </nodel-page>
      </nodel-app>
    `;
    await customElements.whenDefined('nodel-app');
    const refresh = vi.fn(() => refreshPromise);
    Object.assign(document.querySelector('nodel-description')!, { refreshAfterRestart: refresh });

    const expectation = { id: 8, generation: 8, baselineTimestamp: 'start-1', state: 'refreshing' as const };
    restartMock.eventListener?.({
      type: 'expected-confirmed',
      expectation,
      detail: { previousTimestamp: 'start-1', timestamp: 'start-2' }
    });
    await waitFor(() => refresh.mock.calls.length === 1);
    restartMock.eventListener?.({ type: 'expected-superseded', expectation });
    resolveRefresh();
    await flush();

    expect(sourceMock.refreshNodeConsoleForRestart).not.toHaveBeenCalled();
    expect(sourceMock.refreshNodeActivityForRestart).not.toHaveBeenCalled();
    expect(restartMock.completeNodeRestartExpectation).not.toHaveBeenCalled();
  });

  it('invalidates a delayed manual restart refresh when script reload becomes pending', async () => {
    let resolveRefresh!: () => void;
    const refreshPromise = new Promise<{ status: 'verified' }>((resolve) => {
      resolveRefresh = () => resolve({ status: 'verified' });
    });
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Activity">
          <nodel-description></nodel-description>
        </nodel-page>
      </nodel-app>
    `;
    await customElements.whenDefined('nodel-app');
    const refresh = vi.fn(() => refreshPromise);
    Object.assign(document.querySelector('nodel-description')!, { refreshAfterRestart: refresh });

    restartMock.listener?.({ previousTimestamp: 'start-1', timestamp: 'start-2' });
    await waitFor(() => refresh.mock.calls.length === 1);
    restartMock.eventListener?.({
      type: 'expected-pending',
      expectation: { id: 12, generation: 12, baselineTimestamp: 'start-2', state: 'pending' }
    });
    resolveRefresh();
    await flush();

    expect(sourceMock.refreshNodeConsoleForRestart).not.toHaveBeenCalled();
    expect(sourceMock.refreshNodeActivityForRestart).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('script.py saved. Waiting for node reload...');
    expect(document.body.textContent).not.toContain('View is up to date.');
  });
});
