import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

const root = resolve(import.meta.dirname, '..', 'e2e');
const removedThemeColours = new Map([
  ['241 245 249', [241, 245, 249]],
  ['15 23 42', [15, 23, 42]],
  ['203 213 225', [203, 213, 225]],
  ['2 6 23', [2, 6, 23]],
  ['51 65 85', [51, 65, 85]],
  ['226 232 240', [226, 232, 240]]
]);
const minimumCandidatePixels = 32;

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const failures = [];
for (const path of walk(root).filter((candidate) => /-linux\.png$/.test(candidate))) {
  const png = PNG.sync.read(readFileSync(path));
  const counts = new Map([...removedThemeColours.keys()].map((colour) => [colour, 0]));
  for (let offset = 0; offset < png.data.length; offset += 4) {
    for (const [colour, channels] of removedThemeColours) {
      if (png.data[offset + 3] === 255 && channels.every((channel, index) => png.data[offset + index] === channel)) {
        counts.set(colour, counts.get(colour) + 1);
      }
    }
  }
  const suspicious = [...counts].filter(([, count]) => count >= minimumCandidatePixels);
  if (suspicious.length > 0) failures.push({ path: path.slice(root.length + 1), colours: Object.fromEntries(suspicious) });
}

if (failures.length > 0) {
  console.error(JSON.stringify({
    note: 'Candidates require visual review; matching opaque RGB values do not prove that a baseline is stale.',
    minimumCandidatePixels,
    baselineCandidates: failures
  }, null, 2));
  process.exitCode = 1;
} else {
  console.log(`No removed-theme colour candidates repeated ${minimumCandidatePixels} or more opaque pixels.`);
}
