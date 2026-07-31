import { installControlRuntime, type NodelControlSignalState } from '../src/data/control-runtime';
import '../src/components/nodel-app';
import '../src/components/nodel-page';
import '../src/components/nodel-toolbar';
import { flush } from './helpers';

describe('nodel-app signal title', () => {
  const signalListener: { value: ((state: NodelControlSignalState) => void) | null } = { value: null };
  let dispose: ReturnType<typeof vi.fn>;
  let restoreRuntime: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = 'Initial';
    window.history.replaceState(undefined, '', '/');
    signalListener.value = null;
    dispose = vi.fn();
    restoreRuntime = installControlRuntime({
      callAction: vi.fn(),
      subscribeSignals: (_element, listener) => {
        signalListener.value = listener;
        return { dispose };
      }
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    restoreRuntime?.();
    restoreRuntime = null;
  });

  function emit(alias: string, arg: unknown) {
    signalListener.value?.({
      loading: false,
      connected: true,
      error: '',
      entries: [{ seq: 1, timestamp: '', source: 'local', type: 'event', alias, arg }]
    });
  }

  it('updates the document and default toolbar title from an explicit signal', async () => {
    document.body.innerHTML = '<nodel-app signal="DisplayTitle"><nodel-toolbar></nodel-toolbar><nodel-page title="Page"></nodel-page></nodel-app>';
    emit('DisplayTitle', 'Gallery East');
    await flush();

    expect(document.title).toBe('Gallery East');
    expect(document.querySelector('[data-toolbar-title]')?.textContent).toBe('Gallery East');
    expect((document.querySelector('[data-toolbar-title]') as HTMLElement).hidden).toBe(false);
  });

  it('keeps an explicit toolbar title as the visible override', async () => {
    document.body.innerHTML = '<nodel-app signals="DisplayTitle:title"><nodel-toolbar title="Operator Console"></nodel-toolbar><nodel-page title="Page"></nodel-page></nodel-app>';
    emit('DisplayTitle', 'Gallery East');
    await flush();

    expect(document.title).toBe('Gallery East');
    expect(document.querySelector('[data-toolbar-title]')?.textContent).toBe('Operator Console');
  });

  it('makes a synchronous initial title available when the toolbar connects', async () => {
    restoreRuntime?.();
    restoreRuntime = installControlRuntime({
      callAction: vi.fn(),
      subscribeSignals: (_element, listener) => {
        listener({
          loading: false,
          connected: true,
          error: '',
          entries: [{ seq: 1, timestamp: '', source: 'local', type: 'event', alias: 'DisplayTitle', arg: 'Initial signal title' }]
        });
        return { dispose };
      }
    });
    document.body.innerHTML = '<nodel-app signal="DisplayTitle"><nodel-toolbar></nodel-toolbar><nodel-page title="Page"></nodel-page></nodel-app>';
    await flush();

    expect(document.title).toBe('Initial signal title');
    expect(document.querySelector('[data-toolbar-title]')?.textContent).toBe('Initial signal title');
  });

  it('does not make the legacy Title alias globally special', async () => {
    document.body.innerHTML = '<nodel-app title="Static"><nodel-toolbar></nodel-toolbar><nodel-page title="Page"></nodel-page></nodel-app>';
    await flush();

    expect(signalListener.value).toBeNull();
    expect(document.title).toBe('Static');
  });

  it('disposes title subscriptions on disconnect', async () => {
    document.body.innerHTML = '<nodel-app signal="DisplayTitle"><nodel-page title="Page"></nodel-page></nodel-app>';
    await flush();
    document.querySelector('nodel-app')?.remove();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('clears stale signal titles when bindings change while disconnected', async () => {
    document.body.innerHTML = '<nodel-app signal="DisplayTitle"><nodel-toolbar></nodel-toolbar><nodel-page title="Page"></nodel-page></nodel-app>';
    emit('DisplayTitle', 'Old signal title');
    await flush();
    const app = document.querySelector('nodel-app')!;
    app.remove();
    app.removeAttribute('signal');
    app.setAttribute('title', 'Reconnected title');
    document.body.append(app);
    await flush();

    expect(document.title).toBe('Reconnected title');
    expect(document.querySelector('[data-toolbar-title]')?.textContent).not.toBe('Old signal title');
    expect((app as HTMLElement & { getSignalTitle(): string | null }).getSignalTitle()).toBeNull();
  });
});
