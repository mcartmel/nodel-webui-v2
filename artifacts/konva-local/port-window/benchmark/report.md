# Port-window decision: chooser

This replaces the earlier gate. Five rotated current-source trials per workload/mode at 1366×768, DPR 1, loopback Chromium. Frozen A remains historical only; A here is the same-source chooser with identical geometry. Gates are per workload; a global promotion requires passing both. No production build or live requests.

- **ordinary:** allowed outward p95 20.5 + 16.7 = 37.2 ms; observed B 213.1 ms, C 76.8 ms, D 86.9 ms.
- **fanout:** allowed outward p95 15.5 + 16.7 = 32.2 ms; observed B 1197.0 ms, C 75.5 ms, D 86.8 ms.

All measured browsing trials finished with verified selection and return. No direct variant qualifies on both workloads. Retain chooser; no default change. This is not a human task-time ranking: direct trials include paced input followed by the same chooser search.

## Round trip: locate port 208, select one named binding, restore rows 001–016 and camera

Each dense side has 244 ports. All start at rows 001–016, end the outward trip at 193–208 and return exactly 192 rows. B/C/D receive 192 trusted Playwright wheel packets (24 px at 120/s, 4,608 px per direction), recorded even when Chromium coalesces them. Fanout scrolls the left local endpoint of Dense-B; 100 distinct aliases on Peer-B enter the same socket. A has no direct wheel operation: it finds and selects through the chooser, then reopens it to select the home binding. Direct variants find by wheel and use the real chooser to disambiguate the exact wire. All compare chooser data-binding-id with an independently constructed canonical ID. Every sample verifies original camera/rows on return.

Browser-clock elapsed command/settle time, ms p50/p95; sums exclude screenshots, GC, fixture setup and correctness probes between phases. Select includes chooser search and Enter, including the FIND for A. No human think time. Final trials JSON has each gesture’s exact timings, offered packet schedule, received events, layer and rAF timestamps.

| Scene | Mode | Wheel find | Choose binding | Return | Round trip | Chooser PageDowns (5 trials) | Min exact selected pixels |
|---|---|---:|---:|---:|---:|---|---:|
| ordinary | chooser | — | 248.3/268.7 | 69.2/78.0 | 310.4/335.2 | 26/26/26/26/26 | 387 |
| ordinary | B | 1835.8/1848.3 | 234.4/267.2 | 1919.2/1973.5 | 4022.8/4068.4 | 26/26/26/26/26 | 387 |
| ordinary | C | 1735.3/1753.2 | 268.7/286.3 | 1754.1/1819.0 | 3754.3/3823.3 | 26/26/26/26/26 | 387 |
| ordinary | D | 1717.9/1737.0 | 252.8/281.8 | 1732.4/1752.9 | 3714.9/3732.1 | 26/26/26/26/26 | 387 |
| fanout | chooser | — | 373.3/512.0 | 90.4/110.3 | 457.8/606.5 | 38/38/38/38/38 | 532 |
| fanout | B | 2190.0/2840.8 | 346.2/382.1 | 2236.6/2389.4 | 4769.4/5612.3 | 38/38/38/38/38 | 532 |
| fanout | C | 1724.7/1737.9 | 358.2/467.0 | 1832.0/1849.1 | 3909.0/4048.3 | 38/38/38/38/38 | 532 |
| fanout | D | 1735.3/1753.0 | 385.9/474.5 | 1733.5/1737.7 | 3854.7/3948.3 | 38/38/38/38/38 | 532 |

## Uninstrumented wall clock (independent five trials per cell)

No timing listeners, path interception, screenshot, GC, frame sampler or PerformanceObserver. Same real inputs, readiness waits and asserted exact ending state. Values are host command/settle times, not renderer CPU times. See final-clean.json for exact costs.

| Scene | Mode | Find p50/p95 ms | Choose | Return | Total |
|---|---|---:|---:|---:|---:|
| ordinary | chooser | — | 347.3/348.0 | 97.1/114.0 | 444.5/462.0 |
| ordinary | B | 1911.9/1983.3 | 316.8/333.5 | 1914.0/1930.1 | 4128.6/4143.9 |
| ordinary | C | 1679.0/1683.4 | 300.4/349.9 | 1697.2/1715.4 | 3692.4/3729.9 |
| ordinary | D | 1698.2/1711.5 | 300.1/326.5 | 1737.7/1748.6 | 3730.2/3762.1 |
| fanout | chooser | — | 432.0/446.5 | 85.2/97.5 | 515.6/532.7 |
| fanout | B | 2262.3/2314.4 | 400.1/416.5 | 2314.4/2397.8 | 5012.2/5014.1 |
| fanout | C | 1682.9/1683.7 | 433.3/483.1 | 1714.2/1714.6 | 3830.6/3880.0 |
| fanout | D | 1714.7/1723.9 | 433.3/436.0 | 1731.5/1745.2 | 3883.0/3895.9 |

