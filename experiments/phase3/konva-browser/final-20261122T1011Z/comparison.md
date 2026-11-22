# Final stock Konva benchmark comparison

This run used the unchanged stock `experiments/konva-browser/benchmark.mjs` against the current working-tree Konva experiment source. It used Chromium 159.0.8154.6, 1366x768, DPR 1, three fresh-context repeats, cold navigations, and a loopback-only static preview. REST and external requests were blocked. The current source fingerprint is in `source-fingerprints.sha256`; prior benchmark outputs were not overwritten.

## Current run and comparison

Render and gesture-frame values are p50 ms, as reported by the stock runner. Percentages compare current render-ready p50 with the previous isolated optimized run (`experiments/phase3/konva-browser/optimized-results.json`). Render ratio is previous/current; a ratio above 1 means the current run rendered faster. These are separate three-sample runs, not a statistically controlled paired test.

| Nodes | Edges | Current render-ready p50/p95 ms | Previous optimized p50 ms | Previous/current render ratio | Current gesture frame p95/max ms | Current post-GC JS heap MiB, initial → after gestures |
|---:|---:|---:|---:|---:|---:|---:|
| 9 | 14 | 439.67 / 473.57 | 439.98 | 1.00x | 166.7 / 183.3 | 3.41 → 3.80 |
| 50 | 77 | 187.34 / 212.48 | 211.74 | 1.13x | 16.8 / 16.8 | 5.46 → 5.87 |
| 150 | 232 | 270.68 / 290.33 | 273.68 | 1.01x | 33.4 / 33.4 | 10.19 → 10.61 |
| 450 | 700 | 523.56 / 525.62 | 503.25 | 0.96x | 66.8 / 66.8 | 24.26 → 24.80 |

Against the older unoptimized stock baseline (`experiments/konva-browser/results.json`), render-ready p50 changed 443.86 → 439.67 ms at 9 nodes (1.01x), 1,728.79 → 187.34 ms at 50 (9.23x), 4,852.52 → 270.68 ms at 150 (17.93x), and 11,781.90 → 523.56 ms at 450 (22.51x). Large-count differences are consistent with the retained stroke-shadow optimization but do not prove causation across runs. The latest run's 9-node gesture included a long scheduling outlier; see the raw result and stock report for complete metrics and sample distributions.

## Verification

- Stock benchmark: 12/12 samples passed; no failed samples. The unmodified runner was copied byte-for-byte to a temporary path, then removed after results were retained here.
- Isolated browser suite: 8/8 tests passed across 1366x768 and 1920x1080. Playwright output: `artifacts/konva-final-browser-results/`; screenshots: ignored `build/konva-evidence/`.
- `npm run build`: passed lint, typecheck, JsViews compliance, 2,048 tests across 159 test files, production Vite build, release gate, and review-impact verification. Vite emitted the existing unresolved `new URL("../nodel-icons.json", import.meta.url)` warning.
- Production isolation: `dist/` contains the standard public entries and `v2/`; no `topology-canvas` or Konva artifacts were found by path or content search. The isolated page exists only under ignored `build/experiments/konva-canvas/`.
- No source files were edited for this task. No live Nodel host, deployment, or commit was used.
