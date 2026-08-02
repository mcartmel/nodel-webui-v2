const addNodeApiMock = vi.hoisted(() => ({
  listRecipes: vi.fn(),
  searchNodeUrls: vi.fn()
}));

vi.mock('../src/api/nodel-host-client', () => addNodeApiMock);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function abortError() {
  const error = new Error('The request was aborted');
  error.name = 'AbortError';
  return error;
}

async function loadAddNodeFeature() {
  vi.resetModules();
  return import('../src/features/add-node');
}

describe('add-node recipe cache', () => {
  beforeEach(() => {
    addNodeApiMock.listRecipes.mockReset();
    addNodeApiMock.searchNodeUrls.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses a fresh recipe cache entry without another request', async () => {
    const { refreshAddNodeRecipes } = await loadAddNodeFeature();
    const recipes = [{ path: 'Recipes/Starter' }];
    addNodeApiMock.listRecipes.mockResolvedValue(recipes);

    await expect(refreshAddNodeRecipes()).resolves.toEqual(recipes);
    await expect(refreshAddNodeRecipes()).resolves.toEqual(recipes);

    expect(addNodeApiMock.listRecipes).toHaveBeenCalledTimes(1);
  });

  it('bypasses the TTL for a forced refresh', async () => {
    const { refreshAddNodeRecipes } = await loadAddNodeFeature();
    addNodeApiMock.listRecipes
      .mockResolvedValueOnce([{ path: 'Recipes/Old' }])
      .mockResolvedValueOnce([{ path: 'Recipes/New' }]);

    await refreshAddNodeRecipes();
    await expect(refreshAddNodeRecipes(true)).resolves.toEqual([{ path: 'Recipes/New' }]);

    expect(addNodeApiMock.listRecipes).toHaveBeenCalledTimes(2);
  });

  it('retains the previous successful data after a failed refresh', async () => {
    const { refreshAddNodeRecipes } = await loadAddNodeFeature();
    const previous = [{ path: 'Recipes/Previous' }];
    addNodeApiMock.listRecipes
      .mockResolvedValueOnce(previous)
      .mockRejectedValueOnce(new Error('malformed recipe response'));

    await refreshAddNodeRecipes();
    await expect(refreshAddNodeRecipes(true)).rejects.toThrow('malformed recipe response');
    await expect(refreshAddNodeRecipes()).resolves.toEqual(previous);

    expect(addNodeApiMock.listRecipes).toHaveBeenCalledTimes(2);
  });

  it('does not make a successful query reuse an aborted query recipe request', async () => {
    const { searchAddNodeTemplates } = await loadAddNodeFeature();
    const signals: AbortSignal[] = [];
    addNodeApiMock.listRecipes.mockImplementation((init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      if (signals.length === 1) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError()), { once: true });
        });
      }
      return Promise.resolve([{ path: 'Recipes/Second' }]);
    });

    const firstController = new AbortController();
    const first = searchAddNodeTemplates({
      allowDuplicate: false,
      allowRecipes: true,
      query: 'first',
      signal: firstController.signal
    });
    firstController.abort();

    await expect(searchAddNodeTemplates({
      allowDuplicate: false,
      allowRecipes: true,
      query: 'second',
      signal: new AbortController().signal
    })).resolves.toEqual({
      error: '',
      results: [{ type: 'recipe', path: 'Recipes/Second' }]
    });
    await expect(first).resolves.toEqual({ error: '', results: [] });

    expect(addNodeApiMock.listRecipes).toHaveBeenCalledTimes(2);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it('keeps concurrent uncached callers independent', async () => {
    const { refreshAddNodeRecipes } = await loadAddNodeFeature();
    const firstRequest = deferred<Array<{ path: string }>>();
    const secondRequest = deferred<Array<{ path: string }>>();
    const signals: AbortSignal[] = [];
    addNodeApiMock.listRecipes.mockImplementation((init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      return signals.length === 1 ? firstRequest.promise : secondRequest.promise;
    });

    const firstController = new AbortController();
    const first = refreshAddNodeRecipes(true, { signal: firstController.signal });
    const second = refreshAddNodeRecipes(true, { signal: new AbortController().signal });

    expect(addNodeApiMock.listRecipes).toHaveBeenCalledTimes(2);
    firstController.abort();
    firstRequest.reject(abortError());
    secondRequest.resolve([{ path: 'Recipes/Independent' }]);

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toEqual([{ path: 'Recipes/Independent' }]);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('does not let an older abort-insensitive refresh replace newer cached data', async () => {
    const { refreshAddNodeRecipes } = await loadAddNodeFeature();
    const olderRequest = deferred<Array<{ path: string }>>();
    const newerRequest = deferred<Array<{ path: string }>>();
    addNodeApiMock.listRecipes
      .mockReturnValueOnce(olderRequest.promise)
      .mockReturnValueOnce(newerRequest.promise);

    const older = refreshAddNodeRecipes(true, { signal: new AbortController().signal });
    const newer = refreshAddNodeRecipes(true, { signal: new AbortController().signal });
    newerRequest.resolve([{ path: 'Recipes/Newer' }]);
    await expect(newer).resolves.toEqual([{ path: 'Recipes/Newer' }]);
    olderRequest.resolve([{ path: 'Recipes/Older' }]);
    await expect(older).resolves.toEqual([{ path: 'Recipes/Older' }]);

    await expect(refreshAddNodeRecipes()).resolves.toEqual([{ path: 'Recipes/Newer' }]);
    expect(addNodeApiMock.listRecipes).toHaveBeenCalledTimes(2);
  });

  it('does not let an aborted abort-insensitive refresh replace newer cached data', async () => {
    const { refreshAddNodeRecipes } = await loadAddNodeFeature();
    const abortedRequest = deferred<Array<{ path: string }>>();
    const successfulRequest = deferred<Array<{ path: string }>>();
    addNodeApiMock.listRecipes
      .mockReturnValueOnce(abortedRequest.promise)
      .mockReturnValueOnce(successfulRequest.promise);

    const controller = new AbortController();
    const aborted = refreshAddNodeRecipes(true, { signal: controller.signal });
    const successful = refreshAddNodeRecipes(true, { signal: new AbortController().signal });
    controller.abort();
    successfulRequest.resolve([{ path: 'Recipes/Successful' }]);
    await expect(successful).resolves.toEqual([{ path: 'Recipes/Successful' }]);
    abortedRequest.resolve([{ path: 'Recipes/Aborted' }]);
    await expect(aborted).resolves.toEqual([{ path: 'Recipes/Aborted' }]);

    await expect(refreshAddNodeRecipes()).resolves.toEqual([{ path: 'Recipes/Successful' }]);
    expect(addNodeApiMock.listRecipes).toHaveBeenCalledTimes(2);
  });

  it('projects recipe and node result views without a redundant aggregate', async () => {
    const { templateResultViews } = await loadAddNodeFeature();
    const result = templateResultViews([
      { type: 'recipe', path: 'Recipes/Starter' },
      { type: 'node', address: 'http://host/nodes/Lighting/', name: 'Lighting', host: 'host' }
    ]);

    expect(result.recipeViews).toEqual([{
      type: 'recipe',
      path: 'Recipes/Starter',
      index: 0,
      primary: 'Recipes/Starter',
      secondary: 'Recipe'
    }]);
    expect(result.nodeViews).toEqual([{
      type: 'node',
      address: 'http://host/nodes/Lighting/',
      name: 'Lighting',
      host: 'host',
      index: 1,
      primary: 'Lighting',
      secondary: 'host'
    }]);
    expect(result).not.toHaveProperty('views');
  });
});