## Relative one-frame gate

Last required trusted input timestamp to completed card-layer draw with the final pooled top-row label is a presentation proxy, not GPU scanout. For A it is Enter to the final visible window; B/C/D outward and select compare to that same A task endpoint. Return compares to A’s chooser return. Compare each phase’s five-trial p95 latency AND p95 of per-trial frame-gap p95 to its A counterpart +16.7 ms, not to an absolute 16.7 ms. Require no >50 ms gesture tasks, no idle draws, and verified selection/return. With n=5 nearest-rank p95 is the maximum trial; paths/GC are not timed.

| Scene | Mode | Gesture | Input→final draw p50/p95 ms | Frame-gap p95 ms | >50 ms tasks | Mode gate |
|---|---|---|---:|---:|---:|---|
| ordinary | chooser | select | 16.7/20.5 | 16.8 | 0 | baseline |
| ordinary | chooser | back | 12.6/21.1 | 33.3 | 0 | baseline |
| ordinary | B | browse | 191.2/213.1 | 33.4 | 0 | not eligible |
| ordinary | B | select | 12.0/17.7 | 16.8 | 0 | not eligible |
| ordinary | B | back | 275.5/335.7 | 33.4 | 0 | not eligible |
| ordinary | C | browse | 76.1/76.8 | 16.8 | 0 | not eligible |
| ordinary | C | select | 10.2/20.2 | 16.8 | 0 | not eligible |
| ordinary | C | back | 92.6/142.6 | 16.8 | 0 | not eligible |
| ordinary | D | browse | 70.4/86.9 | 16.8 | 0 | not eligible |
| ordinary | D | select | 5.2/9.6 | 16.8 | 0 | not eligible |
| ordinary | D | back | 64.9/81.1 | 16.8 | 0 | not eligible |
| fanout | chooser | select | 12.6/15.5 | 16.8 | 0 | baseline |
| fanout | chooser | back | 12.3/21.1 | 33.5 | 0 | baseline |
| fanout | B | browse | 556.4/1197.0 | 50.0 | 0 | not eligible |
| fanout | B | select | 6.3/14.1 | 16.8 | 0 | not eligible |
| fanout | B | back | 601.8/761.0 | 33.4 | 0 | not eligible |
| fanout | C | browse | 59.3/75.5 | 16.8 | 0 | not eligible |
| fanout | C | select | 5.9/18.6 | 16.8 | 0 | not eligible |
| fanout | C | back | 158.7/175.3 | 33.3 | 0 | not eligible |
| fanout | D | browse | 69.6/86.8 | 16.8 | 0 | not eligible |
| fanout | D | select | 7.2/17.7 | 16.8 | 0 | not eligible |
| fanout | D | back | 62.8/63.6 | 16.8 | 0 | not eligible |

## Retained heap and idle

CDP forced GC then Runtime.getHeapUsage.usedSize before and after each of three full traversals. Range compares traversal 3 with warmed traversal 1; it is not a leak test. All offered pixel totals must arrive and reach the exact window; events fewer than 192 need not imply lost distance.

| Scene | Mode | Received/offered per wheel gesture | Post-GC MiB p50 | Warm retained Δ KiB range | Max idle layer draws/300 ms |
|---|---|---|---:|---:|---:|
| ordinary | chooser | no wheel | 6.6 | 56.3…58.6 | 0 |
| ordinary | B | 97–100 / 192 | 7.1 | 204.0…206.2 | 0 |
| ordinary | C | 98–111 / 192 | 6.9 | 226.8…241.4 | 0 |
| ordinary | D | 97–192 / 192 | 6.6 | 79.3…89.5 | 0 |
| fanout | chooser | no wheel | 6.1 | 68.3…69.8 | 0 |
| fanout | B | 97–99 / 192 | 6.7 | 229.0…238.3 | 0 |
| fanout | C | 98–115 / 192 | 6.5 | 287.6…299.4 | 0 |
| fanout | D | 97–192 / 192 | 6.2 | 93.0…95.1 | 0 |

## Work per visual update (separate untimed replay)

