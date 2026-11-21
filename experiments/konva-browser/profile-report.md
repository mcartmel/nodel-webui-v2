# Konva baseline profile (opt-in, profile-only)

## Scope and reproducibility

This records the static baseline at commit `a07bb09ea6d2d0214a7bf667c4d566558de7ab9f` only. The current runner refuses to run unless HEAD and seven source/dependency input blob hashes exactly match the pinned baseline; it will therefore refuse the candidate's modified `main.ts`. It serves a transient Vite dev server bound to `127.0.0.1` and transforms that in-memory source only. Each run writes to a new exclusive `profile-runs/<timestamp-pid>/` directory; it never overwrites the preserved original raw JSON or PNGs. REST is not used.

Reproduce from repository root:

```sh
KONVA_PROFILE_REPEATS=1 node experiments/konva-browser/profile.mjs
```

The original measured run remains in `profile-results.json` with screenshots in `profile-evidence/`; future output is under the exclusive `profile-runs/` directory. Chromium was headless Chrome for Testing `159.0.8154.6`, viewport `1366x768`, DPR 1, Linux x64, Xeon W-2235. It profiled all four sizes (`9/50/150/450`), all three construction modes, and both themes. This expensive profile pass used one fresh-context pass per combination; it is diagnostic evidence, not a multi-run statistical estimate. Repeat passes can be requested with `KONVA_PROFILE_REPEATS` (minimum 1).

`nodes-only` does not call `makeWire`; `wires-only` does not call `makeCard`. They construct zero corresponding shapes, rather than construct-and-hide them. Construction timings are collected synchronously around fixture creation and the two constructors. Navigation-to-stage-ready wall time is reported separately after native counts and two animation frames; it is not a calibrated paint timestamp and is not equated to constructor time.

The runner's pinned Git blob inputs are: `main.ts` `1edb3084549f76196c4ffe26f97e792f8b48755b`; `fixture.ts` `d5161cc889b2ac3359bee36a9434d1b523426781`; `style.css` `c2710f1c8f2ede5c1c8cc612abf42e8b6dde9c5d`; `theme.ts` `87dc011f4c555db4046ea0d291a1dbd127d91e0e`; `topology-canvas.html` `142a533cc907ed7a16fe70689aba1890f048cddb`; `vite.konva.config.ts` `e011ab096302a6fdfc99f250ae4c0348ff7b489d`; `package-lock.json` `8d02f7274f0b53689ecf120b4679b440f44887b7`.

CDP V8 CPU sampling ran at 1 ms during construction/readiness and each interaction. JS `Layer.drawScene`/`drawHit`, per-shape `drawScene`/`drawHit`, `Stage.getIntersection`, and `updateWireGeometry` wrappers use `performance.now()` elapsed wall time on the main thread; they do **not** measure CPU cycles. Layer/shape buckets are JS/Konva draw-submission elapsed time, not GPU/compositor raster time. The CPU profile's `restore` and `drawImage` samples identify costly sampled Canvas2D/native-bound call paths, but are not raster-thread timing. There was no forced GC or pixel readback in timed windows; screenshots were outside measurements. Wrappers and CDP sampling add overhead, especially for card shadows.

Each actual node drag used 12 pointer steps (48×32 CSS px), each pan used 10 pointer steps (−42×−29 px) over verified empty stage, and zoom used a −240 wheel event. Historical drag/pan/zoom numbers are **Playwright dispatch wall time**, not settled redraw or paint latency: the runner did not wait for post-input frames before closing each interval. Zoom especially ends before scheduled redraw is guaranteed. Do not compare those values as rendering latency. The baseline draw buckets are the appropriate submission-time metric; each layer bucket below contains six initial calls, so divide by six for average elapsed per `drawScene`/`drawHit` call. For future runs, per-phase before/after camera snapshots and exact deltas are saved. The original JSON saved pan end-camera coordinates but omitted camera-before, so its exact pan delta cannot be reconstructed and those coordinates are now labeled as absolute endpoints, not deltas. `updateWireGeometry` elapsed is synchronous wall elapsed summed over calls, not CPU time. Wire-only drag is N/A because no card is constructed. The historical 200-call hit probe's wrapper counter was not snapshotted before/after and is contaminated by earlier hit queries; its wrapper count/time below is retained but explicitly marked contaminated. The revised runner records the pre/post delta around only those 200 direct calls.

