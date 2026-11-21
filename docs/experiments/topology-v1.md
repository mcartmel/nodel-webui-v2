# Topology v1: technical retrospective

**Status:** archived read-only prototype and experiment record. This is not a proposal to extend the implementation in this change. No implementation, deployment, live capture, or validation run was performed for this archive task.

## Purpose and selected scope

The prototype asks whether Nodel's discovered nodes and remote action/event assignments can be presented as an inspectable network map without making the diagram a second configuration surface. Its selected scope is a **read-only host-level viewer**: discover advertised nodes; read node actions, events, binding schema and configured remote assignments; display relationships, endpoint evidence, filters, search, diagnostics and an inspector; allow presentation-only placement, selection and navigation. It does not create nodes, edit bindings, invoke actions/events, or write to Nodel.

The bounded live observation available to the investigation reported **462 advertisement entries but only two nodes and two edges** in its observed connected graph. The 462 is an advertisement-row count, not a count of unique nodes. That is an intentionally narrow observation, not a representative network, completeness result, or routing/performance benchmark. The screenshot pair archived here is synthetic fixture evidence, not live-host imagery.

## Capabilities and architectural seams

The implementation separates the REST client and strict codecs from inventory projection, topology identity/model, discovery orchestration, presentation, placement, canvas, controller, and the `nodel-topology` component. The page/component contract is lazy-loaded; the prototype is hosted on the core `nodes.html` page and the element is also embeddable. This layering gives useful seams for independently testing API decoding and trust policy, graph identity/evidence, view state, layout, and rendering. Existing shared request deadlines, connectivity reporting, URL policy and component-loading paths are integration points rather than topology-specific copies.

The UI supports a node inventory separate from the currently drawn graph, Relationships and All Nodes views, filters, focus by upstream/downstream branches, endpoint visibility, search/reveal, inspection, diagnostics, refresh, fit/centre/zoom, manual placement, auto-layout, and locally persisted presentation state. Grouped parallel relationships are a visual overview only; inspection returns to the underlying bindings. Presentation state does not become configuration state.

### File-to-role map

| Tracked path | Role |
| --- | --- |
| [`src/api/topology-client.ts`](../../src/api/topology-client.ts) | Validates and separates fetch/display/navigation addresses; performs fixed-policy, read-only detail requests. |
| [`src/features/topology/topology-discovery.ts`](../../src/features/topology/topology-discovery.ts) | Projects local and advertised inventories into bounded routes and schedules actions/events/schema/assignment reads. |
| [`src/features/topology/topology-model.ts`](../../src/features/topology/topology-model.ts) | Logical identities, evidence snapshots, configured-binding reconstruction and resolution states. |
| [`src/features/topology/topology-controller.ts`](../../src/features/topology/topology-controller.ts) | Discovery/read lifecycle, cache/freshness, cancellation, merges and controller state. |
| [`src/features/topology/topology-presentation.ts`](../../src/features/topology/topology-presentation.ts) | Filters, focus, selection, visible graph projection and presentation state. |
| [`src/features/topology/topology-placement.ts`](../../src/features/topology/topology-placement.ts) | Automatic placement, retained positions, pins and collision handling. |
| [`src/features/topology/topology-canvas.ts`](../../src/features/topology/topology-canvas.ts) | X6 node/port/edge rendering, interaction and endpoint routing. |
| [`src/features/topology/topology-view.ts`](../../src/features/topology/topology-view.ts), [`topology-workspace.ts`](../../src/features/topology/topology-workspace.ts), and [`src/components/nodel-topology.ts`](../../src/components/nodel-topology.ts) | View controls/workspace composition and the custom-element host boundary. |
| [`src/features/topology/topology-simple-name.ts`](../../src/features/topology/topology-simple-name.ts) | Java-compatible logical-name matching. |
| [`scripts/topology-performance.mjs`](../../scripts/topology-performance.mjs), [`scripts/compare-topology-performance.mjs`](../../scripts/compare-topology-performance.mjs), [`scripts/TOPOLOGY-PERFORMANCE.md`](../../scripts/TOPOLOGY-PERFORMANCE.md) | Opt-in intercepted-fixture profiler, report comparator, and method/limitations. |
| [`test/topology-router.bench.mjs`](../../test/topology-router.bench.mjs) | Optional X6/Chromium router comparison harness; it is not a production test gate. |

The core inventory/detail path is: `GET /REST` reads the host's `nodes` map for local nodes; `POST /REST/nodeURLs` with JSON `{"filter":""}` reads network advertisements. For each usable owner route the viewer reads `GET REST/remote/schema` and `GET REST/remote`; it separately reads target `GET REST/actions` and `GET REST/events` to check advertised endpoint names. For example, an owner's configured action alias such as `power` pointing to node `Lamp` action `switchOn` is rendered owner-to-`Lamp.switchOn`; an event reference from `Lamp.ready` to an owner's remote-event alias is rendered from the referenced local event toward the owner. These are illustrative data-flow examples, not write or invocation requests. The browser topology client uses the per-target absolute endpoints after its URL checks.

The inspection data makes distinct claims explicit:

