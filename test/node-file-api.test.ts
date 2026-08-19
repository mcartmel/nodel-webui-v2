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
import { copyNodeFileReadCapability, MAX_NODE_FILE_PATH_LENGTH, canonicalNodeFilePath, portableNodeFilePathKey } from '../src/utils/node-file-path';

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected test value to be present');
  }
  return value;
}

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
    await expect(listNodeFiles()).resolves.toEqual([{ path: 'script.py', compatibility: 'portable' }]);
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

  it('discovers safe custom UI files while retaining explicit exclusions', () => {
    expect(customUiEntriesFromFiles([
      { path: 'content/panel.xml' },
      { path: 'content/custom.html' },
      { path: 'content/index.html' },
      { path: 'content/index.htm' },
      { path: 'content/nodes.xml' },
      { path: 'content/index-sample.xml' },
      { path: 'content/index-sample.xml.htm' },
      { path: 'content/my-ui.html' },
      { path: 'content/room controls.html' },
      { path: 'content/展示.html' },
      { path: 'content/deep/panel.html' },
      { path: 'script.py' }
    ])).toEqual([
      { href: 'custom.html', path: 'content/custom.html', title: 'custom.html' },
      { href: 'deep/panel.html', path: 'content/deep/panel.html', title: 'deep/panel.html' },
      { href: 'index.html', path: 'content/index.html', title: 'index.html' },
      { href: 'my-ui.html', path: 'content/my-ui.html', title: 'my-ui.html' },
      { href: 'panel.xml', path: 'content/panel.xml', title: 'panel.xml' },
      { href: 'room%20controls.html', path: 'content/room controls.html', title: 'room controls.html' },
      { href: '%E5%B1%95%E7%A4%BA.html', path: 'content/展示.html', title: '展示.html' }
    ]);
  });

  it('does not turn legacy custom UI names into navigation routes', () => {
    const entries = customUiEntriesFromFiles([
      { path: 'content/safe%2e%2e.html' },
      { path: 'content/safe#fragment.html' },
      { path: 'content/legacy?query.html', compatibility: 'legacy' },
      { path: 'content/legacy#fragment.html', compatibility: 'legacy' },
      { path: 'content/legacy:stream.html', compatibility: 'legacy' },
      { path: 'content/legacy\\route.html', compatibility: 'legacy' }
    ]);

    expect(entries).toEqual([
      { href: 'safe%23fragment.html', path: 'content/safe#fragment.html', title: 'safe#fragment.html' },
      { href: 'safe%252e%252e.html', path: 'content/safe%2e%2e.html', title: 'safe%2e%2e.html' }
    ]);
    expect(entries.some((entry) => /(?:\?|#|%2e%2e|:|\\)/i.test(entry.href))).toBe(false);
  });

  it('excludes resolver-reserved custom UI routes even below a static suffix', () => {
    expect(customUiEntriesFromFiles([
      { path: 'content/REST/restart/.html' },
      { path: 'content/rest/panel.html' },
      { path: 'content/safe/panel.html' }
    ])).toEqual([
      { href: 'safe/panel.html', path: 'content/safe/panel.html', title: 'safe/panel.html' }
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

  it('reads exact decoded legacy entries but never mutates or reads arbitrary legacy strings', async () => {
    const legacyPath = 'content/legacy:back\\line\nname.txt';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'REST/files') {
        return new Response(JSON.stringify([{ path: legacyPath }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === `REST/files/contents?path=${encodeURIComponent(legacyPath)}`) {
        return new Response('legacy text', { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const [entry] = await listNodeFiles();
    expect(entry).toMatchObject({ path: legacyPath, compatibility: 'legacy' });
    await expect(getNodeFileContents(required(entry))).resolves.toBe('legacy text');
    expect(fetchMock).toHaveBeenCalledWith(`REST/files/contents?path=content%2Flegacy%3Aback%5Cline%0Aname.txt`, expect.any(Object));

    fetchMock.mockClear();
    await expect(getNodeFileContents(legacyPath)).rejects.toThrow('not portable');
    await expect(getNodeFileContents({ path: legacyPath, compatibility: 'legacy' })).rejects.toThrow('exact listed entry');
    await expect(saveNodeFile(legacyPath, 'changed')).rejects.toThrow('not portable');
    await expect(deleteNodeFile(legacyPath)).rejects.toThrow('not portable');
    for (const path of ['../secret.txt', '..\\secret.txt', '/absolute.txt', '\\absolute.txt', 'C:x', '\\\\server\\share', 'bad\u0000name.txt']) {
      await expect(getNodeFileContents(path)).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects mutable or copied legacy read capabilities before requesting', async () => {
    const legacyPath = 'content/legacy:entry.txt';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === 'REST/files') {
        return new Response(JSON.stringify([{ path: legacyPath }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (String(input) === `REST/files/contents?path=${encodeURIComponent(legacyPath)}`) {
        return new Response('legacy text', { status: 200 });
      }
      throw new Error(`Unexpected URL ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const [entry] = await listNodeFiles();

    const listedEntry = required(entry);
    expect(Object.isFrozen(listedEntry)).toBe(true);
    expect(() => { (listedEntry as { path: string }).path = 'content/retargeted.txt'; }).toThrow();
    expect(() => copyNodeFileReadCapability(listedEntry, { path: 'content/retargeted.txt', compatibility: 'legacy' })).toThrow('cannot be copied');
    const copied = copyNodeFileReadCapability(listedEntry, { ...listedEntry });
    expect(Object.isFrozen(copied)).toBe(true);
    await expect(getNodeFileContents(copied)).resolves.toBe('legacy text');
    fetchMock.mockClear();
    await expect(getNodeFileContents({ ...listedEntry })).rejects.toThrow('exact listed entry');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists unpaired-surrogate paths but never grants them a read or mutation request', async () => {
    const path = 'content/unsafe\ud800name.html';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === 'REST/files') {
        return new Response(JSON.stringify([{ path }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected URL ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const [entry] = await listNodeFiles();
    expect(entry).toMatchObject({ path, compatibility: 'legacy' });
    const listedEntry = required(entry);
    expect(customUiEntriesFromFiles([listedEntry])).toEqual([]);
    await expect(getNodeFileContents(listedEntry)).rejects.toThrow('not portable');
    await expect(saveNodeFile(path, 'changed')).rejects.toThrow('not portable');
    await expect(deleteNodeFile(path)).rejects.toThrow('not portable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects script aliases and generic script deletion before requesting', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const alias of ['Script.py', 'SCRIPT.PY']) {
      await expect(saveNodeFile(alias, 'unsafe')).rejects.toThrow('Case-only script.py aliases');
      await expect(deleteNodeFile(alias)).rejects.toThrow('script.py and case-only aliases');
    }
    await expect(deleteNodeFile('script.py')).rejects.toThrow('script.py and case-only aliases');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
