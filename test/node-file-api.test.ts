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

    expect(fetch).toHaveBeenCalledWith('REST/files', undefined);
    expect(fetch).toHaveBeenCalledWith('REST/', undefined);
    expect(fetch).toHaveBeenCalledWith('REST/files/contents?path=script.py', undefined);
    expect(fetch).toHaveBeenCalledWith('REST/files/delete?path=content%2Findex.html', undefined);
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
    expect(validateNodeFilePath('bad.exe/')).toContain('empty');
    expect(validateNodeFilePath('bad.nope')).toContain('extension');
    expect(languageKindForPath('script.py')).toBe('python');
    expect(languageKindForPath('content/index.html')).toBe('html');
    expect(languageKindForPath('content/icon.svg')).toBe('xml');
    expect(languageKindForPath('config/settings.yaml')).toBe('plain');
    expect(isEditableFile('content/icon.svg')).toBe(true);
    expect(isBinaryFile('content/icon.svg')).toBe(false);
    expect(isEditableFile('config/settings.yaml')).toBe(true);
    expect(isEditableFile('data/table.csv')).toBe(true);
    expect(isBinaryFile('docs/manual.pdf')).toBe(true);
    expect(isBinaryFile('content/hero.webp')).toBe(true);
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
});
