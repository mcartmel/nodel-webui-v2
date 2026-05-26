import '../src/components/nodel-toast-host';
import type { NodelToastHost } from '../src/components/nodel-toast-host';

describe('nodel-toast-host', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mountToastHost() {
    document.body.innerHTML = '<nodel-toast-host></nodel-toast-host>';
    return document.querySelector('nodel-toast-host') as NodelToastHost;
  }

  it('renders toast message, detail, and tone', () => {
    const host = mountToastHost();

    host.show({
      message: 'File saved',
      detail: 'script.py',
      tone: 'success'
    });

    const toast = document.querySelector<HTMLElement>('.nodel-toast')!;
    expect(toast.textContent).toContain('File saved');
    expect(toast.textContent).toContain('script.py');
    expect(toast.className).toContain('nodel-toast-success');
    expect(toast.getAttribute('role')).toBe('status');
  });

  it('auto-dismisses timed toasts', async () => {
    const host = mountToastHost();

    host.show({ message: 'Saved', durationMs: 20 });
    expect(document.body.textContent).toContain('Saved');

    await vi.advanceTimersByTimeAsync(20);

    expect(document.body.textContent).not.toContain('Saved');
    expect(host.hidden).toBe(true);
  });

  it('keeps persistent toasts until dismissed or updated', async () => {
    const host = mountToastHost();

    host.show({ id: 'reload', message: 'Refreshing view...', persistent: true });
    await vi.advanceTimersByTimeAsync(10000);
    expect(document.body.textContent).toContain('Refreshing view...');

    host.show({ id: 'reload', message: 'View is up to date.', tone: 'success', durationMs: 20 });
    expect(document.body.textContent).not.toContain('Refreshing view...');
    expect(document.body.textContent).toContain('View is up to date.');

    await vi.advanceTimersByTimeAsync(20);
    expect(document.body.textContent).not.toContain('View is up to date.');
  });

  it('renders multiple toasts and dismisses one at a time', () => {
    const host = mountToastHost();

    const firstId = host.show({ message: 'First', persistent: true });
    host.show({ message: 'Second', persistent: true });

    expect(document.querySelectorAll('.nodel-toast')).toHaveLength(2);
    host.dismiss(firstId);

    expect(document.querySelectorAll('.nodel-toast')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('First');
    expect(document.body.textContent).toContain('Second');
  });

  it('uses alert semantics for danger toasts', () => {
    const host = mountToastHost();

    host.show({ message: 'Failed', tone: 'danger' });

    const toast = document.querySelector<HTMLElement>('.nodel-toast')!;
    expect(toast.getAttribute('role')).toBe('alert');
    expect(toast.getAttribute('aria-live')).toBe('assertive');
  });
});
