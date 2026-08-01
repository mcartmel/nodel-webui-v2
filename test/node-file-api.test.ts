import {
  customUiEntriesFromFiles,
  deleteNodeFile,
  getNodeDetails,
  getNodeFileContents,
  listNodeFiles,
  removeCurrentNode,
  renameCurrentNode,
  restartCurrentNode,
  saveNodeFile
} from '../src/api/nodel-host-client';
import { isBinaryFile, isEditableFile, languageKindForPath, validateNodeFilePath } from '../src/editor/file-types';
import { MAX_NODE_FILE_PATH_LENGTH, canonicalNodeFilePath, portableNodeFilePathKey } from '../src/utils/node-file-path';

describe('node file api and utilities', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'REST/') {
        return new Response(JSON.stringify({ name: 'Test Node', desc: '**Description**' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

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

      if (url === 'REST/rename') {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
        expect(init?.body).toBe(JSON.stringify({ value: 'Renamed Node' }));
        return new Response('', { status: 200 });
      }

      if (url === 'REST/restart') {
        return new Response('', { status: 200 });
      }

      if (url === 'REST/remove?confirm=true') {
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
    await expect(getNodeDetails()).resolves.toEqual({ name: 'Test Node', desc: '**Description**' });
    await expect(getNodeFileContents('script.py')).resolves.toBe('print("hello")');
    await expect(saveNodeFile('script.py', 'print("updated")')).resolves.toEqual({});
    await expect(saveNodeFile('content/index.html', '<nodel-app></nodel-app>')).resolves.toBe('');
    await expect(deleteNodeFile('content/index.html')).resolves.toBe('');
    await expect(renameCurrentNode('Renamed Node')).resolves.toBe('');
    await expect(restartCurrentNode()).resolves.toBe('');
    await expect(removeCurrentNode()).resolves.toBe('');

    expect(fetch).toHaveBeenCalledWith('REST/files', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetch).toHaveBeenCalledWith('REST/', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetch).toHaveBeenCalledWith('REST/files/contents?path=script.py', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetch).toHaveBeenCalledWith('REST/files/delete?path=content%2Findex.html', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('validates node file paths and maps languages', () => {
    expect(validateNodeFilePath('content/index.html')).toBe('');
    expect(validateNodeFilePath('script.py')).toBe('');
    expect(validateNodeFilePath('content/icon.svg')).toBe('');
    expect(validateNodeFilePath('config/settings.yaml')).toBe('');
    expect(validateNodeFilePath('config/settings.yml')).toBe('');
    expect(validateNodeFilePath('config/app.properties')).toBe('');
    expect(validateNodeFilePath('logs/node.log')).toBe('');
    expect(validateNodeFilePath('data/table.csv')).toBe('');
    expect(validateNodeFilePath('content/photo.jpeg')).toBe('');
    expect(validateNodeFilePath('content/animation.gif')).toBe('');
    expect(validateNodeFilePath('content/hero.webp')).toBe('');
    expect(validateNodeFilePath('docs/manual.pdf')).toBe('');
    expect(validateNodeFilePath('')).toContain('required');
    expect(validateNodeFilePath('/absolute.py')).toContain('relative');
    expect(validateNodeFilePath('../secret.py')).toContain('parent-directory');
    expect(validateNodeFilePath('content/./secret.py')).toContain('current-directory');
    expect(validateNodeFilePath('content/line\nbreak.py')).toContain('unsupported');
    expect(validateNodeFilePath('C:/outside.py')).toContain('unsupported');
    expect(validateNodeFilePath('content/script.py:stream')).toContain('unsupported');
    expect(validateNodeFilePath(' content/index.html')).toContain('whitespace');
    expect(validateNodeFilePath('content/index.html ')).toContain('whitespace');
    expect(validateNodeFilePath('content/CON.txt')).toContain('unsupported');
    expect(validateNodeFilePath('content/name.')).toContain('unsupported');
    expect(validateNodeFilePath('content/a?.txt')).toContain('unsupported');
    expect(validateNodeFilePath('content/a*.txt')).toContain('unsupported');
    expect(validateNodeFilePath('content/a|b.txt')).toContain('unsupported');
    expect(validateNodeFilePath(`content/${'a'.repeat(256)}.txt`)).toContain('unsupported');
    expect(validateNodeFilePath(`content/${'é'.repeat(128)}.txt`)).toContain('unsupported');
    expect(validateNodeFilePath(Array.from({ length: 5 }, () => `${'é'.repeat(120)}.txt`).join('/'))).toContain('unsupported');
    expect(validateNodeFilePath('content／index.html')).toContain('unsupported');
    expect(validateNodeFilePath(`content/${'a'.repeat(MAX_NODE_FILE_PATH_LENGTH)}.txt`)).toContain('unsupported');
    expect(validateNodeFilePath('content/cafe\u0301.txt')).toContain('unsupported');
    expect(validateNodeFilePath('bad.exe/')).toContain('empty');
    expect(validateNodeFilePath('bad.nope')).toContain('extension');
    expect(languageKindForPath('script.py')).toBe('python');
    expect(languageKindForPath('content/index.html')).toBe('html');
    expect(languageKindForPath('content/icon.svg')).toBe('xml');
    expect(languageKindForPath('src/Example.java')).toBe('java');
    expect(languageKindForPath('scripts/build.groovy')).toBe('groovy');
    expect(languageKindForPath('db/query.sql')).toBe('sql');
    expect(languageKindForPath('scripts/deploy.sh')).toBe('shell');
    expect(languageKindForPath('config/settings.yaml')).toBe('plain');
    expect(isEditableFile('content/icon.svg')).toBe(true);
    expect(isBinaryFile('content/icon.svg')).toBe(false);
    expect(isEditableFile('config/settings.yaml')).toBe(true);
    expect(isEditableFile('data/table.csv')).toBe(true);
    expect(isBinaryFile('docs/manual.pdf')).toBe(true);
    expect(isBinaryFile('content/hero.webp')).toBe(true);
    expect(canonicalNodeFilePath('Content/Index.HTML')).not.toBe(canonicalNodeFilePath('content/index.html'));
    expect(portableNodeFilePathKey('Content/Index.HTML')).toBe(portableNodeFilePathKey('content/index.html'));
    expect(portableNodeFilePathKey('content/οσ.txt')).toBe(portableNodeFilePathKey('content/ος.txt'));
    expect(portableNodeFilePathKey('content/straße.txt')).toBe(portableNodeFilePathKey('content/STRASSE.txt'));
  });

  it('rejects unsafe file API paths before starting a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(getNodeFileContents('../secret.py')).rejects.toThrow('Node file path is invalid');
    await expect(saveNodeFile('content/./secret.py', 'unsafe')).rejects.toThrow('Node file path is invalid');
    await expect(deleteNodeFile('/absolute.py')).rejects.toThrow('Node file path is invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('filters custom UI files using the v1 picker rules', () => {
    expect(customUiEntriesFromFiles([
      { path: 'content/panel.xml' },
      { path: 'content/custom.html' },
      { path: 'content/index.htm' },
      { path: 'content/nodes.xml' },
      { path: 'content/index-sample.xml' },
      { path: 'content/index-sample.xml.htm' },
      { path: 'content/my-ui.html' },
      { path: 'content/deep/panel.html' },
      { path: 'script.py' }
    ])).toEqual([
      { href: 'custom.html', path: 'content/custom.html', title: 'custom.html' },
      { href: 'panel.xml', path: 'content/panel.xml', title: 'panel.xml' }
    ]);
  });

  it('bounds text reads by content length and streamed bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('123456', {
      status: 200,
      headers: { 'Content-Length': '6' }
    })));
    await expect(getNodeFileContents('script.py', undefined, 5)).rejects.toThrow('text-edit limit');

    const encoder = new TextEncoder();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('123'));
        controller.enqueue(encoder.encode('456'));
        controller.close();
      }
    }))));
    await expect(getNodeFileContents('script.py', undefined, 5)).rejects.toThrow('text-edit limit');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('12345')));
    await expect(getNodeFileContents('script.py', undefined, 5)).resolves.toBe('12345');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    await expect(getNodeFileContents('script.py', undefined, 5)).rejects.toThrow('without streaming or Content-Length');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0xff]))));
    await expect(getNodeFileContents('script.py', undefined, 5)).rejects.toThrow('not valid UTF-8');
  });

  it('rejects unsafe file sizes from the backend contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { path: 'script.py', size: 1.5 }
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    await expect(listNodeFiles()).rejects.toThrow('non-negative safe integer');
  });

  it('retains transport-safe legacy host names while create validation stays portable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { path: 'content/CON.txt' },
      { path: 'content/name.' },
      { path: 'content/cafe\u0301.txt' }
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    await expect(listNodeFiles()).resolves.toHaveLength(3);
    expect(validateNodeFilePath('content/CON.txt')).toContain('unsupported');
    expect(validateNodeFilePath('content/name.')).toContain('unsupported');
    expect(validateNodeFilePath('content/cafe\u0301.txt')).toContain('unsupported');
  });
});
