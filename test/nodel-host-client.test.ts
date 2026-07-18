import {
  getDiagnosticMeasurements,
  getHostCapabilities,
  getHostLogs,
  getNodeRestartStatus,
  normalizeNodelCapabilities
} from '../src/api/nodel-host-client';

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

  it('reads generic host capabilities when a valid feature is explicit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        schemaVersion: 1,
        apiVersion: '1.0',
        features: {
          consoleHistory: true,
          consoleExec: false
        }
      })
    })));

    await expect(getHostCapabilities()).resolves.toEqual({
      schemaVersion: 1,
      apiVersion: '1.0',
      features: {
        consoleHistory: true,
        consoleExec: false
      }
    });

    expect(fetch).toHaveBeenCalledWith('/REST/capabilities', undefined);
  });

  it('preserves legacy execution defaults for missing, failing, or malformed capabilities', async () => {
    expect(normalizeNodelCapabilities({ schemaVersion: 1, apiVersion: '1.0', features: { consoleExec: false } }).features.consoleExec).toBe(false);
    expect(normalizeNodelCapabilities({ apiVersion: '1.0', features: { consoleExec: false } }).features.consoleExec).toBe(true);
    expect(normalizeNodelCapabilities({ features: { consoleExec: 'false' } }).features.consoleExec).toBe(true);
    expect(normalizeNodelCapabilities({ features: {} }).features.consoleExec).toBe(true);
    expect(normalizeNodelCapabilities('not an object').features.consoleExec).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({})
    })));

    await expect(getHostCapabilities()).resolves.toMatchObject({
      features: {
        consoleExec: true
      }
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('not json');
      }
    })));

    await expect(getHostCapabilities()).resolves.toMatchObject({
      features: {
        consoleExec: true
      }
    });
  });
});
