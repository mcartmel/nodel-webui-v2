#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
artifact_root="$repo_root/artifacts/konva-local/port-window/benchmark"
build_root="$(mktemp -d /tmp/kilo/port-window-builds.XXXXXXXX)"

for mode in chooser B C D; do
  output="$build_root/$mode"
  echo "Building current source mode=$mode output=$output"
  KONVA_PORT_WINDOW_MODE="$mode" npm run build:experiment:konva -- --outDir "$output" --emptyOutDir
done

node --input-type=module - "$repo_root" "$artifact_root" "$build_root" <<'NODE'
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const [repo, output, buildRoot] = process.argv.slice(2);
const modes = ['chooser', 'B', 'C', 'D'];
const files = {};
async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const absolute = resolve(current, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(root, absolute));
    else result.push(absolute.slice(root.length + 1));
  }
  return result.sort();
}
for (const mode of modes) {
  const root = resolve(buildRoot, mode);
  files[mode] = {};
  for (const path of await listFiles(root)) files[mode][path] = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
}
const frozenRoot = '/tmp/kilo/konva-pre-scroll-baseline';
const frozenFiles = {};
for (const path of await listFiles(frozenRoot)) frozenFiles[path] = createHash('sha256').update(await readFile(resolve(frozenRoot, path))).digest('hex');
const sourcePaths = ['src/experiments/konva-canvas/main.ts', 'src/experiments/konva-canvas/card-footprint.ts', 'src/experiments/konva-canvas/port-wheel.ts', 'src/experiments/konva-canvas/fixture.ts', 'vite.konva.config.ts'];
const sourceHashes = {};
for (const path of sourcePaths) sourceHashes[path] = createHash('sha256').update(await readFile(resolve(repo, path))).digest('hex');
const manifest = { createdAt: new Date().toISOString(), gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), sourcePaths, sourceHashes,
  frozenReference: { path: frozenRoot, builtAt: 'frozen before row/window scroll modes', files: frozenFiles },
  buildRoot, buildCommand: 'bash experiments/konva-browser/build-port-window-candidates.sh',
  currentCandidateFilesSha256: files };
await writeFile(resolve(output, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
NODE
