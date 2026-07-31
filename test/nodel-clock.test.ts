import { installControlRuntime, type NodelControlSignalState } from '../src/data/control-runtime';
import '../src/components/nodel-clock';
import { flush } from './helpers';

describe('nodel-clock', () => {
  let listener: ((state: NodelControlSignalState) => void) | null = null;
  let restoreRuntime: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    listener = null;
    restoreRuntime = installControlRuntime({
      callAction: vi.fn(),
      subscribeSignals: (_element, nextListener) => {
        listener = nextListener;
        return { dispose() {} };
      }
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    restoreRuntime?.();
    restoreRuntime = null;
  });

  it('formats valid date/time values with constrained options', async () => {
    document.body.innerHTML = '<nodel-clock value="2026-07-31T10:15:30Z" format="datetime" hour12="false" time-zone="UTC"></nodel-clock>';
    await flush();
    const time = document.querySelector('nodel-clock time')!;

    expect(time.textContent).toContain('2026');
    expect(time.textContent).toContain('10:15:30');
    expect(time.getAttribute('datetime')).toBe('2026-07-31T10:15:30.000Z');
  });

  it('displays invalid scalar values as text', async () => {
    document.body.innerHTML = '<nodel-clock value="Waiting for sync" time-zone="Invalid/Zone"></nodel-clock>';
    await flush();
    const time = document.querySelector('nodel-clock time')!;

    expect(time.textContent).toBe('Waiting for sync');
    expect(time.hasAttribute('datetime')).toBe(false);
  });

  it('reflects explicit signal updates without autonomous ticking', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<nodel-clock signal="ClockValue" format="time" time-zone="UTC"></nodel-clock>';
    const component = document.querySelector('nodel-clock')!;
    listener?.({
      loading: false,
      connected: true,
      error: '',
      entries: [{ seq: 1, timestamp: '', source: 'local', type: 'event', alias: 'ClockValue', arg: '2026-07-31T12:00:00Z' }]
    });
    const rendered = component.textContent;

    vi.advanceTimersByTime(60_000);
    expect(component.textContent).toBe(rendered);
    expect(component.getAttribute('value')).toBe('2026-07-31T12:00:00Z');
    vi.useRealTimers();
  });

  it('supports explicit signals target syntax', async () => {
    document.body.innerHTML = '<nodel-clock signals="PresentationTime:value" format="date" time-zone="UTC"></nodel-clock>';
    listener?.({
      loading: false,
      connected: true,
      error: '',
      entries: [{ seq: 1, timestamp: '', source: 'local', type: 'event', alias: 'PresentationTime', arg: 0 }]
    });
    await flush();

    expect(document.querySelector('nodel-clock')?.getAttribute('value')).toBe('0');
    expect(document.querySelector('nodel-clock time')?.hasAttribute('datetime')).toBe(true);
  });
});
