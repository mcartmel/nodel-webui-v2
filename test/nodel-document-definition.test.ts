import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { nodelDocumentElements, completeNodelDocument } from '../src/editor/nodel-document-definition';

function fakeCompletionContext(text: string, explicit = true) {
  return {
    pos: text.length,
    explicit,
    state: {
      sliceDoc(from: number, to: number) {
        return text.slice(from, to);
      }
    },
    matchBefore(pattern: RegExp) {
      const match = text.match(pattern);
      if (!match || match.index === undefined || match.index + match[0].length !== text.length) {
        return null;
      }
      return { from: match.index, to: text.length, text: match[0] };
    }
  };
}

describe('nodel document definition', () => {
  it('includes custom layout elements and completions', () => {
    const names = nodelDocumentElements.map((element) => element.name);
    expect(names).toEqual(expect.arrayContaining(['nodel-app', 'nodel-page', 'nodel-row', 'nodel-column', 'nodel-console', 'nodel-log', 'nodel-params', 'nodel-editor']));

    const nodeList = nodelDocumentElements.find((element) => element.name === 'nodel-node-list');
    expect(nodeList?.attributes.find((attribute) => attribute.name === 'scope')?.values).toEqual(['local', 'network']);

    const completions = completeNodelDocument(fakeCompletionContext('<nodel-node-list scope="') as never);
    expect(completions?.options.map((option) => option.label)).toEqual(expect.arrayContaining(['local', 'network']));
  });

  it('has document-definition entries for public main imports', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const importedComponents = Array.from(source.matchAll(/\.\/components\/(nodel-[^']+)'/g)).map((match) => match[1]);
    const definedComponents = new Set(nodelDocumentElements.map((element) => element.name));

    expect(importedComponents.length).toBeGreaterThan(0);
    expect(importedComponents.filter((name) => !definedComponents.has(name))).toEqual([]);
  });
});
