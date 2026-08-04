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

  it('preserves the listed empty root recipe base', async () => {
    addNodeApiMock.createNode.mockResolvedValue(undefined);
    addNodeApiMock.waitForNodeReady.mockResolvedValue(undefined);

    await createAddNodeFromTemplate({ name: 'Root Recipe', base: '' });

    expect(addNodeApiMock.createNode).toHaveBeenCalledWith('Root Recipe', '', expect.any(Object));
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

  it('rejects malformed, supplementary, and control destination names before create, duplicate, or readiness requests', async () => {
    const invalidNames = ['Node\ud800', 'Node \ud83d\ude00', 'Node\u0080'];

    for (const name of invalidNames) {
      await expect(createAddNodeFromTemplate({ name })).rejects.toThrow();
      await expect(duplicateAddNodeFromSource({
        sourceAddress: 'https://source.example/nodes/Source/',
        name
      })).rejects.toThrow();
    }

    expect(addNodeApiMock.createNode).not.toHaveBeenCalled();
    expect(addNodeApiMock.duplicateNode).not.toHaveBeenCalled();
    expect(addNodeApiMock.waitForNodeReady).not.toHaveBeenCalled();
  });

  it('rejects names whose Java path reduction is empty before mutations', async () => {
    await expect(createAddNodeFromTemplate({ name: '\u00a0' })).rejects.toThrow('reduce to at least one path character');
    await expect(duplicateAddNodeFromSource({
      sourceAddress: 'https://source.example/nodes/Source/',
      name: '\u00a0'
    })).rejects.toThrow('reduce to at least one path character');

    expect(addNodeApiMock.createNode).not.toHaveBeenCalled();
    expect(addNodeApiMock.duplicateNode).not.toHaveBeenCalled();
  });

  it('accepts ordinary BMP Unicode destination names', async () => {
    addNodeApiMock.createNode.mockResolvedValue(undefined);
    addNodeApiMock.waitForNodeReady.mockResolvedValue(undefined);

    await expect(createAddNodeFromTemplate({ name: 'Node \u4e2d\u6587' })).resolves.toEqual({
      url: '/nodes/Node%E4%B8%AD%E6%96%87/'
    });
    expect(addNodeApiMock.createNode).toHaveBeenCalledWith('Node \u4e2d\u6587', undefined, expect.any(Object));
    expect(addNodeApiMock.waitForNodeReady).toHaveBeenCalledWith(
      expect.stringContaining('/nodes/Node%E4%B8%AD%E6%96%87/'),
      30,
      1000,
      expect.any(Object)
    );
  });
});
