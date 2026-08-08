import { flush, waitFor } from './helpers';
import type * as nodelHostClient from '../src/api/nodel-host-client';

const integrationMock = vi.hoisted(() => {
  let restartWaiter: { resolve: (value: { timestamp: string | null }) => void } | null = null;
  let baselineWaiter: { resolve: (value: { timestamp: string | null }) => void } | null = null;
  let saveWaiter: { resolve: (value: unknown) => void } | null = null;
  return {
    files: [{ path: 'script.py', modified: 'before', size: 16 }],
    content: 'print("initial")',
    delayedRestart: false,
    restartFailures: 0,
    holdBaseline: false,
    failNextSave: false,
    saveCalls: [] as Array<{ path: string; content: BodyInit }>,
    getNodeDetails: vi.fn(async () => ({ name: 'Integration Node', desc: '' })),
    getNodeRestartStatus: vi.fn(async (options: { timestamp?: string | null }) => {
      if (options.timestamp === null && integrationMock.holdBaseline) {
        return new Promise<{ timestamp: string | null }>((resolve) => {
          baselineWaiter = { resolve };
        });
      }
      if (options.timestamp === 'start-1' && integrationMock.restartFailures > 0) {
        integrationMock.restartFailures -= 1;
        throw new Error('hasRestarted temporarily unavailable');
      }
      if (options.timestamp === 'start-1' && integrationMock.delayedRestart) {
        return new Promise<{ timestamp: string | null }>((resolve) => {
          restartWaiter = { resolve };
        });
      }
      return { timestamp: 'start-1' };
    }),
    listNodeFiles: vi.fn(async () => integrationMock.files),
    getNodeFileContents: vi.fn(async () => integrationMock.content),
    saveNodeFile: vi.fn(async (path: string, content: BodyInit) => {
      integrationMock.saveCalls.push({ path, content });
      if (integrationMock.failNextSave) {
        integrationMock.failNextSave = false;
        integrationMock.content = 'print("remote changed after lost response")';
        throw new Error('script save response lost');
      }
      await new Promise<unknown>((resolve) => {
        saveWaiter = { resolve };
      });
      integrationMock.content = String(content);
      return {};
    }),
    getNodeConsoleLogs: vi.fn(async () => []),
    getNodeActivity: vi.fn(async () => []),
    releaseSave() {
      saveWaiter?.resolve({});
      saveWaiter = null;
    },
    confirmRestart() {
      restartWaiter?.resolve({ timestamp: 'start-2' });
      restartWaiter = null;
    },
    restartPollPending() {
      return restartWaiter !== null;
    },
    baselinePending() {
      return baselineWaiter !== null;
    },
    resolveBaseline() {
      baselineWaiter?.resolve({ timestamp: 'start-1' });
      baselineWaiter = null;
    }
  };
});

vi.mock('../src/api/nodel-host-client', async () => {
  const actual = await vi.importActual<typeof nodelHostClient>('../src/api/nodel-host-client');
  return {
    ...actual,
    getNodeDetails: integrationMock.getNodeDetails,
    getNodeRestartStatus: integrationMock.getNodeRestartStatus,
    listNodeFiles: integrationMock.listNodeFiles,
    getNodeFileContents: integrationMock.getNodeFileContents,
    saveNodeFile: integrationMock.saveNodeFile,
    getNodeConsoleLogs: integrationMock.getNodeConsoleLogs,
    getNodeActivity: integrationMock.getNodeActivity
  };
});

import '../src/components/nodel-app';
import '../src/components/nodel-editor';

