import { getDiagnosticMeasurements, getHostLogs, getNodeRestartStatus } from '../src/api/nodel-host-client';

describe('nodel host client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ timestamp: '2026-01-01T00:00:00.000Z' })
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads node restart status with optional timestamp and timeout params', async () => {
    await expect(getNodeRestartStatus({ timestamp: '2026-01-01T00:00:00.000Z', timeout: 5000 })).resolves.toEqual({
      timestamp: '2026-01-01T00:00:00.000Z'
    });

    expect(fetch).toHaveBeenCalledWith(
      'REST/hasRestarted?timestamp=2026-01-01T00%3A00%3A00.000Z&timeout=5000',
      undefined
    );
  });

  it('reads host diagnostics logs and measurements', async () => {
    const init = { signal: new AbortController().signal };

    await getHostLogs({ from: -1, max: 200 }, init);
    await getDiagnosticMeasurements(init);

    expect(fetch).toHaveBeenCalledWith('/REST/logs?from=-1&max=200', init);
    expect(fetch).toHaveBeenCalledWith('/REST/diagnostics/measurements', init);
  });
});