| Evidence layer | What it means | What it does not mean |
| --- | --- | --- |
| Configured | A complete owner-side assignment was read and can be drawn as a configured wire. Failed reads may leave a clearly stale wire; successful cached values are labelled pending/cached. | That the target was found, the endpoint exists, or the call works. |
| Discovered / endpoint-verified | Advertisements and separately read action/event/schema metadata support resolution evidence such as resolved, missing, ambiguous, not discovered, or unknown. | That the configured operation has run successfully, or that it is currently connected. Unread evidence remains unknown. |
| Runtime | Runtime behavior belongs to Nodel's actual execution/activity evidence, not topology's static metadata projection. | This viewer does not invoke an operation or claim that a wire is live merely because it is drawn. |

An advertised-only node is distinct from a node whose browser read was attempted and failed. Ambiguous duplicate logical names suppress unsafe administration navigation rather than picking a route. Assignment rows that are malformed, partial or conflicting do not generate speculative wires. Filters affect display, not evidence.

## API and browser security boundaries

Discovery begins with `GET /REST` for the local host response and its `nodes` map, and `POST /REST/nodeURLs` with `{"filter":""}` for network advertisement entries. It then uses read-only `GET`s to usable advertised/local nodes for `/REST/actions`, `/REST/events`, `/REST/remote/schema`, and `/REST/remote`. Data is decoded and bounded before projection; the experiment does not add a server-side graph endpoint or cross-node write path. The advertisement count must not be reported as unique nodes.

The browser client keeps fetch base, canonical display address and admin link separate. Remote destinations are URL-validated; only explicitly constructed local targets may use same-origin credentials, while remote reads omit credentials. Requests use fixed GET-only policy, `Accept: application/json`, `cache: no-store`, CORS mode and `redirect: error`; callers cannot inject headers or change that policy. Local reads are restricted to the current origin. Navigation uses a separate safe-link policy; invalid or unsafe advertisements can remain display-only rather than gaining fetch/navigation capability. Inventory, address, name and detail-text limits constrain processing, and cancellation/deadline handling bounds outstanding reads. These are browser-side controls, not a substitute for host authorization, network segmentation, CORS policy or operator trust in advertisements.

## Logical names: Java `SimpleName`

Names and graph IDs follow Nodel's Java matching semantics rather than JavaScript locale-sensitive lowercase. The adapted reducer/flatten key uses a single UTF-16-unit pass, handling comments and `--`/`//` comment tails, Java-style ASCII/non-ASCII spaces, pinned Java 21 Unicode 15.0 case mappings, and the separately licensed transliteration table. This prevents browser Unicode-version/locale drift from splitting names Nodel considers equivalent. It intentionally preserves the Java behavior that two empty reduced keys compare equal; an empty key is not accepted as a usable topology name. Unicode versions in other Java runtimes can differ on newly cased characters, so the pinned reference version and licensing notice matter.

Logical-name identity groups equivalent advertised routes and stabilizes endpoint/binding identity across spelling changes and placeholder-to-advertised promotion. It is not proof that two routes are the same host; conflicting route evidence is retained as ambiguity rather than silently collapsing navigation or evidence.

## Layout and routing findings

The graph uses X6 3.1.8 for interactive node/edge rendering and X6's own port-to-port routing. The production prototype uses an in-house directed placement fallback rather than taking a new layout dependency. It ranks strongly connected components, uses a bounded heuristic for smaller/sparser components (with back-edge rank relaxation, branch placement and up to four barycentric sweeps), and preserves retained positions, manual pins and collision handling. This is a heuristic, not a global crossing optimum; geometric center-line crossing counts are not rendered-wire crossing counts.

The isolated ELK experiment supplied ELK 0.12.1 bend vertices to X6. That did **not** establish correct terminal alignment or self-updating orthogonal routes: initial bends could miss X6 port terminals, and moving a node left stale bends that produced diagonals. Parallel edges with identical terminals shared bends and overlapped. ELK's roughly 1.65 MB raw runtime (about 480 KB gzip) and local worker/CSP packaging needs were also out of budget; its EPL-2.0 OR GPL-3.0-or-later licensing requires care. ELK was not adopted.

Dagre 3.1.3 was measured in a minimal Vite bundle. Named imports reduced that test's gzip size by only 229 bytes (16,969 to 16,740); older 1.1.8 and 2.0.4 candidates likewise did not provide the needed budget headroom. Dagre/Graphlib were not retained in the production dependency, license, SBOM or bundle graph. No router change followed from those layout comparisons.

Separate one-run X6 router probes used a six-card fixture with a cycle, fanout and a parallel pair. Orth/manhattan and metro produced different length/stretch profiles; metro was shorter on that particular fixture but roughly twice as slow. All tested routes had zero sampled unrelated-card intersections, no identical complete paths and no extreme waypoint counts. The unrelated obstacle did not actually force a route through it, so obstacle avoidance was **not tested**. These measurements do not generalize to dense/large graphs. Dotted paths can encode pending or unresolved evidence; they are not, by themselves, a router defect. The tracked [`test/topology-router.bench.mjs`](../../test/topology-router.bench.mjs) is the reproducible harness; measurements are summarized here rather than linked to an ignored build-output report.