describe('script save and reload cross-layer integration', () => {
  let rangeRects: PropertyDescriptor | undefined;

  beforeEach(() => {
    rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
    document.body.innerHTML = '';
    window.history.replaceState(undefined, '', '/nodes/IntegrationNode/nodel.html');
    integrationMock.files = [{ path: 'script.py', modified: 'before', size: 16 }];
    integrationMock.content = 'print("initial")';
    integrationMock.delayedRestart = false;
    integrationMock.restartFailures = 0;
    integrationMock.holdBaseline = false;
    integrationMock.failNextSave = false;
    integrationMock.saveCalls.length = 0;
    integrationMock.getNodeDetails.mockClear();
    integrationMock.getNodeRestartStatus.mockClear();
    integrationMock.listNodeFiles.mockClear();
    integrationMock.getNodeFileContents.mockClear();
    integrationMock.saveNodeFile.mockClear();
    integrationMock.getNodeConsoleLogs.mockClear();
    integrationMock.getNodeActivity.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    if (rangeRects) {
      Object.defineProperty(Range.prototype, 'getClientRects', rangeRects);
    } else {
      Reflect.deleteProperty(Range.prototype, 'getClientRects');
    }
  });

  it('blocks a second save, preserves immediate typing, and reconciles after delayed restart', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Node">
          <nodel-editor></nodel-editor>
        </nodel-page>
      </nodel-app>
    `;
    await customElements.whenDefined('nodel-editor');
    const app = document.querySelector('nodel-app')!;
    const editor = document.querySelector('nodel-editor') as any;
    await waitFor(() => Boolean(editor.querySelector('[data-editor-file-picker]')), { attempts: 200 });
    await waitFor(() => Boolean(editor.editor), { attempts: 200 });
    expect(editor.editor).toBeTruthy();

    editor.setEditorDocument('print("saved")', 'script.py');
    editor.handleEditorChange('print("saved")');
    integrationMock.delayedRestart = true;
    void editor.saveSelectedFile();
    await waitFor(() => integrationMock.saveCalls.length === 1);

    editor.setEditorDocument('print("typed immediately")', 'script.py');
    editor.handleEditorChange('print("typed immediately")');
    void editor.saveSelectedFile();
    expect(integrationMock.saveCalls).toHaveLength(1);

    integrationMock.files = [{ path: 'script.py', modified: 'after', size: 14 }];
    await waitFor(() => integrationMock.restartPollPending());
    integrationMock.confirmRestart();
    integrationMock.releaseSave();
    await waitFor(() => app.textContent?.includes('unsaved editor changes were preserved.') ?? false);

    expect(integrationMock.saveCalls).toHaveLength(1);
    expect(editor.editor.getDocument()).toBe('print("typed immediately")');
    expect(editor.state.dirty).toBe(true);
    expect(app.textContent).not.toContain('View is up to date.');
    expect(integrationMock.getNodeFileContents).toHaveBeenCalledWith(
      'script.py',
      expect.any(Object),
      1024 * 1024
    );
    await flush();
  });

  it('installs the saved clean baseline before a pre-commit timestamp confirms reload', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Node">
          <nodel-editor></nodel-editor>
        </nodel-page>
      </nodel-app>
    `;
    const app = document.querySelector('nodel-app')!;
    const editor = document.querySelector('nodel-editor') as any;
    await waitFor(() => Boolean(editor.querySelector('[data-editor-file-picker]')), { attempts: 200 });
    await waitFor(() => Boolean(editor.editor), { attempts: 200 });

    editor.setEditorDocument('print("saved clean")', 'script.py');
    editor.handleEditorChange('print("saved clean")');
    integrationMock.delayedRestart = true;
    void editor.saveSelectedFile();
    await waitFor(() => integrationMock.saveCalls.length === 1);
    await waitFor(() => integrationMock.restartPollPending());

    integrationMock.confirmRestart();
    integrationMock.releaseSave();
    await waitFor(() => app.textContent?.includes('View is up to date.') ?? false);

    expect(editor.editor.getDocument()).toBe('print("saved clean")');
    expect(editor.state.dirty).toBe(false);
    expect(app.textContent).not.toContain('could not be reconciled');
  });

  it('preserves local text after a lost save response and detects the resulting remote conflict', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Node">
          <nodel-editor></nodel-editor>
        </nodel-page>
      </nodel-app>
    `;
    const editor = document.querySelector('nodel-editor') as any;
    await waitFor(() => Boolean(editor.querySelector('[data-editor-file-picker]')), { attempts: 200 });
    await waitFor(() => Boolean(editor.editor), { attempts: 200 });

    editor.setEditorDocument('print("local unsaved")', 'script.py');
    editor.handleEditorChange('print("local unsaved")');
    integrationMock.failNextSave = true;
    void editor.saveSelectedFile();
    await waitFor(() => integrationMock.saveCalls.length === 1);
    await waitFor(() => editor.textContent?.includes('script save response lost') ?? false);

    expect(editor.editor.getDocument()).toBe('print("local unsaved")');
    expect(editor.state.dirty).toBe(true);
    void editor.saveSelectedFile();
    await waitFor(() => editor.textContent?.includes('changed on the node') ?? false);

    expect(integrationMock.saveCalls).toHaveLength(1);
    expect(editor.editor.getDocument()).toBe('print("local unsaved")');
  });

  it('times out, permits a clean corrective save, and honors cancel before confirmation', async () => {
    const source = await import('../src/data/node-restart-source');
    try {
      document.body.innerHTML = `
        <nodel-app>
          <nodel-page title="Node">
            <nodel-editor></nodel-editor>
          </nodel-page>
        </nodel-app>
      `;
      const editor = document.querySelector('nodel-editor') as any;
      await waitFor(() => Boolean(editor.querySelector('[data-editor-file-picker]')), { attempts: 200 });
      await waitFor(() => Boolean(editor.editor), { attempts: 200 });
      vi.useFakeTimers();

      editor.setEditorDocument('print("saved")', 'script.py');
      editor.handleEditorChange('print("saved")');
      void editor.saveSelectedFile();
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await Promise.resolve();
      }
      expect(integrationMock.saveCalls).toHaveLength(1);
      integrationMock.releaseSave();
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await Promise.resolve();
      }
      await vi.advanceTimersByTimeAsync(source.NODE_RESTART_EXPECTATION_TIMEOUT_MS);
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await Promise.resolve();
      }

      expect(editor.state.dirty).toBe(false);
      expect(document.body.textContent).toContain('corrective save is available');
      void editor.saveSelectedFile();
      for (let attempt = 0; attempt < 24 && !document.querySelector('nodel-confirm-host button[data-confirm-action="cancel"]'); attempt += 1) {
        await Promise.resolve();
      }
      document.querySelector<HTMLButtonElement>('nodel-confirm-host button[data-confirm-action="cancel"]')?.click();
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await Promise.resolve();
      }
      expect(integrationMock.saveCalls).toHaveLength(1);

      void editor.saveSelectedFile();
      for (let attempt = 0; attempt < 24 && !document.querySelector('nodel-confirm-host button[data-confirm-action="confirm"]'); attempt += 1) {
        await Promise.resolve();
      }
      document.querySelector<HTMLButtonElement>('nodel-confirm-host button[data-confirm-action="confirm"]')?.click();
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await Promise.resolve();
      }
      expect(integrationMock.saveCalls).toHaveLength(2);
      integrationMock.releaseSave();
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await Promise.resolve();
      }
      expect(source.getNodeRestartExpectation()).toMatchObject({ state: 'pending' });
    } finally {
      source.cancelNodeRestartExpectation(source.getNodeRestartExpectation());
      vi.useRealTimers();
    }
  });

  it('reconciles the old expectation when it confirms during a corrective baseline request', async () => {
    const source = await import('../src/data/node-restart-source');
    try {
      document.body.innerHTML = `
        <nodel-app>
          <nodel-page title="Node">
            <nodel-editor></nodel-editor>
          </nodel-page>
        </nodel-app>
      `;
      const app = document.querySelector('nodel-app')!;
      const editor = document.querySelector('nodel-editor') as any;
      await waitFor(() => Boolean(editor.querySelector('[data-editor-file-picker]')), { attempts: 200 });
      await waitFor(() => Boolean(editor.editor), { attempts: 200 });
      vi.useFakeTimers();

      editor.setEditorDocument('print("saved")', 'script.py');
      editor.handleEditorChange('print("saved")');
      void editor.saveSelectedFile();
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await Promise.resolve();
      }
      integrationMock.releaseSave();
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await Promise.resolve();
      }
      await vi.advanceTimersByTimeAsync(source.NODE_RESTART_EXPECTATION_TIMEOUT_MS);
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await Promise.resolve();
      }
      expect(source.getNodeRestartExpectation()).toMatchObject({ state: 'unconfirmed' });

      integrationMock.holdBaseline = true;
      integrationMock.delayedRestart = true;
      void editor.saveSelectedFile();
      for (let attempt = 0; attempt < 24 && !document.querySelector('nodel-confirm-host button[data-confirm-action="confirm"]'); attempt += 1) {
        await Promise.resolve();
      }
      document.querySelector<HTMLButtonElement>('nodel-confirm-host button[data-confirm-action="confirm"]')?.click();
      for (let attempt = 0; attempt < 24 && !integrationMock.baselinePending(); attempt += 1) {
        await Promise.resolve();
      }
      await vi.advanceTimersByTimeAsync(source.NODE_RESTART_UNCONFIRMED_RETRY_DELAY_MS);
      for (let attempt = 0; attempt < 24 && !integrationMock.restartPollPending(); attempt += 1) {
        await Promise.resolve();
      }
      integrationMock.confirmRestart();
      integrationMock.resolveBaseline();
      for (let attempt = 0; attempt < 48; attempt += 1) {
        await Promise.resolve();
      }
      await vi.advanceTimersByTimeAsync(0);
      for (let attempt = 0; attempt < 48; attempt += 1) {
        await Promise.resolve();
      }

      for (let attempt = 0; attempt < 100 && source.getNodeRestartScriptWriteState() !== 'idle'; attempt += 1) {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
      }

      expect(integrationMock.saveCalls).toHaveLength(1);
      expect(editor.editor.getDocument()).toBe('print("saved")');
      expect(app.textContent).not.toContain('Corrective script save');
      expect(app.textContent).toContain('View is up to date.');
      expect(source.getNodeRestartScriptWriteState()).toBe('idle');
    } finally {
      source.cancelNodeRestartExpectation(source.getNodeRestartExpectation());
      vi.useRealTimers();
    }
  });

  it('keeps the second real editor globally blocked after the owner disconnects', async () => {
    const source = await import('../src/data/node-restart-source');
    try {
      document.body.innerHTML = `
        <nodel-app>
          <nodel-page title="Node">
            <nodel-editor></nodel-editor>
            <nodel-editor></nodel-editor>
          </nodel-page>
        </nodel-app>
      `;
      const editors = Array.from(document.querySelectorAll('nodel-editor')) as any[];
      await waitFor(() => editors.every((editor) => editor.editor), { attempts: 200 });
      await waitFor(() => editors.every((editor) => editor.state.selectedPath === 'script.py' && !editor.state.loading), { attempts: 200 });
      editors[0].setEditorDocument('print("owner")', 'script.py');
      editors[0].handleEditorChange('print("owner")');
      void editors[0].saveSelectedFile();
      await waitFor(() => integrationMock.saveCalls.length === 1, { attempts: 200 });
      integrationMock.releaseSave();
      await waitFor(() => document.body.textContent?.includes('script.py saved. Waiting for node reload.') ?? false, { attempts: 200 });

      editors[0].remove();
      editors[1].setEditorDocument('print("blocked")', 'script.py');
      editors[1].handleEditorChange('print("blocked")');
      await editors[1].saveSelectedFile();

      expect(integrationMock.saveCalls).toHaveLength(1);
      expect(source.getNodeRestartExpectation()).toMatchObject({ state: 'pending' });
    } finally {
      source.cancelNodeRestartExpectation(source.getNodeRestartExpectation());
    }
  });

  it('clears global reload coordination when the whole app is removed and reconnects cleanly', async () => {
    const source = await import('../src/data/node-restart-source');
    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Node">
          <nodel-editor></nodel-editor>
        </nodel-page>
      </nodel-app>
    `;
    const firstApp = document.querySelector('nodel-app')!;
    const firstEditor = document.querySelector('nodel-editor') as any;
    await waitFor(() => Boolean(firstEditor.editor), { attempts: 200 });
    firstEditor.setEditorDocument('print("pending")', 'script.py');
    firstEditor.handleEditorChange('print("pending")');
    void firstEditor.saveSelectedFile();
    await waitFor(() => integrationMock.saveCalls.length === 1, { attempts: 200 });
    integrationMock.releaseSave();
    await waitFor(() => source.getNodeRestartScriptWriteState() === 'pending', { attempts: 200 });

    firstApp.remove();
    await waitFor(() => source.getNodeRestartScriptWriteState() === 'idle', { attempts: 200 });

    document.body.innerHTML = `
      <nodel-app>
        <nodel-page title="Node">
          <nodel-editor></nodel-editor>
        </nodel-page>
      </nodel-app>
    `;
    const secondEditor = document.querySelector('nodel-editor') as any;
    await waitFor(() => Boolean(secondEditor.editor), { attempts: 200 });
    secondEditor.setEditorDocument('print("after reconnect")', 'script.py');
    secondEditor.handleEditorChange('print("after reconnect")');
    void secondEditor.saveSelectedFile();
    await waitFor(() => integrationMock.saveCalls.length === 2, { attempts: 200 });
    integrationMock.releaseSave();
  });

  it('backs off temporary hasRestarted failures and recovers on a later endpoint timestamp', async () => {
    const source = await import('../src/data/node-restart-source');
    try {
      document.body.innerHTML = `
        <nodel-app>
          <nodel-page title="Node">
            <nodel-editor></nodel-editor>
          </nodel-page>
        </nodel-app>
      `;
      const editor = document.querySelector('nodel-editor') as any;
      await waitFor(() => Boolean(editor.querySelector('[data-editor-file-picker]')), { attempts: 200 });
      await waitFor(() => Boolean(editor.editor), { attempts: 200 });
      vi.useFakeTimers();
      editor.setEditorDocument('print("saved")', 'script.py');
      editor.handleEditorChange('print("saved")');
      void editor.saveSelectedFile();
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await Promise.resolve();
      }
      integrationMock.restartFailures = 2;
      integrationMock.releaseSave();
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await Promise.resolve();
      }

      const callsAfterFirstFailure = integrationMock.getNodeRestartStatus.mock.calls.length;
      await vi.advanceTimersByTimeAsync(source.NODE_RESTART_EXPECTED_RETRY_BACKOFF_INITIAL_MS - 1);
      expect(integrationMock.getNodeRestartStatus.mock.calls.length).toBe(callsAfterFirstFailure);
      await vi.advanceTimersByTimeAsync(1);
      expect(integrationMock.getNodeRestartStatus.mock.calls.length).toBe(callsAfterFirstFailure + 1);

      integrationMock.delayedRestart = true;
      await vi.advanceTimersByTimeAsync(source.NODE_RESTART_EXPECTED_RETRY_BACKOFF_INITIAL_MS * 2);
      for (let attempt = 0; attempt < 24 && !integrationMock.restartPollPending(); attempt += 1) {
        await Promise.resolve();
      }
      integrationMock.confirmRestart();
      for (let attempt = 0; attempt < 36; attempt += 1) {
        await Promise.resolve();
      }
      expect(document.body.textContent).toContain('View is up to date.');
    } finally {
      source.cancelNodeRestartExpectation(source.getNodeRestartExpectation());
      vi.useRealTimers();
    }
  });
});