## Results (light theme, one profile pass)

All elapsed values are milliseconds. Layer entries are cumulative `scene/hit` elapsed over six calls; shape entries are wire, text, other node shapes, and card-shadow `scene` elapsed. For a per-call comparison, divide layer entries by six. Construction is `fixture / wires / cards / overall synchronous setup` elapsed. “Ready wall” is navigation request through native counts and two animation frames, not a calibrated paint timestamp. Hit entries are page-loop wall / **contaminated cumulative wrapper elapsed**, not a valid isolated query cost. Drag, pan, zoom are dispatch wall only. Node/edge counts are actual constructed shapes.

| Nodes / mode | Cards / wires | Construction fixture / wires / cards / total | Stage-ready wall | Wire layer scene / hit | Card layer scene / hit | Shape scene wire / text / other / shadow | Hit loop wall / contaminated wrapper elapsed | Drag dispatch wall / geometry elapsed (`calls`) | Pan dispatch wall / absolute end-camera x,y* | Zoom dispatch wall / final scale |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 9 full | 9 / 14 | 0.3 / 1.8 / 10.6 / 18.4 | 756 | 3.5 / 1.5 | 35.2 / 1.6 | 2.8 / 6.3 / 3.4 / 24.7 | 1.3 / 1.5 | 2,195 / 0.9 (36) | 1,828 / 127, −91* | 53 / 0.8582 |
| 9 nodes-only | 9 / 0 | 0.2 / 0.0 / 11.5 / 18.0 | 462 | 0.4 / 0.4 | 35.2 / 2.3 | — / 7.0 / 5.0 / 22.8 | 1.2 / 1.4 | 2,210 / 1.2 (36) | 1,855 / 127, −91* | 23 / 0.8582 |
| 9 wires-only | 0 / 14 | 0.4 / 1.9 / 0.0 / 7.3 | 177 | 3.0 / 1.6 | 0.3 / 0.0 | 2.3 / — / — / — | 2.5 / 2.6 | N/A | 182 / 127, −91* | 38 / 0.8582 |
| 50 full | 50 / 77 | 0.4 / 7.6 / 23.9 / 42.2 | 1,851 | 7.2 / 4.3 | 1,628.2 / 9.3 | 5.9 / 23.4 / 13.7 / 1,589.2 | 1.3 / 1.5 | 12,335 / 0.4 (36) | 9,937 / −23, −44* | 31 / 0.3528 |
| 50 nodes-only | 50 / 0 | 0.4 / 0.0 / 17.9 / 24.0 | 1,783 | 0.8 / 0.4 | 1,604.3 / 7.0 | — / 19.4 / 16.9 / 1,565.1 | 1.4 / 1.4 | 11,822 / 0.8 (36) | 9,938 / −23, −44* | 28 / 0.3528 |
| 50 wires-only | 0 / 77 | 0.3 / 3.1 / 0.0 / 7.5 | 189 | 6.3 / 5.8 | 0.1 / 0.0 | 5.6 / — / — / — | 2.2 / 2.1 | N/A | 193 / −23, −44* | 45 / 0.3528 |
| 150 full | 150 / 232 | 0.5 / 8.1 / 38.3 / 52.3 | 5,046 | 12.3 / 7.7 | 4,790.6 / 19.2 | 11.3 / 48.6 / 40.4 / 4,696.0 | 1.4 / 1.3 | 35,115 / 1.1 (36) | 29,516 / 121, −26* | 40 / 0.1620 |
| 150 nodes-only | 150 / 0 | 0.5 / 0.0 / 32.2 / 37.3 | 5,180 | 0.3 / 0.2 | 4,961.3 / 18.4 | — / 53.5 / 36.9 / 4,865.5 | 1.4 / 1.3 | 35,001 / 1.1 (36) | 29,556 / 121, −26* | 36 / 0.1620 |
| 150 wires-only | 0 / 232 | 0.3 / 6.8 / 0.0 / 11.6 | 195 | 12.0 / 9.5 | 0.2 / 0.0 | 11.1 / — / — / — | 1.7 / 1.7 | N/A | 188 / 121, −26* | 31 / 0.1620 |
| 450 full | 450 / 700 | 0.5 / 14.8 / 80.8 / 100.7 | 12,372 | 31.1 / 20.7 | 11,962.4 / 47.5 | 28.9 / 131.0 / 104.0 / 11,712.9 | 1.4 / 1.3 | 71,949 / 1.4 (36) | 61,202 / 175, −19* | 56 / 0.0895 |
| 450 nodes-only | 450 / 0 | 0.5 / 0.0 / 74.7 / 81.1 | 12,343 | 0.6 / 0.3 | 11,999.1 / 51.2 | — / 121.9 / 95.2 / 11,760.4 | 1.4 / 1.6 | 72,165 / 1.6 (36) | 60,872 / 175, −19* | 52 / 0.0895 |
| 450 wires-only | 0 / 700 | 0.7 / 17.7 / 0.0 / 23.1 | 251 | 33.8 / 22.0 | 0.2 / 0.1 | 31.7 / — / — / — | 1.4 / 1.2 | N/A | 194 / 175, −19* | 37 / 0.0895 |

