import {
  deleteNodeFile,
  getNodeFileContents,
  listNodeFiles,
  saveNodeFile
} from '../src/api/nodel-host-client';
import { languageKindForPath, validateNodeFilePath } from '../src/editor/file-types';

describe('node file api and utilities', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'REST/files') {
        return new Response(JSON.stringify([{ path: 'script.py' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.startsWith('REST/files/contents')) {
        return new Response('print("hello")', { status: 200 });
      }

      if (url === 'REST/script/save') {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ script: 'print("updated")' }));
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (url.startsWith('REST/files/save')) {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({ 'Content-Type': 'application/octet-stream' });
        expect(init?.body).toBe('<nodel-app></nodel-app>');
        return new Response('', { status: 200 });
      }

      if (url.startsWith('REST/files/delete')) {
        return new Response('', { status: 200 });
      }

      throw new Error(`Unexpected URL ${url}`);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses relative node file endpoints', async () => {
    await expect(listNodeFiles()).resolves.toEqual([{ path: 'script.py' }]);
    await expect(getNodeFileContents('script.py')).resolves.toBe('print("hello")');
    await expect(saveNodeFile('script.py', 'print("updated")')).resolves.toEqual({});
    await expect(saveNodeFile('content/index.html', '<nodel-app></nodel-app>')).resolves.toBe('');
    await expect(deleteNodeFile('content/index.html')).resolves.toBe('');

    expect(fetch).toHaveBeenCalledWith('REST/files', undefined);
    expect(fetch).toHaveBeenCalledWith('REST/files/contents?path=script.py', undefined);
    expect(fetch).toHaveBeenCalledWith('REST/files/delete?path=content%2Findex.html', undefined);
  });

  it('validates node file paths and maps languages', () => {
    expect(validateNodeFilePath('content/index.html')).toBe('');
    expect(validateNodeFilePath('script.py')).toBe('');
    expect(validateNodeFilePath('')).toContain('required');
    expect(validateNodeFilePath('/absolute.py')).toContain('relative');
    expect(validateNodeFilePath('../secret.py')).toContain('parent-directory');
    expect(validateNodeFilePath('bad.exe/')).toContain('empty');
    expect(validateNodeFilePath('bad.nope')).toContain('extension');
    expect(languageKindForPath('script.py')).toBe('python');
    expect(languageKindForPath('content/index.html')).toBe('html');
  });
});
