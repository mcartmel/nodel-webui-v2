import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const importPattern = /^@import\s+['"](.+?)['"];\s*$/gm;

export async function readStyleSource(path = resolve(process.cwd(), 'src/styles.css')): Promise<string> {
  const source = await readFile(path, 'utf8');
  const imports = Array.from(source.matchAll(importPattern));
  if (imports.length === 0) {
    return source;
  }

  const imported = await Promise.all(imports.map((match) => {
    const importPath = match[1];
    if (importPath === undefined) {
      throw new Error(`Invalid stylesheet import in ${path}`);
    }
    return readStyleSource(resolve(dirname(path), importPath));
  }));
  return `${source}\n${imported.join('\n')}`;
}
