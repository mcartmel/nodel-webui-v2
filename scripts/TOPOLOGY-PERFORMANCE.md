# Topology profiling harness

This is an opt-in baseline harness for an existing built webui directory. It serves that directory directly, intercepts every Nodel REST read with deterministic local fixtures, and never invokes a build or connects to a live Nodel host. Harness code lives in `scripts/topology-performance.mjs`; generated reports go to `build/topology-performance/` (ignored build output).

## Run

```sh
node scripts/topology-performance.mjs dist
```

Use `npm run build:preview` separately when an authorized build is desired; the harness itself never builds. `dist` is the default and can be replaced with an existing final dist path or `TOPOLOGY_DIST`. `TOPOLOGY_REFRESHES` configures stable refresh count (minimum five); `TOPOLOGY_PERF_OUTPUT` changes report directory. `TOPOLOGY_SCENARIO=dense100` runs 100 nodes; `TOPOLOGY_SCENARIO=dense1065` runs 100 nodes and 1,065 bindings. The standard scenario advertises 451 nodes with an 18-node connected cluster. It profiles Relationships and All Nodes separately.

The harness refuses to build, checks that the supplied dist contains `nodes.html`, then verifies the canonical component contract at runtime (`nodel-topology [data-topology-status]` and `[data-topology-mode]`, also used by the built-topology e2e fixture). It records source/dist newest-file timestamps as an advisory freshness check and writes a timestamped machine-readable JSON report plus console summary. Do not treat timestamp ordering as build provenance; choose the intended final dist and retain its provenance externally.

Repeat the same command with the same dist and environment for a comparable second sample. Compare saved reports without rerunning the browser:

```sh
node scripts/compare-topology-performance.mjs build/topology-performance/topology-451-<baseline>.json build/topology-performance/topology-451-<candidate>.json
```

Add `--out build/topology-performance/comparison.json` to persist the comparison summary.

## Measurements and interpretation

- Initial page-to-settled timing includes opening Topology; rendering is considered settled only after expected mounted node count, a non-reading status, two animation frames, and a short quiet interval.
- The bounded rotating assignment-read window is refreshed until every advertised owner has been requested. These inventory-completion cycles are reported separately from five or more stable refreshes.
- A single separate connected-node addition (including a new binding from the existing cluster) measures a changed refresh after stable samples.
- Each profiled phase reports wall time, CDP renderer `TaskDuration` / `ScriptDuration` deltas, and sampled CPU call stacks. The first stable refresh also records a CDP timeline breakdown (`FunctionCall`, `UpdateLayoutTree`, `Layout`, `PrePaint`, `Paint`, and related events) to separate browser rendering work from JS. Timeline collection is limited to that refresh and adds instrumentation overhead, so the separate wall timing is measured around the refresh action/settle interval. CDP TaskDuration is a renderer main-thread task-time proxy, not isolated CPU consumption.
- Five-second idle and refresh/interaction windows collect CDP task-time deltas. Long-task and Event Timing observers plus RAF interval collection are continuous; DOM census and X6 model/DOM identity snapshots happen only at checkpoints, so no repeated DOM counting runs during idle.
- X6 model counts are read from the component's current adapter/Graph instance; mounted nodes/wires, all DOM and SVG counts, and weak-map identity tokens expose model/mount counts and retention across unchanged/changed refreshes.
- V8 heap values are captured after forced GC, with DOM counts before hidden-page suspension, while hidden, and after element teardown. They are not total renderer/process memory.
- A real card drag and modifier-wheel zoom capture frame intervals, Event Timing latency, long tasks, and CDP profile data. Headless-browser graphics and input timing differ from a headed user session.

The JSON includes fixture, machine, Node/Chromium versions, viewport, method, freshness warning, and limitations. Compare runs only on the same host/browser/dist and with similar system load. This is a baseline harness, not a performance acceptance threshold.
