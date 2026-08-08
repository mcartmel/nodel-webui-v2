import { EditorFileOperations } from '../src/editor/editor-file-operations';
import { EditorDocumentSession } from '../src/editor/editor-document-session';
import type { NodelFileEntry } from '../src/api/nodel-types';

function api(files: NodelFileEntry[] = [{ path: 'a.txt', modified: '1', size: 3 }]) {
  return { list: vi.fn(async () => files), read: vi.fn(async () => 'old'), save: vi.fn(async (..._args: unknown[]) => undefined), delete: vi.fn(async (..._args: unknown[]) => undefined) };
}
const current = () => true;

describe('EditorFileOperations', () => {
  it('opens policy classes without reading binary, aliases, or oversized files', async () => {
    const port = api(); const operations = new EditorFileOperations(port, () => true);
    expect((await operations.open('image.png', [], { isCurrent: current })).kind).toBe('readonly');
    expect((await operations.open('Script.py', [{ path: 'Script.py' }], { isCurrent: current })).kind).toBe('readonly');
    expect((await operations.open('big.txt', [{ path: 'big.txt', size: 1024 * 1024 + 1 }], { isCurrent: current })).kind).toBe('readonly');
    expect(port.read).not.toHaveBeenCalled();
  });

  it('uses list/read/save order and suppresses stale saves', async () => {
    const port = api(); const operations = new EditorFileOperations(port, () => true);
    const session = new EditorDocumentSession(); session.open('a.txt', 'old', { modified: '1', size: 3 }); session.edit('new');
    await operations.checkAndSave(session.snapshot(), 'new', { isCurrent: current }, { confirm: vi.fn() });
    expect(port.list.mock.invocationCallOrder[0]).toBeLessThan(port.read.mock.invocationCallOrder[0]!);
    expect(port.read.mock.invocationCallOrder[0]).toBeLessThan(port.save.mock.invocationCallOrder[0]!);
    const stale = await operations.checkAndSave(session.snapshot(), 'new', { isCurrent: () => false }, { confirm: vi.fn() });
    expect(stale).toEqual({ kind: 'stale' });
  });

  it('rejects metadata, content, missing alias, and create races', async () => {
    const port = api([{ path: 'a.txt', modified: 'changed', size: 3 }]); const operations = new EditorFileOperations(port, () => true);
    const session = new EditorDocumentSession(); session.open('a.txt', 'old', { modified: '1', size: 3 });
    await expect(operations.checkAndSave(session.snapshot(), 'new', { isCurrent: current }, { confirm: vi.fn() })).rejects.toThrow('changed on the node');
    port.list.mockResolvedValueOnce([]).mockResolvedValueOnce([{ path: 'A.TXT' }]);
    await expect(operations.checkAndSave(session.snapshot(), 'new', { isCurrent: current }, { confirm: vi.fn(async () => true) })).rejects.toThrow('alias');
    port.list.mockResolvedValueOnce([]).mockResolvedValueOnce([{ path: 'new.txt' }]);
    await expect(operations.createOrUpload('new.txt', async () => 'x', { isCurrent: current }, { confirm: vi.fn() })).rejects.toThrow('created on the node');
  });

  it('checks delete content before exact delete transport', async () => {
    const port = api(); const operations = new EditorFileOperations(port, () => true);
    const session = new EditorDocumentSession(); session.open('a.txt', 'old', { modified: '1', size: 3 });
    await operations.checkAndDelete(session.snapshot(), { isCurrent: current });
    expect(port.delete).toHaveBeenCalledWith('a.txt', undefined);
  });

  it('returns created versus overwritten payloads and preserves exact race wording', async () => {
    const port = api([]); const operations = new EditorFileOperations(port, () => true);
    const created = await operations.createOrUpload('new.txt', async () => 'new', { isCurrent: current }, { confirm: vi.fn() });
    expect(created).toEqual({ kind: 'created', path: 'new.txt', content: 'new' });
    port.list.mockReset()
      .mockResolvedValueOnce([{ path: 'a.txt', modified: '1', size: 3 }])
      .mockResolvedValueOnce([]);
    await expect(operations.createOrUpload('a.txt', async () => 'new', { isCurrent: current }, { confirm: vi.fn(async () => true) })).rejects.toThrow('Review the file list and try again.');
    port.list.mockReset()
      .mockResolvedValueOnce([{ path: 'a.txt', modified: '1', size: 3 }])
      .mockResolvedValueOnce([{ path: 'a.txt', modified: '2', size: 3 }]);
    await expect(operations.createOrUpload('a.txt', async () => 'new', { isCurrent: current }, { confirm: vi.fn(async () => true) })).rejects.toThrow('Review it before overwriting.');
  });

  it('passes the supplied signal through list, read, save, and delete in order', async () => {
    const port = api(); const operations = new EditorFileOperations(port, () => true); const signal = new AbortController().signal;
    const session = new EditorDocumentSession(); session.open('a.txt', 'old', { modified: '1', size: 3 }); session.edit('new');
    await operations.checkAndSave(session.snapshot(), 'new', { signal, isCurrent: current }, { confirm: vi.fn() });
    expect(port.list).toHaveBeenCalledWith(signal);
    expect(port.read).toHaveBeenCalledWith('a.txt', signal, 1024 * 1024);
    expect(port.save).toHaveBeenCalledWith('a.txt', 'new', signal);
    await operations.checkAndDelete(session.snapshot(), { signal, isCurrent: current });
    expect(port.delete).toHaveBeenCalledWith('a.txt', signal);
  });
});