Completed wire-layer draws, replaying each actual wire’s path commands and comparing with the preceding draw; not a count of internal routing function calls. Each raw row is a visual update. Forward/reverse are kept separate.

| Scene | Mode | Direction | Draws | Changed paths p50/p95/max | Max shared paths changed together | Attached descendants |
|---|---|---|---:|---|---:|---:|
| ordinary | B | forward | 98 | 18/18/18 | 0 | 484 |
| ordinary | B | reverse | 98 | 18/18/19 | 0 | 484 |
| fanout | B | forward | 97 | 18/18/117 | 100 | 441 |
| fanout | B | reverse | 97 | 18/18/117 | 100 | 441 |
| ordinary | C | forward | 12 | 32/32/32 | 0 | 484 |
| ordinary | C | reverse | 12 | 32/32/32 | 0 | 484 |
| fanout | C | forward | 12 | 32/131/131 | 100 | 441 |
| fanout | C | reverse | 12 | 32/131/131 | 100 | 441 |
| ordinary | D | forward | 1 | 208/208/208 | 0 | 484 |
| ordinary | D | reverse | 1 | 208/208/208 | 0 | 484 |
| fanout | D | forward | 1 | 307/307/307 | 100 | 441 |
| fanout | D | reverse | 1 | 307/307/307 | 100 | 441 |

## Arrow cost: feature off/on, identical D build

Five alternating pairs per scene. Each pair asserts equal camera, layout hash (all card IDs, positions, dimensions), classification and inspection state at start and after each gesture. Eight physical pointer steps for card drag and empty-space pan; one trusted wheel zoom. Two rAFs to settle are included in elapsed command costs, with separately recorded frame gaps. Actual arrow activation is outside gesture timing; disabled/no-arrow cases record null, never a navigation success.

| Scene | Gesture | Off elapsed p50/p95 ms | On elapsed p50/p95 ms | Paired on−off p50/p95 ms | Frame-gap p95 off/on ms |
|---|---|---:|---:|---:|---:|
| ordinary | drag | 259.4/304.8 | 291.8/356.3 | 32.5/117.3 | 16.7/16.7 |
| ordinary | pan | 225.9/242.1 | 241.0/304.2 | 16.3/96.6 | 16.8/16.8 |
| ordinary | zoom | 108.9/111.3 | 110.8/111.7 | 1.3/2.7 | 16.7/16.8 |
| mounted450 | drag | 451.8/512.8 | 479.9/512.6 | 9.5/60.8 | 33.4/33.3 |
| mounted450 | pan | 484.0/518.3 | 463.2/503.6 | -16.3/5.5 | 33.4/33.4 |
| mounted450 | zoom | 132.3/133.9 | 130.8/134.2 | -3.1/14.4 | 50.0/50.0 |

Navigation actually executed in 10/20 runs; each changed camera translation and preserved scale.

## Scope and reproduction

- Run `bash experiments/konva-browser/build-port-window-candidates.sh`, then sequentially `node experiments/konva-browser/port-window-benchmark.mjs`, `node experiments/konva-browser/port-window-arrow-bench.mjs`, `node experiments/konva-browser/port-window-geometry.mjs`, `node experiments/konva-browser/port-window-clean.mjs`, `node experiments/konva-browser/port-window-report.mjs`. Build trees live only in /tmp/kilo. See build-manifest.json for bundle hashes.
- results.json is the decision summary and raw data index. final-*.png are the corrected screenshots. Only full-strength selected action-color pixels that disappear when *just that exact wire* is hidden qualify. This rules out socket/highlight/layout changes elsewhere. The selected fanout alias is #100, not proof all 100 overlapping bindings are separately visible: a pilot failed the same test for alias #1.
- Two discrete workloads and one wheel cadence are measured operating points, not a continuous fanout breakpoint or a hardware-independent winner. Startup fixture responses are staggered before measurement; all trials compare full card bounds, not just target footprints. Browser callbacks, input queues and compositor scheduling contribute latency. No scene/path function wrappers or timing of screenshot/heap operations in timed trials; passive timing probes still have cost. A chooser paging interaction is a comparable task endpoint, not an identical physical wheel gesture.
- The 450-card fixture holds 445 unrelated inspections pending after five completed owners; its timer shim suppresses owner deadlines. It measures a stable mounted partial scene with 350 wires, not full discovery or active requests. Arrow wall-time includes browser automation; small differences near one refresh interval do not establish CPU scan cost.
- Tier 2: the Aug 2 nodel-webui-v2 graph did not track the five checked paths; source and built loopback behavior were used instead. No full build, live host, deployment or commit.
