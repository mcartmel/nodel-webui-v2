const addNodeApiMock = vi.hoisted(() => ({
  createNode: vi.fn(),
  duplicateNode: vi.fn(),
  waitForNodeReady: vi.fn(),
  NodelDuplicateNodeError: class NodelDuplicateNodeError extends Error {}
}));

vi.mock('../src/api/nodel-host-client', () => addNodeApiMock);

import { createAddNodeFromTemplate, duplicateAddNodeFromSource } from '../src/features/add-node-use-cases';

describe('add-node use cases', () => {
  beforeEach(() => {
    addNodeApiMock.createNode.mockReset();
    addNodeApiMock.duplicateNode.mockReset();
    addNodeApiMock.waitForNodeReady.mockReset();
  });

  it('creates a node from a recipe/template and waits for readiness', async () => {
    const onWaiting = vi.fn();
    addNodeApiMock.createNode.mockResolvedValue(undefined);
    addNodeApiMock.waitForNodeReady.mockResolvedValue(undefined);

    await expect(createAddNodeFromTemplate({ name: 'Example Node', base: 'recipes/example.py', onWaiting })).resolves.toEqual({
      url: '/nodes/ExampleNode/'
    });

    expect(addNodeApiMock.createNode).toHaveBeenCalledWith('Example Node', 'recipes/example.py', expect.any(Object));
    expect(onWaiting).toHaveBeenCalledWith('/nodes/ExampleNode/');
    expect(addNodeApiMock.waitForNodeReady).toHaveBeenCalledWith(expect.stringContaining('/nodes/ExampleNode/'), 30, 1000, expect.any(Object));
  });

  it('delegates duplicate options to the duplicate service', async () => {
    const onProgress = vi.fn();
    const result = { url: '/nodes/Copy/', copied: [], skipped: [], failed: [] };
    addNodeApiMock.duplicateNode.mockResolvedValue(result);
    const signal = new AbortController().signal;

    await expect(duplicateAddNodeFromSource({
      sourceAddress: 'https://source.example/nodes/Source/',
      name: 'Copy',
      includeNodeConfig: true,
      onProgress,
      signal
    })).resolves.toBe(result);

    expect(addNodeApiMock.duplicateNode).toHaveBeenCalledWith('https://source.example/nodes/Source/', 'Copy', {
      includeNodeConfig: true,
      onProgress,
      signal
    });
  });
});
