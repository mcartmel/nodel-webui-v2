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

    await waitFor(() => sourceMock.refreshNodeConsole.mock.calls.length === 1);

    expect(restarted).toHaveBeenCalledWith(expect.objectContaining({ detail }));
    for (const refresh of refreshes) {
      expect(refresh).toHaveBeenCalledTimes(1);
    }
    expect(sourceMock.resetNodeConsoleCursor).toHaveBeenCalledTimes(1);
    expect(sourceMock.refreshNodeConsole).toHaveBeenCalledTimes(1);
    expect(sourceMock.refreshNodeActivity).toHaveBeenCalledTimes(1);
  });

  it('does not start the restart watcher outside node pages', async () => {
    restartMock.isNodePage.mockReturnValue(false);
    document.body.innerHTML = '<nodel-app></nodel-app>';
    await customElements.whenDefined('nodel-app');

    expect(restartMock.watchNodeRestart).not.toHaveBeenCalled();
  });
});
