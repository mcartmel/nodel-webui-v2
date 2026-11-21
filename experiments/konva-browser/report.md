# Opt-in Konva browser benchmark

Run started 2026-11-21T04:25:03.683Z and completed 2026-11-21T04:30:17.363Z. This is an isolated static Konva canvas experiment, not the production app or a live Nodel host.

## Environment and method

- Host: VSCODE; linux 6.12.86+deb13-amd64 (x64); CPU: Intel(R) Xeon(R) W-2235 CPU @ 3.80GHz; Node v24.15.0; Playwright 1.65.1; Chrome for Testing 159.0.8154.6
- Fixed viewport: 1366x768, DPR 1, Chromium headless; 3 fresh-context repeats per size in counterbalanced cyclic order: 9/50/150/450, 50/150/450/9, 150/450/9/50. One browser/context at a time; no profiler; route interception disables HTTP cache, so each sample is a single cold navigation. No warm-HTTP claim.
- Render readiness is native scene count + both canvases + two requestAnimationFrame callbacks after DOMContentLoaded. Passive idle is 2.2 s after GC/settle; no page-side evaluation, scene snapshot or rAF sampler runs inside it. Task CPU uses CDP Performance TaskDuration; process CPU independently sums cpuTime across Chrome processes returned by SystemInfo.getProcessInfo at interval endpoints. Each is also divided by wall time for a one-core proxy; process-tree percentages can exceed 100% because Chrome processes can run concurrently on multiple cores.
- The rAF interval sampler and Long Task observer run only during actual pointer gestures; stored timestamps are clipped to that start/stop window. No full-scene enumeration occurs during the gesture. Small start/stop hooks record achieved drag, pan and zoom. Heap columns are absolute `performance.memory.usedJSHeapSize` after explicit CDP GC before idle and after gestures.
- Canvas backing RGBA bytes are a lower bound only; they do not include GPU duplication, hit canvases, compositing, allocator fragmentation or browser overhead. “All fit” shows the entire synthetic scene in the initial viewport; table scale and raw camera values show that node labels become progressively less legible at large counts.
- Gesture windows include input handlers/redraw and small sampler hooks; process CPU is independent of renderer TaskDuration but is not attributable to one subsystem. Frame intervals reflect scheduling gaps, not input latency. Visible canvas backing RGBA bytes are a lower bound; hit canvases/GPU/compositor storage are not counted.

## Aggregate (median across three fresh-context runs)

Render is p50/p95 ms; CPU cells are task-ms / %one-core proxy; process CPU is summed Chrome-tree CPU-ms / %one-core; frame is p50/p95/max ms; heap reports absolute initial → after-gesture MiB.

| Nodes | Native edges | All-fit zoom | Render-ready p50/p95 ms | Idle task CPU-ms / %core; process CPU-ms / %core | Gesture task CPU-ms / %core; process CPU-ms / %core | Gesture rAF p50/p95/max ms | Long tasks | Post-GC JS heap initial → after MiB | Canvas lower-bound MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 9 | 14 | 0.8 | 443.86/471.95 | 0.29 / 0.01; 0 / 0 | 944.17 / 63.97; 1560 / 105.28 | 16.7 / 166.7 / 183.3 | 4 | 3.36 → 3.74 | 6.51 |
| 50 | 77 | 0.33 | 1728.79/1728.88 | 0.38 / 0.02; 0 / 0 | 7090.78 / 98.44; 7460 / 103.32 | 16.7 / 883.3 / 883.4 | 7 | 5.64 → 5.84 | 6.51 |
| 150 | 232 | 0.15 | 4852.52/4869.83 | 0.37 / 0.02; 10 / 0.45 | 21044.45 / 99.4; 21980 / 103.48 | 16.7 / 2633.3 / 2649.8 | 7 | 10.36 → 10.57 | 6.51 |
| 450 | 700 | 0.08 | 11781.9/11791.76 | 0.39 / 0.02; 10 / 0.45 | 43385.27 / 99.77; 45640 / 104.81 | 16.7 / 5433.2 / 5433.2 | 7 | 24.34 → 24.70 | 6.51 |

## Reproduction

1. From repository root, build only the isolated static page: `npm run build:experiment:konva`
2. Serve only that output on loopback (use any free port): `npm run preview:experiment:konva -- --host 127.0.0.1 --port 4179 --strictPort`
3. In a second terminal: `KONVA_EXPERIMENT_URL=http://127.0.0.1:4179 node experiments/konva-browser/benchmark.mjs`

REST and external requests are blocked; only isolated same-origin static assets are allowed. The runner makes no production edits. Any failed sample is retained in JSON.