The direct draw buckets isolate the large-card cost more reliably than gesture wall time: at 450 nodes, the card-layer `drawScene` bucket was 11,962.4 ms across six calls (about **1,993.7 ms per call**); nodes-only was 11,999.1 ms across six (about 1,999.9 ms/call), while wires-only was 0.2 ms across six card-layer calls. The card-shadow shape bucket was 11,712.9 ms across 2,250 calls. Wire-only's `drawScene` plus `drawHit` layer buckets were 33.8 + 22.0 ms across six calls each. The 36 drag-time `updateWireGeometry` calls show 1.4 ms of synchronous elapsed time in full mode (about 0.04 ms/call), not CPU time. The large shadow bucket and near-identical full/node-only scene submissions indicate card drawing, not wire geometry, as the primary cost. At 9 nodes fixed overhead dominates, so do not generalize low-count ratios. The very large drag/pan dispatch intervals are retained as historical input-dispatch observations only and are not cited as redraw durations.

The historical 200-point loop reports 1.2–2.6 ms for its enclosing page-side loop and contaminated wrapper totals; all light-theme raw rows show 203 wrapped calls although exactly 200 were in the explicit loop, so three earlier calls are included. These are not isolated API costs or a real pointer-hit latency distribution. The revised runner reports the exact pre/post query-counter delta around the loop. V8 gesture samples at 50/150/450 show `restore` and `drawImage` among the top sampled functions (e.g. 450 full drag: approximately 65.3 s `restore`, 5.7 s `drawImage` sampled self time). These are CDP CPU-profile samples on Canvas2D/native-bound call paths, not raster-thread timing. Use an explicit Chromium tracing run if a later phase needs GPU raster/compositor attribution.

Historical interaction columns above are dispatch-only wall intervals; they close as soon as Playwright input calls complete and do not wait for scheduled paint. The wheel zoom value is therefore especially not a rendering measurement. For before/after drawing comparisons, use the six-call layer buckets (per-call average as stated) or a matched direct layer-draw probe; do not use dispatch-only drag/pan/zoom values as paint latency. Pan camera cells are absolute endpoint positions from the raw file, not deltas. That historical file did not retain camera-before, so exact deltas cannot be reconstructed from it; the revised runner records both endpoints and the computed delta.

## Visual references

The four full-mode screenshots are clean pre-interaction captures at both requested sizes/themes, same viewport and browser as the numeric run. The raw JSON and PNGs were preserved byte-for-byte while correcting the runner/report:

| Preserved raw file | SHA-256 |
|---|---|
| `profile-results.json` | `4c18d1167fd18a93841cb4d975cc6cba9364ef33d9174ddaa724716684d852f3` |

