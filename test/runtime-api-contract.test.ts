import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : Promise.resolve(entry.name.endsWith('.ts') ? [path] : []);
  }));
  return files.flat();
}

describe('runtime API contract', () => {
  it('does not reintroduce the unsupported generic feature endpoint', async () => {
    const endpoint = ['', 'REST', 'capabilities'].join('/');
    const files = await sourceFiles(join(process.cwd(), 'src'));
    const matches: string[] = [];

    for (const file of files) {
      if ((await readFile(file, 'utf8')).includes(endpoint)) {
        matches.push(file);
      }
    }

    expect(matches).toEqual([]);
  });
});
