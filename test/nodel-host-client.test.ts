import {
  duplicateNode,
  getDiagnosticMeasurements,
  getHostCapabilities,
  getHostLogs,
  getNodeRestartStatus,
  NodelDuplicateNodeError,
  normalizeNodelCapabilities
} from '../src/api/nodel-host-client';

function readBlobBytes(blob: Blob) {
  return new Promise<number[]>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer))));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsArrayBuffer(blob);
  });
}

describe('nodel host client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ timestamp: '2026-01-01T00:00:00.000Z' })
    })));
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('duplicates files byte-for-byte, filters unsafe files, and saves script.py last', async () => {
    const source = 'http://source/nodes/Original/';
    const payloads = new Map<string, number[]>([
      ['docs/readme.txt', [0, 1, 2, 255]],
      ['assets/image.png', [137, 80, 78, 71, 0, 255]],
      ['bundles/archive.zip', [80, 75, 3, 4, 254]],
      ['script.py', [35, 32, 114, 101, 99, 105, 112, 101]]
    ]);
    const files = [
      { path: 'script.py' },
      { path: 'docs/readme.txt' },
      { path: 'assets/image.png' },
      { path: 'bundles/archive.zip' },
      { path: '_generated.json' },
      { path: 'nested/_cache.json' },
      { path: 'script_backup_2026.py' },
      { path: 'nested/script_backup_old.py' },
      { path: 'nodeConfig.json' }
    ];
    const saved = new Map<string, number[]>();
    const saveOrder: string[] = [];
    const progress: string[] = [];

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify(files), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode') {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url.endsWith('/nodes/BinaryCopy/REST/')) {
        return new Response('{}', { status: 200 }) as never;
      }
      if (url.startsWith(`${source}REST/files/contents?path=`)) {
        const path = decodeURIComponent(url.split('path=')[1]);
        return new Response(Uint8Array.from(payloads.get(path) ?? []), { status: 200 }) as never;
      }
      if (url.includes('/nodes/BinaryCopy/REST/files/save?path=')) {
        const path = decodeURIComponent(url.split('path=')[1]);
        const body = init?.body as Blob;
        saveOrder.push(path);
        saved.set(path, await readBlobBytes(body));
        expect(new Headers(init?.headers).get('Content-Type')).toBe('application/octet-stream');
        return new Response('{}', { status: 200 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    const result = await duplicateNode(source, 'Binary Copy', {
      onProgress: (entry) => progress.push(entry.phase)
    });

    expect(saveOrder).toEqual(['docs/readme.txt', 'assets/image.png', 'bundles/archive.zip', 'script.py']);
    expect(Object.fromEntries(saved)).toEqual(Object.fromEntries(payloads));
    expect(result).toMatchObject({
      copied: saveOrder,
      failed: [],
      skipped: [
        '_generated.json',
        'nested/_cache.json',
        'script_backup_2026.py',
        'nested/script_backup_old.py',
        'nodeConfig.json'
      ]
    });
    expect(progress).toEqual(['creating', 'waiting', 'copying', 'copying', 'copying', 'copying', 'complete']);
  });

  it('copies nodeConfig.json only when explicitly requested', async () => {
    const source = 'http://source/nodes/Original/';
    const saves: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify([{ path: 'nodeConfig.json' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode' || url.endsWith('/nodes/ConfiguredCopy/REST/')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === `${source}REST/files/contents?path=nodeConfig.json`) {
        return new Response(Uint8Array.from([1, 2, 3]), { status: 200 }) as never;
      }
      if (url.includes('/nodes/ConfiguredCopy/REST/files/save?path=')) {
        saves.push(decodeURIComponent(url.split('path=')[1]));
        expect(init?.body).toBeInstanceOf(Blob);
        return new Response('{}', { status: 200 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    const result = await duplicateNode(source, 'Configured Copy', { includeNodeConfig: true });

    expect(result.skipped).toEqual([]);
    expect(saves).toEqual(['nodeConfig.json']);
  });

  it('continues after non-script failures and reports structured partial results', async () => {
    const source = 'http://source/nodes/Original/';
    const saves: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify([
          { path: 'read-failure.bin' },
          { path: 'save-failure.bin' },
          { path: 'good.bin' },
          { path: 'script.py' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode' || url.endsWith('/nodes/PartialCopy/REST/')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === `${source}REST/files/contents?path=read-failure.bin`) {
        return new Response('source unavailable', { status: 503, statusText: 'Unavailable' }) as never;
      }
      if (url.startsWith(`${source}REST/files/contents?path=`)) {
        return new Response(Uint8Array.from([1, 2, 3]), { status: 200 }) as never;
      }
      if (url.includes('/nodes/PartialCopy/REST/files/save?path=')) {
        const path = decodeURIComponent(url.split('path=')[1]);
        saves.push(path);
        if (path === 'save-failure.bin') {
          return new Response(JSON.stringify({ message: 'destination rejected file' }), { status: 500, headers: { 'Content-Type': 'application/json' } }) as never;
        }
        return new Response('{}', { status: 200 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    const result = await duplicateNode(source, 'Partial Copy');

    expect(saves).toEqual(['save-failure.bin', 'good.bin', 'script.py']);
    expect(result.copied).toEqual(['good.bin', 'script.py']);
    expect(result.failed).toEqual([
      expect.objectContaining({ path: 'read-failure.bin', phase: 'read', status: 503, message: 'source unavailable' }),
      expect.objectContaining({ path: 'save-failure.bin', phase: 'save', status: 500, message: 'destination rejected file' })
    ]);
  });

  it('throws an incomplete-node error when script.py cannot be copied', async () => {
    const source = 'http://source/nodes/Original/';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify([{ path: 'script.py' }, { path: 'support.txt' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode' || url.endsWith('/nodes/BrokenCopy/REST/')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url.startsWith(`${source}REST/files/contents?path=`)) {
        return new Response('content', { status: 200 }) as never;
      }
      if (url.includes('/nodes/BrokenCopy/REST/files/save?path=support.txt')) {
        return new Response('{}', { status: 200 }) as never;
      }
      if (url.includes('/nodes/BrokenCopy/REST/files/save?path=script.py')) {
        return new Response('recipe rejected', { status: 500 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    const promise = duplicateNode(source, 'Broken Copy');

    await expect(promise).rejects.toMatchObject({
      name: 'NodelDuplicateNodeError',
      destinationUrl: expect.stringContaining('/nodes/BrokenCopy/'),
      failed: [expect.objectContaining({ path: 'script.py', phase: 'save', status: 500 })]
    });
    await expect(promise).rejects.toBeInstanceOf(NodelDuplicateNodeError);
  });

  it('does not create a destination when the source list is unavailable or invalid', async () => {
    const source = 'http://source/nodes/Original/';
    const createCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify([{ invalid: true }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode') {
        createCalls.push(url);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    await expect(duplicateNode(source, 'Invalid Copy')).rejects.toThrow('Failed to read source node file list: Source node returned an invalid file list');
    expect(createCalls).toEqual([]);
  });

  it('does not create a destination when the source file list request fails', async () => {
    const source = 'http://source/nodes/Original/';
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify({ message: 'source node is offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    await expect(duplicateNode(source, 'Unavailable Copy')).rejects.toThrow('source node is offline');
    expect(calls).toEqual([`${source}REST/files`]);
  });

  it('labels destination creation failures distinctly from source-list failures', async () => {
    const source = 'http://source/nodes/Original/';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode') {
        return new Response(JSON.stringify({ message: 'destination name already exists' }), { status: 500, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    await expect(duplicateNode(source, 'Existing Copy')).rejects.toThrow(
      'Failed to create destination node "Existing Copy": destination name already exists'
    );
  });

  it('reports a created but unavailable destination after readiness timeout', async () => {
    vi.useFakeTimers();
    const source = 'http://source/nodes/Original/';
    let readinessAttempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode') {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url.endsWith('/nodes/UnavailableCopy/REST/')) {
        readinessAttempts += 1;
        return new Response('starting', { status: 503 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    const duplication = duplicateNode(source, 'Unavailable Copy');
    const rejection = expect(duplication).rejects.toMatchObject({
      name: 'NodelDuplicateNodeError',
      destinationUrl: expect.stringContaining('/nodes/UnavailableCopy/'),
      message: expect.stringContaining('created but may be incomplete because it did not become available')
    });
    await vi.runAllTimersAsync();
    await rejection;
    expect(readinessAttempts).toBe(30);
  });
});