| File | SHA-256 |
|---|---|
| `profile-evidence/baseline-9-light.png` | `b1c6bebcda78ccb79db8c9541513e70fda3050237d50cdae3a0e262c85c146a4` |
| `profile-evidence/baseline-9-dark.png` | `342c6d04dce51c2aa28cc631a3de4e358a0043bc31987dc0fcc46e7f2833a036` |
| `profile-evidence/baseline-450-light.png` | `43a303538f8a408c05c3671307d52e41b529033d0af20cfcc0341892dfdc7469` |
| `profile-evidence/baseline-450-dark.png` | `5591b5e796d7229383e75f098400902e530ec66c606c58aa2f66358b3873e22c` |

Compare future screenshots at the same viewport/DPR/Chrome build after matching the theme. The PNGs are visual references, not included in timing measurements. Exact full sample rows and CPU-profile top functions are in `profile-results.json`.

## Recommendation

For a subsequent optimization experiment, first isolate/replace card-shadow rendering (or test disabling/reducing its blur) while holding topology, labels, themes, and wire hit behavior constant. Keep updateWireGeometry as a secondary target: its measured CPU cost is tiny at current fixture sizes. Validate changes against the four PNGs and repeat the profile with the same Chrome/viewport; retain wire scene and hit paths unless a separate hit-test study justifies changing them.

## Phase 2: card shadow candidate experiments

### Method and Konva source finding

The previous candidate summary was withdrawn: its group-cache transform cached only the background rect, and its retained JSON did not contain the matched 450-card rows. It is not evidence for complete-card caching or its memory/performance. The corrected `candidate-bench.mjs` calls `group.cache()` after the header, title/status text, divider, ports and sockets have all been added. It profiles one variant per fresh browser context via an in-memory transform on the isolated loopback Vite server. It does not edit application source or write the baseline `results.json`, `report.md`, `profile-results.json`, or baseline PNGs.

Konva 9.3.18 `Shape._useBufferCanvas()` bypasses the shared stage buffer if `perfectDrawEnabled` is false. Otherwise, for the card background rect with opaque fill + stroke + shadow, it uses that buffer when `shadowForStrokeEnabled` is true. Turning off `shadowForStrokeEnabled` is the narrower bypass: it keeps the fill shadow while omitting the stroke shadow. Both property candidates were measured separately from the unchanged control. The third candidate caches the **complete card group** (scene and hit canvases). Timings are five synchronous `cardLayer.drawScene()` calls per fresh context; these are JS/Konva submission elapsed times, not GPU raster time or end-to-end gesture latency.

For selection/hit validation, the harness queried native Konva intersections, then used trusted Playwright mouse clicks on a card and a wire. The wire click is done after zooming the wire under test to 1.6× so the physical hit test is meaningful even in the 450-node all-fit view. Hashes are SHA-256 readbacks of the **two visible scene canvases only** (wire scene layer and card scene layer). Konva hit canvases are separate and **were not hashed**. Every edge’s declared source/target node and port is checked against calculated curve endpoints; visible wire-layer ink is sampled just outside both ends of every edge.

### Matched 450-card candidate results

The bounded performance matrix used 450 nodes / 700 wires, light theme, 1366×768, DPR 1, three fresh-context passes, and counterbalanced candidate order. `candidate-results-450.json` is the complete, checkpointed raw matrix (12 matched rows, per-row five draw timings, scene hashes, exact card rect geometry, cache estimates, and interaction/endpoint validation). Chrome for Testing is 159.0.8154.6. All rows identify source SHA-256 `8a8a3a405b2cdc800e4d22869e767797a003f6d9901a9b655ecfaab9feeecd73`.

| Variant | Per-pass median of five draws (ms) | Median across 15 draws | Matched visual / behavior result |
|---|---:|---:|---|
| Control | 5439.1 / 5440.8 / 5440.8 | 5440.8 | Reference scene hashes; all checks pass |
| `perfectDrawEnabled: false` | 23.8 / 24.4 / 24.1 | 24.1 | Geometry unchanged; expected card-scene shadow-edge pixel difference; all real hit/selection/endpoint checks pass |
| `shadowForStrokeEnabled: false` | 24.2 / 24.4 / 24.3 | 24.3 | Geometry unchanged; expected card-scene shadow-edge pixel difference; all real hit/selection/endpoint checks pass |
| Complete-group cache | 5.3 / 5.4 / 5.2 | 5.3 | 450 cached scene+hit group pairs; fails visible node-selection and endpoint-highlight repaint checks |

