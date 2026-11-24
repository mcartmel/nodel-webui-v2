import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {artifactRoot,manifest,save} from './port-window-benchmark.mjs';
const load=async name=>JSON.parse(await readFile(resolve(artifactRoot,name)));
const samples=await load('final-trials.json'),arrows=await load('final-arrows.json'),geometry=await load('final-geometry.json');
const clean=await load('final-clean.json');assert.equal(clean.length,40);
assert.equal(samples.length,40);assert.equal(arrows.length,20);
const q=(a,p=.95)=>{assert(a.length&&a.every(Number.isFinite));return [...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1];};
const f=n=>n.toFixed(1),pair=a=>`${f(q(a,.5))}/${f(q(a))}`;
const ms=[],costs=[],gates=[],arrowTable=[];
const summary=[];
for(const scene of ['ordinary','fanout']){
  let baseline;
  for(const mode of ['chooser','B','C','D']){
    const rows=samples.filter(r=>r.scene===scene&&r.mode===mode);assert.deepEqual(rows.map(r=>r.rep),[1,2,3,4,5]);
    const phases=rows.flatMap(r=>[r.browse,r.select,r.back].filter(Boolean));
    const gesture=key=>rows.map(r=>r[key].ms);
    const round=rows.map(r=>(r.browse?.ms??0)+r.select.ms+r.back.ms);
    const gap=key=>q(rows.map(r=>r[key].gap95));const latency=key=>q(rows.map(r=>r[key].lastInputToDraw));
    const keys=mode==='chooser'?['select','back']:['browse','select','back'];
    const long=phases.flatMap(p=>p.long).filter(x=>x>50);const idle=Math.max(...rows.map(r=>r.idle));
    const metrics=Object.fromEntries(keys.map(k=>[k,{frameP95:gap(k),latencyP95:latency(k)}]));
    if(!baseline)baseline=metrics;
    const passes=keys.every(k=>{const ref=baseline[k]??baseline.select;return metrics[k].frameP95<=ref.frameP95+16.7 && metrics[k].latencyP95<=ref.latencyP95+16.7;})&&!long.length&&!idle;
    summary.push({scene,mode,metrics,long,idle,passes});
    costs.push(`| ${scene} | ${mode} | ${mode==='chooser'?'—':pair(gesture('browse'))} | ${pair(gesture('select'))} | ${pair(gesture('back'))} | ${pair(round)} | ${rows.map(r=>r.select.value).join('/')} | ${Math.min(...rows.map(r=>r.pixels.pixels))} |`);
    for(const k of keys)gates.push(`| ${scene} | ${mode} | ${k} | ${pair(rows.map(r=>r[k].lastInputToDraw))} | ${f(metrics[k].frameP95)} | ${rows.reduce((s,r)=>s+r[k].long.filter(x=>x>50).length,0)} | ${mode==='chooser'?'baseline':passes?'eligible':'not eligible'} |`);
    const warm=rows.map(r=>(r.postGC.at(-1)-r.postGC[1])/1024);const packets=rows.flatMap(r=>r.browse?[r.browse.events.length,r.back.events.length]:[]);
    ms.push(`| ${scene} | ${mode} | ${packets.length?`${Math.min(...packets)}–${Math.max(...packets)} / 192`:'no wheel'} | ${f(q(rows.map(r=>r.postGC.at(-1)/1048576),.5))} | ${f(Math.min(...warm))}…${f(Math.max(...warm))} | ${idle} |`);
  }
}
const recommended=['B','C','D'].find(m=>summary.filter(s=>s.mode===m).every(s=>s.passes))??'chooser';
const decision=summary.filter(r=>r.mode==='chooser').map(a=>{
  const series=summary.filter(s=>s.scene===a.scene&&s.mode!=='chooser').map(s=>`${s.mode} ${f(s.metrics.browse.latencyP95)} ms`).join(', ');
  return `- **${a.scene}:** allowed outward p95 ${f(a.metrics.select.latencyP95)} + 16.7 = ${f(a.metrics.select.latencyP95+16.7)} ms; observed ${series}.`;
});
const cleanTable=summary.map(({scene,mode})=>{const rows=clean.filter(r=>r.scene===scene&&r.mode===mode);assert.equal(rows.length,5);return `| ${scene} | ${mode} | ${mode==='chooser'?'—':pair(rows.map(r=>r.browseMs))} | ${pair(rows.map(r=>r.selectMs))} | ${pair(rows.map(r=>r.backMs))} | ${pair(rows.map(r=>r.totalMs))} |`;});
for(const scene of ['ordinary','mounted450'])for(const gesture of ['drag','pan','zoom']){
 const a=arrows.filter(r=>r.scene===scene&&r.enabled),b=arrows.filter(r=>r.scene===scene&&!r.enabled);assert.equal(a.length,5);assert.equal(b.length,5);
 const delta=a.map(on=>on[gesture].ms-b.find(off=>off.rep===on.rep)[gesture].ms);
 const gap=rows=>rows.flatMap(r=>r[gesture].frames.slice(1).map((t,i)=>t-r[gesture].frames[i]));
 arrowTable.push(`| ${scene} | ${gesture} | ${pair(b.map(r=>r[gesture].ms))} | ${pair(a.map(r=>r[gesture].ms))} | ${pair(delta)} | ${f(q(gap(b)))}/${f(q(gap(a)))} |`);
}
const report=[`# Port-window decision: ${recommended}`, '', 'This replaces the earlier gate. Five rotated current-source trials per workload/mode at 1366×768, DPR 1, loopback Chromium. Frozen A remains historical only; A here is the same-source chooser with identical geometry. Gates are per workload; a global promotion requires passing both. No production build or live requests.', '',
...decision,'',`All measured browsing trials finished with verified selection and return. ${recommended==='chooser'?'No direct variant qualifies on both workloads. Retain chooser; no default change.':`Qualifying candidate: ${recommended}; coordinate with main before changing the default.`} This is not a human task-time ranking: direct trials include paced input followed by the same chooser search.`, '',
'## Round trip: locate port 208, select one named binding, restore rows 001–016 and camera','',
'Each dense side has 244 ports. All start at rows 001–016, end the outward trip at 193–208 and return exactly 192 rows. B/C/D receive 192 trusted Playwright wheel packets (24 px at 120/s, 4,608 px per direction), recorded even when Chromium coalesces them. Fanout scrolls the left local endpoint of Dense-B; 100 distinct aliases on Peer-B enter the same socket. A has no direct wheel operation: it finds and selects through the chooser, then reopens it to select the home binding. Direct variants find by wheel and use the real chooser to disambiguate the exact wire. All compare chooser data-binding-id with an independently constructed canonical ID. Every sample verifies original camera/rows on return.', '',
'Browser-clock elapsed command/settle time, ms p50/p95; sums exclude screenshots, GC, fixture setup and correctness probes between phases. Select includes chooser search and Enter, including the FIND for A. No human think time. Final trials JSON has each gesture’s exact timings, offered packet schedule, received events, layer and rAF timestamps.', '',
'| Scene | Mode | Wheel find | Choose binding | Return | Round trip | Chooser PageDowns (5 trials) | Min exact selected pixels |','|---|---|---:|---:|---:|---:|---|---:|',...costs,'',
'## Uninstrumented wall clock (independent five trials per cell)','','No timing listeners, path interception, screenshot, GC, frame sampler or PerformanceObserver. Same real inputs, readiness waits and asserted exact ending state. Values are host command/settle times, not renderer CPU times. See final-clean.json for exact costs.','','| Scene | Mode | Find p50/p95 ms | Choose | Return | Total |','|---|---|---:|---:|---:|---:|',...cleanTable,'',
'## Relative one-frame gate','',
'Last required trusted input timestamp to completed card-layer draw with the final pooled top-row label is a presentation proxy, not GPU scanout. For A it is Enter to the final visible window; B/C/D outward and select compare to that same A task endpoint. Return compares to A’s chooser return. Compare each phase’s five-trial p95 latency AND p95 of per-trial frame-gap p95 to its A counterpart +16.7 ms, not to an absolute 16.7 ms. Require no >50 ms gesture tasks, no idle draws, and verified selection/return. With n=5 nearest-rank p95 is the maximum trial; paths/GC are not timed.', '',
'| Scene | Mode | Gesture | Input→final draw p50/p95 ms | Frame-gap p95 ms | >50 ms tasks | Mode gate |','|---|---|---|---:|---:|---:|---|',...gates,'',
'## Retained heap and idle','',
'CDP forced GC then Runtime.getHeapUsage.usedSize before and after each of three full traversals. Range compares traversal 3 with warmed traversal 1; it is not a leak test. All offered pixel totals must arrive and reach the exact window; events fewer than 192 need not imply lost distance.', '',
'| Scene | Mode | Received/offered per wheel gesture | Post-GC MiB p50 | Warm retained Δ KiB range | Max idle layer draws/300 ms |','|---|---|---|---:|---:|---:|',...ms,'',
'## Work per visual update (separate untimed replay)','',
'Completed wire-layer draws, replaying each actual wire’s path commands and comparing with the preceding draw; not a count of internal routing function calls. Each raw row is a visual update. Forward/reverse are kept separate.', '',
'| Scene | Mode | Direction | Draws | Changed paths p50/p95/max | Max shared paths changed together | Attached descendants |','|---|---|---|---:|---|---:|---:|',...geometry.flatMap(r=>['forward','reverse'].map(k=>{const a=r[k].map(v=>v.changed);return `| ${r.scene} | ${r.mode} | ${k} | ${a.length} | ${q(a,.5)}/${q(a)}/${Math.max(...a)} | ${Math.max(...r[k].map(v=>v.sharedChanged))} | ${r.descendants} |`;})),'',
'## Arrow cost: feature off/on, identical D build','',
'Five alternating pairs per scene. Each pair asserts equal camera, layout hash (all card IDs, positions, dimensions), classification and inspection state at start and after each gesture. Eight physical pointer steps for card drag and empty-space pan; one trusted wheel zoom. Two rAFs to settle are included in elapsed command costs, with separately recorded frame gaps. Actual arrow activation is outside gesture timing; disabled/no-arrow cases record null, never a navigation success.', '',
'| Scene | Gesture | Off elapsed p50/p95 ms | On elapsed p50/p95 ms | Paired on−off p50/p95 ms | Frame-gap p95 off/on ms |','|---|---|---:|---:|---:|---:|',...arrowTable,'',`Navigation actually executed in ${arrows.filter(r=>r.navigation).length}/${arrows.length} runs; each changed camera translation and preserved scale.`, '',
'## Scope and reproduction','',
'- Run `bash experiments/konva-browser/build-port-window-candidates.sh`, then sequentially `node experiments/konva-browser/port-window-benchmark.mjs`, `node experiments/konva-browser/port-window-arrow-bench.mjs`, `node experiments/konva-browser/port-window-geometry.mjs`, `node experiments/konva-browser/port-window-clean.mjs`, `node experiments/konva-browser/port-window-report.mjs`. Build trees live only in /tmp/kilo. See build-manifest.json for bundle hashes.',
'- results.json is the decision summary and raw data index. final-*.png are the corrected screenshots. Only full-strength selected action-color pixels that disappear when *just that exact wire* is hidden qualify. This rules out socket/highlight/layout changes elsewhere. The selected fanout alias is #100, not proof all 100 overlapping bindings are separately visible: a pilot failed the same test for alias #1.',
'- Two discrete workloads and one wheel cadence are measured operating points, not a continuous fanout breakpoint or a hardware-independent winner. Startup fixture responses are staggered before measurement; all trials compare full card bounds, not just target footprints. Browser callbacks, input queues and compositor scheduling contribute latency. No scene/path function wrappers or timing of screenshot/heap operations in timed trials; passive timing probes still have cost. A chooser paging interaction is a comparable task endpoint, not an identical physical wheel gesture.',
'- The 450-card fixture holds 445 unrelated inspections pending after five completed owners; its timer shim suppresses owner deadlines. It measures a stable mounted partial scene with 350 wires, not full discovery or active requests. Arrow wall-time includes browser automation; small differences near one refresh interval do not establish CPU scan cost.',
'- Tier 2: the Aug 2 nodel-webui-v2 graph did not track the five checked paths; source and built loopback behavior were used instead. No full build, live host, deployment or commit.',''].join('\n');
await save('results.json',{recommended,summary,files:{samples:'final-trials.json',clean:'final-clean.json',arrows:'final-arrows.json',geometry:'final-geometry.json',manifest:'build-manifest.json'},buildRoot:manifest.buildRoot});await writeFile(resolve(artifactRoot,'report.md'),report);console.log('Recommended:',recommended);
