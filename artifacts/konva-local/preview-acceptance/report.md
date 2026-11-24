# Stage 1 decision: zero intentional preview wait

**Production fallback: 0 ms.** The shell releases at boot, but does not dismiss the scrim until usable data is drawn. A pre-module Show now click still latches. The explicit 1,500 and 3,000 ms comparison builds retain the same early local-connected release while HTTP advertisements are pending. No transport, request deadline or inspection budget was shortened.

## Apply the planned rule

The Stage 1 plan (lines 47–50) requires a ≥20% reduction in matched p90 length **or** ≥50% fewer prematurely unconnected mounts, without increased hidden paths, a small-network regression beyond a frame of baseline noise, avoidable long layout work or extra requests.

- **Length target missed.** All 102 binding IDs matched. At 1366/1920 wide, zero's sampled world-length p90 was 9,932/9,932; both waits were 9,828/9,824 (1.05%/1.09% shorter). Frozen was 10,688 at both sizes. No sampled non-endpoint card-body intersections in any matched large scene.
- **Premature-mount target met on this fixture.** At actual first mount, zero mounted four names with no wire. Two (`Anchor`, `Peer`) later had connections; the other two (`Isolated`, `LocalOnly`) were genuine isolates. Both waits mounted 104 cards with 102 known wires; just the two genuine isolates had no incident edge. This was consistent in all six large runs per candidate: **4 → 2 initially unconnected; 2 → 0 prematurely unconnected**. This is the mounted projection, not a count inferred from a later screenshot. Frozen lacks a mount mark; its count is unavailable, not zero.
- **Latency/cost guardrails do not support intentional waiting.** Small-network readable observations for 1,500 ms were 58 and 155 ms later at p50 than frozen, well beyond one nominal 60 Hz frame. Three seconds did not fix this. Large first-layout intervals for the waits exceeded 50 ms at both viewports. These are elapsed main-thread intervals including projection/installation, not a CPU profile proving how much work is avoidable. Zero also regressed versus frozen on the larger small-network viewport: fallback is a policy choice, not a claim every performance target passed. More dedicated visible paths or lower total long-task time do not replace the planned guardrails.

## Common browser measurements

[Raw 64-row matrix](results.json), including per-card placements, camera, clip, matched wire traces, requests, full `timingsByViewport` and screenshots. Fresh Chromium contexts, DPR 1, light/reduced-motion, same owner/operation delays, rotated order, frozen local-first artifact verified against its SHA256SUMS. Values below are navigation-relative milliseconds **p50 / p95 by viewport** (nearest rank, n=3; p95 is the maximum, not a reliable population tail). Dashes mean no qualifying observation or instrument.

| Workload | Width | Frozen readable | Zero readable | 1,500 readable | 3,000 readable |
|---|---:|---:|---:|---:|---:|
| Small | 1366 | 392 / 422 | 376 / 411 | 450 / 452 | 445 / 466 |
| Small | 1920 | 436 / 489 | 521 / 540 | 591 / 637 | 578 / 798 |
| Large | 1366 | — | 797 / 845 | 1004 / 1059 | 980 / 981 |
| Large | 1920 | — | 947 / 1094 | 877 / 895 | 890 / 897 |

| Large | Width | Release latch | Layout interval | Pre-observation long-task duration | Inspector cost, excluded from readable time |
|---|---:|---:|---:|---:|---:|
| Frozen | 1366 | — | — | 177 / 197 | 33 / 34 |
| Zero | 1366 | 42 / 47 | 23 / 24 | 536 / 608 | 28 / 31 |
| 1,500 | 1366 | 677 / 680 | 110 / 137 | 216 / 283 | 42 / 49 |
| 3,000 | 1366 | 667 / 687 | 96 / 104 | 172 / 207 | 41 / 44 |
| Frozen | 1920 | — | — | 165 / 172 | 37 / 38 |
| Zero | 1920 | 45 / 47 | 24 / 26 | 679 / 833 | 32 / 35 |
| 1,500 | 1920 | 657 / 660 | 88 / 92 | 162 / 165 | 36 / 48 |
| 3,000 | 1920 | 659 / 661 | 83 / 89 | 160 / 163 | 33 / 35 |

The latch captures its time **before** synchronous release callbacks, including layout. The common observer starts at navigation, not after a candidate-specific mark. After two consecutive animation-frame opportunities with mounted cards/wires and no covering scrim, it timestamps the observation **before** synchronous geometry and layer-pixel inspection. `readableObservedMs` is an observational upper bound/proxy, not a physical-display timestamp or the exact first readable pixel. The renderer's own map-painted mark, long tasks ending by the observation, inspection duration, feedback/Show now frame samples, and post-inspection screenshot are separate evidence. Missing button-frame samples are not successful visibility observations. The delayed empty-local controls reached the latch at 49–51, 1501–1505 and ~3001 ms respectively; nonzero ordinary small/large rows released on `local-connected` instead.

## Geometry and coverage

The earlier 4,950 overlaps were genuine: 100 siblings saw the same free slot before mounting. Incremental placement now reserves a flow-side column against actual occupied card bodies, sweeping obstacles once per sibling group. The earlier 92 apparent orphans were not genuine: the inspector omitted nested overflow sockets. Every matched large scene had 104 nonoverlapping card bodies, **102/102 configured world-space endpoint-to-takeoff traces**, and exactly two isolates. Card/curve world coordinates and camera-transformed clipped viewport bounds are separate. The hull and title test is conservative; 32 samples per cubic can miss occlusion. Shared takeoffs or offscreen wires are **not** proof of individually visible bindings. At zero, one dedicated connection qualified in the viewport; with waits four/five did. The frozen world fit was too small for a readable connected group. [Zero screenshot](large-preview-0ms-1366x768-r1.png) · [1,500 screenshot](large-preview-1500ms-1366x768-r1.png).

`hasReadableLocalConnection`, actual pair selection and camera fit now use the same 40 px horizontal / 36 px vertical allowance. A 220 px stage can no longer accept a 586-unit adjacent pair at minimum zoom 0.35. Readiness is an estimate without a speculative second layout; actual framing includes the curve hull.

The repeated large fixture delays the 450-ad response 4.5 s versus a 3 s request deadline. It measures **first map**, not completed 450-ad inventory. All four separate 104-node settled controls completed the same 206 requests including lookup names. Failed-inventory controls reported limited coverage, not complete inventory. The [separate 450 workload](../discovery-workload-450.json) previously passed with 450 distinct remote GETs and 454 inspected; it is not a settlement result for the combined fan-out fixture or a new zero-default workload rerun.

## Reproduction and checks

`KONVA_ACCEPTANCE_REPEATS=3 node scripts/konva-preview-acceptance.mjs` (Konva-only builds and loopback). Filtered or reduced-repeat smoke runs now write to separate subdirectories: an earlier smoke run overwrote the initial raw matrix. The retained matrix uses the integrated candidate; its control rows finished on the same built bundles after fixing a header assertion that incorrectly required stage data in the deliberately empty deadline case. Timing rows were not retried for better numbers. No page errors. No full product build, live hosts or Stages 2–3.

Focused shell, coordinator and layout tests passed, as did the zero-mode browser checks for pending inventory, held paint, early keyboard release, deadline-before-data, and connected group/gesture retention. The 3 s comparison build also passed the held-HTTP-inventory connected-group test. Typecheck and focused lint passed (the browser fixture is excluded by repository ESLint configuration). Tier 2 Aug 2 index coverage unavailable for all eight queried paths; reviewer findings were checked against current source.
