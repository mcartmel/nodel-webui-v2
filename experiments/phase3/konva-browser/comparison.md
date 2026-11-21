# Phase 3 optimized Konva comparison

## Method and boundaries

Measured the retained experiment-only `shadowForStrokeEnabled: false` change for graphs larger than nine nodes. The nine-node default still omits that attribute. Optimized cold benchmark used the unchanged `experiments/konva-browser/benchmark.mjs`, copied byte-for-byte to a temporary same-depth path so its `../../package-lock.json` and Node module lookup resolve to the repository while its default `results.json` and `report.md` cannot overwrite baseline files. Completed outputs were copied into this phase3 directory. Static page built with `npm run build:experiment:konva`, served from `127.0.0.1:4179`; command was `KONVA_EXPERIMENT_URL=http://127.0.0.1:4179 KONVA_BENCH_REPEATS=3 node <temporary-runner>/benchmark.mjs`. Same 1366×768 DPR1, headless Chromium 159.0.8154.6, fresh contexts, cold navigation, REST/external request blocking and three counterbalanced runs as baseline. Baseline source: `a07bb09ea6d2d0214a7bf667c4d566558de7ab9f`.

## Cold benchmark, three repeats

Values are the benchmark's median of per-run values (ms except heap MiB). Frame-gap is the median of the three run-level rAF p95 values. Idle task CPU is CDP `TaskDuration`; idle process CPU is summed Chrome process CPU. Heap is the absolute post-forced-GC JS heap, initial → after gestures.

| Nodes | Cold render-ready p50 baseline → optimized | Gesture frame-gap p95 baseline → optimized | Idle task CPU ms baseline → optimized | Idle Chrome-process CPU ms baseline → optimized | Post-GC JS heap MiB baseline → optimized |
|---:|---:|---:|---:|---:|---:|
| 9 | 443.86 → 439.98 | 166.7 → 166.7 | 0.29 → 0.35 | 0 → 30 | 3.36→3.74 → 3.36→3.74 |
| 50 | 1728.79 → 211.74 | 883.3 → 16.7 | 0.38 → 5.53 | 0 → 10 | 5.64→5.84 → 5.43→5.83 |
| 150 | 4852.52 → 273.68 | 2633.3 → 33.4 | 0.37 → 5.56 | 10 → 10 | 10.36→10.57 → 10.15→10.56 |
| 450 | 11781.90 → 503.25 | 5433.2 → 66.7 | 0.39 → 0.39 | 10 → 0 | 24.34→24.70 → 24.13→24.66 |

There is no idle-workload change in the candidate, and idle values vary in ways that expose substantial measurement/environment noise; do not interpret tiny CPU or heap differences as an optimization effect. The nine-node render-ready result is effectively unchanged (443.86 ms baseline versus 439.98 ms optimized, a 0.9% difference). With three samples per size and runs at different times, neither this small delta nor the large-count direction establishes statistical significance or causation.

## Same-instrumentation profile, one pass

One light-theme full-graph run at each size, using the Phase 1 in-memory profile transform/instrumentation and pointer scenarios. Times are instrumented wall ms. `Create` is synchronous initialization completion. Drag/Pan/Zoom are separate verified interaction action-dispatch wall spans: they include Playwright input dispatch and browser event handling, and are **not** input-to-paint latency or a frame-latency measurement. These are diagnostic single-run measurements, not the three-repeat uninstrumented benchmark. Hit-query totals are omitted because profiler/wrapper overhead makes those measurements contaminated.