## Historical validation and profiling boundaries

At the implementation commit, the recorded validation was **2,129 Vitest tests**, **1,215 browser checks passed / 598 skipped**, and **4 staged smoke checks**. Those are historical results for the implementation, not tests run by this documentation-and-asset archive task. Validation was not rerun here.

The latest available `build/topology-performance/topology-451-1795219654093.json` report is from an interrupted profiler session, not an acceptance run. It intercepted all Nodel requests with deterministic local fixtures: 451 advertised nodes, an 18-node connected cluster and five stable refreshes. On headless Chromium 159 / Node 24.15.0 it recorded 2.25 s initial discovery-to-settled, 14.30 s inventory completion, and stable refresh wall-times of 0.91–1.08 s. The corresponding renderer `TaskDuration` proxy was 0.49–0.68 s; each stable sample recorded one long task (280–327 ms) and two RAF intervals above 25 ms. The actual schema records the changed/addition scenario under `runs[0].genuineAddition`: the fixture addition rendered; the overall `wallMs` was 9.18 s including end-to-end refresh/convergence, and its nested CDP profile measured 1.10 s wall / 0.69 s renderer `TaskDuration`. Do not confuse that nested profile interval with the full 9.18 s end-to-end measurement. These conservative figures suggest refresh/render cost remains worth investigating, but include settle time and browser/machine noise and are not isolated CPU timings or thresholds. Inventory-completion cycles are separate from stable refreshes. The report's headless, single-host, adapter-specific, forced-GC/heap and advisory build-timestamp limitations are documented in [`TOPOLOGY-PERFORMANCE.md`](../../scripts/TOPOLOGY-PERFORMANCE.md). The harness intercepts reads and uses a supplied existing build; it does not connect to a live host or build the application.

An unrelated release-budget item should remain separate in any future restoration/revert review: `performance-budgets.json` has a narrowly raised CodeMirror XML raw maximum (152,000 bytes) while XML gzip and ordinary initial-page limits remain unchanged. The tracked [release notes](../../RELEASE_NOTES.md) record its approval and rationale; it is not topology headroom and should not be implicitly coupled to topology files or dependencies.

## Archived fixture screenshots

These two PNGs were copied byte-for-byte from `build/topology-workspace-evidence/` into this documentation archive. Their relative links work in GitHub and do not rely on ignored build artifacts.

| Viewport | Fixture image |
| --- | --- |
| 1366 × 768 | [topology-workspace-1366x768.png](topology-v1-assets/topology-workspace-1366x768.png) |
| 1920 × 1080 | [topology-workspace-1920x1080.png](topology-v1-assets/topology-workspace-1920x1080.png) |

## Lessons and synthetic-only next increments

1. Keep “configured”, “validated against discovery”, and “runtime observed” as separate evidence categories. Unknown is a valid and necessary answer when reads are absent or partial.
2. Preserve endpoint and binding provenance through layout and filtering. A tidy picture must never hide uncertainty or silently choose between conflicting advertised routes.
3. Treat layout and routing as different problems. Node placement can be bounded and dependency-free while X6 routes edges; imported bend points need anchor validation, movement recomputation and parallel-edge separation before they can be trusted.
4. Profile realistic refresh paths independently from initial discovery and inventory completion. The incomplete latest profile cannot answer changed-refresh cost or serve as a pass/fail threshold.
5. Keep names, URL safety, read budgets, cancellation and display-only navigation at explicit seams. A diagram must not turn untrusted network advertisements into ambient credentials or privileged navigation.

If further learning is authorized, keep it synthetic-only and incremental: (a) document a small fixture contract with explicit configured/resolved/unknown/runtime labels; (b) add deterministic synthetic cases for duplicate routes, partial assignments, cycles, fanout, parallel edges and changed refresh; (c) compare route quality and node movement in an isolated harness with anchor, obstacle and overlap assertions; (d) profile reproducible synthetic refreshes across small, dense and inventory-heavy sizes, preserving the complete machine/browser/build provenance. These are experiment ideas only—not work authorized or undertaken here. Do not run them against a live node or treat the fixture as a substitute for staged security review.

## Source history

- Topology implementation: [`3310e2abd546a3fdb698842c519570492630de4a`](https://github.com/mcartmel/nodel-webui-v2/commit/3310e2abd546a3fdb698842c519570492630de4a)
- Pre-topology parent: [`9a4c43849b2340722de731d36bdfb11200f9be4a`](https://github.com/mcartmel/nodel-webui-v2/commit/9a4c43849b2340722de731d36bdfb11200f9be4a)
- Canonical GitHub `main` reference: [`4ae41074f1071a99ca84691f7438ff6377c675c2`](https://github.com/mcartmel/nodel-webui-v2/commit/4ae41074f1071a99ca84691f7438ff6377c675c2)

The pre-topology parent and canonical `main` reference have the same tree, `ae103b38987c38246f2db5e5d43f2a8216a9c639`; they are the baseline against which the topology implementation commit is identified. The performance report and original screenshot source directory are ignored build artifacts; only this retrospective and the two synthetic images are part of the archive.
