#!/usr/bin/env bash
set -euo pipefail

# Reproduce the optimized, uninstrumented benchmark while keeping the stock
# runner's results.json/report.md away from experiments/konva-browser originals.
ROOT="$(git rev-parse --show-toplevel)"
OUT_NAME="${1:-reproduction-$(date -u +%Y%m%dT%H%M%SZ)}"
if [[ "$OUT_NAME" == */* || "$OUT_NAME" == "." || "$OUT_NAME" == ".." ]]; then
  printf 'Output name must be one directory name, got: %s\n' "$OUT_NAME" >&2
  exit 2
fi
OUT_DIR="$ROOT/experiments/phase3/konva-browser/$OUT_NAME"
if [[ -e "$OUT_DIR" ]]; then
  printf 'Refusing to overwrite existing output: %s\n' "$OUT_DIR" >&2
  exit 2
fi
if [[ ! -f "$ROOT/package-lock.json" || ! -d "$ROOT/node_modules" ]]; then
  printf 'Prerequisite missing: install locked npm dependencies at %s\n' "$ROOT" >&2
  exit 2
fi
SOURCE_SHA="$(sha256sum "$ROOT/src/experiments/konva-canvas/main.ts" | cut -d ' ' -f 1)"
RUNNER_SHA="$(sha256sum "$ROOT/experiments/konva-browser/benchmark.mjs" | cut -d ' ' -f 1)"
if [[ "$SOURCE_SHA" != "8a8a3a405b2cdc800e4d22869e767797a003f6d9901a9b655ecfaab9feeecd73" ]]; then
  printf 'Candidate source fingerprint mismatch; refusing to label this as the recorded optimized experiment.\n' >&2
  exit 2
fi
if [[ "$RUNNER_SHA" != "a0ce0d2a29d58921a14b7093187071dfd8cb9f3388b1f663f5ae3b0259eb8289" ]]; then
  printf 'Stock benchmark runner fingerprint mismatch; refusing to run an unreviewed script.\n' >&2
  exit 2
fi

PORT="${KONVA_PREVIEW_PORT:-4179}"
REPEATS="${KONVA_BENCH_REPEATS:-3}"
TEMP_ROOT="$ROOT/.phase3-benchmark-$$"
TEMP_RUNNER="$TEMP_ROOT/konva-browser"
mkdir -p "$TEMP_RUNNER" "$OUT_DIR"
PREVIEW_PID=""
SUCCESS=0
cleanup() {
  if [[ -n "$PREVIEW_PID" ]]; then
    kill "$PREVIEW_PID" 2>/dev/null || true
    wait "$PREVIEW_PID" 2>/dev/null || true
  fi
  rm -rf "$TEMP_ROOT"
  if [[ "$SUCCESS" != "1" ]]; then rm -rf "$OUT_DIR"; fi
}
trap cleanup EXIT INT TERM

# This exact nesting depth makes the stock runner's ../../package-lock.json
# resolve to the repository lockfile; Node module resolution also reaches the
# repository node_modules. The stock benchmark file itself is not edited.
cp "$ROOT/experiments/konva-browser/benchmark.mjs" "$TEMP_RUNNER/benchmark.mjs"
sha256sum \
  "$ROOT/src/experiments/konva-canvas/main.ts" \
  "$ROOT/experiments/konva-browser/benchmark.mjs" \
  "$ROOT/package-lock.json" > "$OUT_DIR/source-fingerprints.sha256"
{
  printf 'repository=%s\n' "$ROOT"
  printf 'head=%s\n' "$(git -C "$ROOT" rev-parse HEAD)"
  printf 'runner=experiments/konva-browser/benchmark.mjs (copied unchanged)\n'
  printf 'source=src/experiments/konva-canvas/main.ts (current worktree candidate)\n'
  printf 'build=npm run build:experiment:konva\n'
  printf 'preview=http://127.0.0.1:%s\n' "$PORT"
  printf 'command=KONVA_EXPERIMENT_URL=http://127.0.0.1:%s KONVA_BENCH_REPEATS=%s node %s/benchmark.mjs\n' "$PORT" "$REPEATS" "$TEMP_RUNNER"
} > "$OUT_DIR/reproduction.txt"

cd "$ROOT"
npm run build:experiment:konva
npm run preview:experiment:konva -- --host 127.0.0.1 --port "$PORT" --strictPort > "$TEMP_ROOT/preview.log" 2>&1 &
PREVIEW_PID=$!
node --input-type=module - "$PORT" <<'NODE'
const port = process.argv[2];
const url = `http://127.0.0.1:${port}/topology-canvas.html`;
const deadline = Date.now() + 45_000;
while (Date.now() < deadline) {
  try {
    const response = await fetch(url);
    if (response.ok) process.exit(0);
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}
console.error(`Static preview did not become ready at ${url}`);
process.exit(1);
NODE
if ! kill -0 "$PREVIEW_PID" 2>/dev/null; then
  printf 'Preview process exited before benchmark; refusing to use any other service on the requested port.\n' >&2
  cat "$TEMP_ROOT/preview.log" >&2 || true
  exit 1
fi

KONVA_EXPERIMENT_URL="http://127.0.0.1:$PORT" KONVA_BENCH_REPEATS="$REPEATS" \
  node "$TEMP_RUNNER/benchmark.mjs"
cp "$TEMP_RUNNER/results.json" "$OUT_DIR/optimized-results.json"
cp "$TEMP_RUNNER/report.md" "$OUT_DIR/report.md"
SUCCESS=1
printf 'Complete benchmark results copied to %s\n' "$OUT_DIR"