| Nodes | Create ms baseline → optimized | Drag dispatch/action wall ms baseline → optimized | Pan dispatch/action wall ms baseline → optimized | Zoom dispatch/action wall ms baseline → optimized |
|---:|---:|---:|---:|---:|
| 9 | 18.4 → 14.5 | 2194.9 → 2159.1 | 1828.3 → 1849.3 | 52.7 → 21.9 |
| 50 | 42.2 → 23.9 | 12335.3 → 348.9 | 9937.1 → 194.0 | 31.3 → 38.9 |
| 150 | 52.3 → 48.4 | 35115.0 → 442.0 | 29516.5 → 514.2 | 40.6 → 40.0 |
| 450 | 100.7 → 96.9 | 71948.6 → 960.7 | 61201.8 → 732.0 | 55.9 → 49.0 |

### Synchronous layer-scene draw buckets during each gesture

For each interaction, these totals are the sum of the instrumented `wires:scene` and `cards:scene` elapsed buckets recorded in that interaction phase (`drawScene` wrapper time). The values are synchronous JS/Konva layer-scene submission time, not GPU raster or input-to-paint latency. They exclude hit-draw buckets and action-dispatch wall time. These are matched baseline/optimized light-theme full-graph single-pass profile rows for all sizes.

| Nodes | Drag layer scene ms baseline → optimized | Pan layer scene ms baseline → optimized | Zoom layer scene ms baseline → optimized |
|---:|---:|---:|---:|
| 9 | 202.5 → 165.6 | 169.0 → 170.6 | 23.1 → 14.8 |
| 50 | 12124.4 → 91.5 | 9774.7 → 55.1 | 900.0 → 10.9 |
| 150 | 34893.0 → 193.4 | 29308.9 → 223.1 | 2673.3 → 19.1 |
| 450 | 71658.3 → 531.0 | 60933.6 → 395.4 | 5504.4 → 29.2 |

At 450 nodes the optimized profile still counted 36 `updateWireGeometry` calls totaling 1.1 ms, versus 1.4 ms baseline; geometry is not the primary drag cost. The candidate primarily bypasses the Konva buffer path for the card's stroke shadow, consistent with the large drawing/gesture difference. Profile values are intrusive: CDP CPU sampling, JS wrappers, and extremely slow canvas shadow operations affect wall timings. They are not commensurate with the non-instrumented benchmark. `drawScene`/`drawHit` values measure JS/Konva submission, not GPU raster; heap is renderer JS heap, not GPU/canvas allocation. Visible RGBA canvas backing is only a lower bound and must not be conflated with process heap or GPU memory.

## Checks and artifacts

- Optimized benchmark: `optimized-results.json` (12 successful runs, no failures); profile: `optimized-profile-results.json` and `optimized-profile-evidence/`.
- Original `benchmark.mjs`, baseline `report.md`, `results.json`, `profile-results.json`, and `profile-evidence/` were retained. Artifact provenance includes exact source, runner, and lockfile SHA-256 fingerprints.
- `npm run build:experiment:konva` passed; final `npm run build` was run after profiling (see task result for its gate status).
- Source inspection confirms the conditional `nodes.length > 9` and no property for nine nodes. The isolated Vite config builds only `build/experiments/konva-canvas/topology-canvas.html`; production inclusion/exclusion is checked by final build outputs.
- Tiny sample counts and profile instrumentation limit inference; no process-CPU/GPU or compositor attribution is claimed.

## Safe executable reproduction

Prerequisites: run from this repository with Node/npm dependencies installed from the existing `package-lock.json`, Playwright's Chromium 159.0.8154.6 available, and an unused loopback port (default 4179; override with `KONVA_PREVIEW_PORT`). Reproduce using `experiments/phase3/konva-browser/reproduce-benchmark.sh [new-output-directory-name]`. It verifies the recorded candidate-source and stock-runner fingerprints before benchmarking, builds only the isolated Konva fixture, starts a loopback-only static preview, copies the stock runner unchanged under a temporary repository-root sibling at the matching directory depth, and copies results/report only after successful completion into a new non-overwriting directory under `experiments/phase3/konva-browser/`. It removes its temporary runner and preview on exit and removes the output directory if the run fails. The default output name is timestamped. No performance run was repeated during this validation.
