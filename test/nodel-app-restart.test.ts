const restartMock = vi.hoisted(() => ({
  isNodePage: vi.fn(),
  listener: null as null | ((detail: { previousTimestamp: string; timestamp: string }) => void),
  dispose: vi.fn(),
  watchNodeRestart: vi.fn((listener: (detail: { previousTimestamp: string; timestamp: string }) => void) => {
    restartMock.listener = listener;
    return { dispose: restartMock.dispose };
  })
}));

const sourceMock = vi.hoisted(() => ({
  refreshNodeActivity: vi.fn(),
  refreshNodeConsole: vi.fn(async () => undefined),
  resetNodeConsoleCursor: vi.fn()
}));

vi.mock('../src/data/node-restart-source', () => ({
  isNodePage: restartMock.isNodePage,
  watchNodeRestart: restartMock.watchNodeRestart
}));

vi.mock('../src/data/node-activity-source', () => ({
  refreshNodeActivity: sourceMock.refreshNodeActivity
}));

vi.mock('../src/data/node-console-source', () => ({
  refreshNodeConsole: sourceMock.refreshNodeConsole,
  resetNodeConsoleCursor: sourceMock.resetNodeConsoleCursor
}));

import { waitFor } from './helpers';
import '../src/components/nodel-app';

describe('nodel-app restart coordination', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    restartMock.isNodePage.mockReset().mockReturnValue(true);
    restartMock.watchNodeRestart.mockClear();
    restartMock.dispose.mockClear();
    restartMock.listener = null;
    sourceMock.refreshNodeActivity.mockClear();
    sourceMock.refreshNodeConsole.mockClear();
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
      const refresh = vi.fn(async () => undefined);
      Object.assign(element, { refreshAfterRestart: refresh });
      return refresh;
    });
    app.addEventListener('nodel-node-restarted', restarted);

    restartMock.listener?.(detail);

    expect(document.body.textContent).toContain('Node restarted. Refreshing view...');

    await waitFor(() => sourceMock.refreshNodeConsole.mock.calls.length === 1);

    expect(restarted).toHaveBeenCalledWith(expect.objectContaining({ detail }));
    for (const refresh of refreshes) {
      expect(refresh).toHaveBeenCalledTimes(1);
    }
    expect(sourceMock.resetNodeConsoleCursor).toHaveBeenCalledTimes(1);
    expect(sourceMock.refreshNodeConsole).toHaveBeenCalledTimes(1);
    expect(sourceMock.refreshNodeActivity).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('Node reloaded. View is up to date.');
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

    await waitFor(() => document.body.textContent?.includes('Node reloaded, but some sections failed to refresh.'));

    const toast = document.querySelector<HTMLElement>('.nodel-toast')!;
    expect(toast.className).toContain('nodel-toast-warning');
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
    expect(document.body.textContent).toContain('File saved');
    expect(document.body.textContent).toContain('script.py');

    source.dispatchEvent(new CustomEvent('nodel-params-error', {
      bubbles: true,
      detail: { error: 'Save failed' }
    }));
    expect(document.body.textContent).toContain('Failed to save parameters');
    expect(document.body.textContent).toContain('Save failed');
  });

  it('does not start the restart watcher outside node pages', async () => {
    restartMock.isNodePage.mockReturnValue(false);
    document.body.innerHTML = '<nodel-app></nodel-app>';
    await customElements.whenDefined('nodel-app');

    expect(restartMock.watchNodeRestart).not.toHaveBeenCalled();
  });
});