The group-cache candidate’s measured scene+hit RGBA backing lower bound is **154,783,200 bytes (~147.6 MiB)** for 450 complete groups at pixel ratio 1. This omits GPU/compositor duplication. It also leaves a selected node’s cached card scene unchanged and fails the visible endpoint-highlight comparison after wire selection. Reject it despite its faster submission time: it both retains costly offscreen buffers and breaks visible selection semantics. This is the corrected complete-group result, not the invalid earlier partial-cache result.

For control, both property variants, and the complete group cache, native hit queries and real clicks selected the intended card and a real wire; the selection states matched. For each variant and each of its three passes, all **700/700** edge endpoint-geometry checks passed and all **1,400/1,400** sampled visible wire-ink checks passed (minimum sampled alpha 19). Card count, wire count, and two visible scene layers were correct. The property candidates also repainted the selected card, selected wire, and the selected wire’s endpoint ports; the complete-group cache did not repaint the card selection or endpoint highlights. No hit-canvas hash was taken or inferred.

### Nine-card pixel identity and interaction check

The separate `candidate-nine-pixel-matrix.json` contains 16 matched raw rows: control vs the exact larger-only variant, two fresh-context repetitions, both themes, and 1366×768 + 1920×1080 at DPR 1. For every pair, card geometry and both visible scene-canvas SHA-256 hashes match exactly. The matched pairs (wire scene / card scene; these are not hit-canvas hashes) are:

| Viewport / theme | Wire scene SHA-256 | Card scene SHA-256 |
|---|---|---|
| 1366×768 light | `0cfc56a8a499a3fec936965b2cdbc23ed0d5a7588800cc593f5c7e563dfd865d` | `54068cd0a64cf633f8331703d5f3563595853636a0c55a2f7774f2b18459677a` |
| 1366×768 dark | `4cee6513ed6230cd2101dee5a84125619d904ec4661fd19e9aaf9494c8a64e02` | `8281eaf3c4c5e22999705612412ba03d5d3788db3376cb4476c1f7dd9dea2ecf` |
| 1920×1080 light | `73a88f9244a254d42d17af352b063bc9d4864fccaab5f8b7e7347536005de8c2` | `cab2177827d32fc986a4a4ea0d67f46a44189a449619ab53ffbb58529593ba65` |
| 1920×1080 dark | `ad5b6d897f5d5cbffa74885d6b10db35605657ff5957cb775ad63261c425b666` | `93aa60e59df72cdd33e0a9fcc84715514b72c421af6170298cf2d31f31defec1` |

In both control and larger-only nine-card rows, native card and wire hits selected the intended objects; selected card, wire, and endpoint-port repaint all changed the corresponding visible scene pixels. All 14/14 declared edge endpoint geometries and 28/28 endpoint ink samples passed per row. The larger-only candidate does not set either property at nine nodes, retaining the Konva defaults and pixel-identical nine-node output.

### Retained option and scope

Retain only `shadowForStrokeEnabled: false` for fixtures larger than nine nodes. Its 450-node median fell from 5440.8 ms to 24.3 ms in this matched scene-draw harness, with all card geometry, native card/wire hits, selection, port highlighting and edge endpoints preserved. The changed card scene hash documents the intended shadow-edge visual difference at larger sizes; nine-node scene pixels remain exactly matched. `perfectDrawEnabled: false` is similarly fast but broader than necessary. Full group caching is rejected for memory and failed repaint semantics. No wire or hit-path changes, additional cache/sprite, virtualization, worker, dependency, or user-facing toggle was added.

The original nine-node baseline screenshots, `results.json`, `report.md`, and `profile-results.json` were not overwritten. The candidate JSON files contain visible scene hashes only; native intersection/click evidence and endpoint ink checks, not hit-canvas hashes, support hit-behavior claims.
