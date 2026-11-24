import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import pngjs from 'pngjs';
import {artifactRoot,manifest,serve,pageFixture,save,launch} from './port-window-benchmark.mjs';
import {TARGET_BY_SCENARIO} from './port-window-fixture.mjs';
const {PNG}=pngjs;
const modes=['chooser','B','C','D'];
const q=(a,p=.95)=>[...a].sort((x,y)=>x-y)[Math.ceil(a.length*p)-1];
const id=(scene,n)=>'e-'+Array.from(JSON.stringify(['binding',scene==='ordinary'?'simple:densea':'simple:peerb','action','simple:'+(scene==='ordinary'?`denseaaction${n}`:`alias${n}${n==='208'?'100':'001'}`)]),c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
export async function setup(page,scene){
  await page.evaluate(scene=>{
    const stage=window.Konva.stages[0]; const card=stage.find('.topology-card').find(c=>c.find('Text').some(t=>t.text()===(scene==='ordinary'?'Dense-A':'Dense-B')));
    const rows=()=>card.find('Circle').map(s=>s.getAttr('accessibleDescription')).filter(s=>s?.startsWith(scene==='ordinary'?'DenseA-Action-':'Local-')).sort();
    const host=stage.container().getBoundingClientRect(); const pos=card.getAbsolutePosition(); const x=host.left+pos.x,y=host.top+pos.y;
    const camera=()=>[stage.x(),stage.y(),stage.scaleX()];
    const name=card.find('Text').find(t=>t.text()===(scene==='ordinary'?'Dense-A':'Dense-B'));const hp=name.getAbsoluteTransform().point({x:name.width()/2,y:name.height()/2});
    window.bench={stage,card,rows,camera,header:[host.left+hp.x,host.top+hp.y],wheel:[x+(scene==='ordinary'?165:40),y+110]};
  },scene);
  await page.mouse.click(...await page.evaluate(()=>window.bench.header));
  await page.getByRole('button',{name:/Ports and bindings/}).click();
  const expand=page.getByRole('button',{name:'Expand ports'}); if(await expand.isVisible()) await expand.click();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.waitForTimeout(150);
  const labels=await page.evaluate(()=>window.bench.rows());assert.equal(labels.length,16); assert(labels[0].endsWith('001'));
}
// Instrument neither sceneFunc nor the application in timing trials. Only passive input,
// rAF, layer completion stamps and the browser's own Long Task entries are observed.
async function begin(page){await page.evaluate(()=>{
    const b=window.bench; const r={start:performance.now(),frames:[],draws:[],events:[],long:[]}; b.record=r;
  const frame=t=>{r.frames.push(t);r.raf=requestAnimationFrame(frame);};r.raf=requestAnimationFrame(frame);
  const event=e=>r.events.push([e.type,e.key??e.deltaY,e.timeStamp,e.isTrusted]);
  document.addEventListener('wheel',event,true);document.addEventListener('keydown',event,true);
  // Observe one stable pooled socket, never traverse paths during timings.
  const top=b.card.find('Circle').find(c=>c.getAttr('accessibleDescription')===b.rows()[0]);r.topAtDraw=[];
  b.card.getLayer().on('draw.bench',()=>{r.draws.push(performance.now());r.topAtDraw.push(top?.getAttr('accessibleDescription'));});
  const observer=new PerformanceObserver(list=>r.long.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask'});
  b.finish=()=>{r.long.push(...observer.takeRecords().map(e=>e.duration));observer.disconnect();cancelAnimationFrame(r.raf);b.card.getLayer().off('.bench');document.removeEventListener('wheel',event,true);document.removeEventListener('keydown',event,true);return {...r,end:performance.now()};};
});}
const frames=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
export async function wheel(page,dir){
  await page.mouse.move(...await page.evaluate(()=>window.bench.wheel));
  const start=performance.now(),pending=[],offered=[];
  for(let i=0;i<192;i++){
    const delay=start+i*1000/120-performance.now();if(delay>0)await new Promise(r=>setTimeout(r,delay));
    offered.push(performance.now()-start);pending.push(page.mouse.wheel(0,dir*24));
  }
  await Promise.all(pending);
  await page.waitForFunction(dir=>window.bench.rows()[0]?.endsWith(dir===1?'193':'001'),dir,{timeout:3000});
  await frames(page);return {offered,scheduledHz:120,packetPx:dir*24};
}
export async function choose(page,exact){
  await page.locator('.canvas-stage').focus();await page.keyboard.press('p');
  const dialog=page.locator('.canvas-binding-chooser');await dialog.waitFor({state:'visible'});
  const row=dialog.locator(`[data-binding-id="${exact}"]`);let pages=0;
  while(!await row.count()){assert(++pages<=80,'binding ID absent');await page.keyboard.press('PageDown');}
  assert.equal(await row.getAttribute('data-binding-id'),exact);await row.focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'hidden'});await frames(page);return pages;
}
async function proof(page,exact,file){
  const rgb=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--nodel-topology-action-strong').trim().split(/\s+/).map(Number));
  const selected=await page.screenshot();
  await page.evaluate(id=>{const w=window.bench.stage.findOne('#'+id);w.hide();w.getLayer().draw();},exact);
  const mask=await page.screenshot();
  await page.evaluate(id=>{const w=window.bench.stage.findOne('#'+id);w.show();w.getLayer().draw();},exact);
  const a=PNG.sync.read(selected),b=PNG.sync.read(mask);let pixels=0,example;
  for(let i=0;i<a.data.length;i+=4)if(rgb.length===3 && rgb.every((v,k)=>v===a.data[i+k]) && rgb.some((v,k)=>v!==b.data[i+k])){pixels++;example??=[(i/4)%a.width,Math.floor(i/4/a.width)];}
  assert(pixels>0,`no visible exact-wire selected ink (${rgb})`);
  if(file){await writeFile(resolve(artifactRoot,file+'-selected.png'),selected);await writeFile(resolve(artifactRoot,file+'-exact-wire-hidden.png'),mask);}
  return {exact,pixels,example,rgb};
}
async function phase(page,action){await begin(page);const value=await action();const r=await page.evaluate(()=>window.bench.finish());
  const gaps=r.frames.slice(1).map((v,i)=>v-r.frames[i]);const last=r.events.at(-1)?.[2];
  return {value,ms:r.end-r.start,events:r.events,frames:r.frames,draws:r.draws,topAtDraw:r.topAtDraw,long:r.long,gap95:q(gaps),lastInputToDraw:r.draws.find((t,i)=>t>=last&&r.topAtDraw[i]===r.topAtDraw.at(-1))-last};}
async function heap(cdp){await cdp.send('HeapProfiler.collectGarbage');return (await cdp.send('Runtime.getHeapUsage')).usedSize;}
const state=page=>page.evaluate(()=>({rows:window.bench.rows(),camera:window.bench.camera()}));
export const layoutSignature=page=>page.evaluate(()=>window.bench.stage.find('.topology-card').map(c=>{const rect=c.find('Rect').find(r=>!r.x()&&!r.y());return [c.id(),c.x(),c.y(),rect.width(),rect.height()];}).sort());
export async function cleanRoundTrip(page,mode,scene){
  const before=await state(page),start=performance.now();if(mode!=='chooser')await wheel(page,1);
  const atTarget=performance.now();await choose(page,id(scene,'208'));const selected=performance.now();
  const found=await state(page);assert.equal(found.rows.at(-1),TARGET_BY_SCENARIO[scene]);assert.deepEqual(found.camera,before.camera);
  const goBack=performance.now();if(mode==='chooser')await choose(page,id(scene,'001'));else await wheel(page,-1);
  const end=performance.now();assert.deepEqual(await state(page),before);
  return {browseMs:mode==='chooser'?null:atTarget-start,selectMs:selected-atTarget,backMs:end-goBack,totalMs:selected-start+end-goBack};
}
async function trial(browser,origin,mode,scene,rep){
  const {page,context,errors,network,fixture}=await pageFixture(browser,origin,scene);
  try{await setup(page,scene);const initial=await state(page),target=id(scene,'208'),home=id(scene,'001');
    const layout=await page.evaluate(()=>window.bench.stage.find('.topology-card').map(c=>[c.id(),c.x(),c.y(),true]));
    assert.deepEqual(layout.sort(),fixture.cardPositions.sort());
    const cdp=await context.newCDPSession(page);const baselineHeap=await heap(cdp);
    const direct=mode!=='chooser';const browse=direct?await phase(page,()=>wheel(page,1)):null;
    const select=await phase(page,()=>choose(page,target));const found=await state(page);
    assert.equal(found.rows.at(-1),TARGET_BY_SCENARIO[scene]);assert.deepEqual(found.camera,initial.camera);
    // Outside ALL timing intervals. Hide just the expected wire at the same selected camera/layout.
    const pixels=await proof(page,target,rep===1?`final-${mode}-${scene}`:null);
    const back=await phase(page,()=>direct?wheel(page,-1):choose(page,home));assert.deepEqual(await state(page),initial);
    for(const p of [browse,back].filter(p=>p?.events.some(([t])=>t==='wheel'))){assert(p.events.every(e=>e[3]));assert.equal(Math.abs(p.events.reduce((s,e)=>s+e[1],0)),4608);}
    // Revisit independently of elapsed measurements; warm one traversal before trend comparison.
    const postGC=[baselineHeap,await heap(cdp)];for(let i=0;i<2;i++){if(direct)await wheel(page,1);await choose(page,target);if(direct)await wheel(page,-1);else await choose(page,home);assert.deepEqual(await state(page),initial);postGC.push(await heap(cdp));}
    const idle=await page.evaluate(async()=>{let n=0;const layers=window.bench.stage.getLayers();for(const l of layers)l.on('draw.idle',()=>n++);await new Promise(r=>setTimeout(r,300));for(const l of layers)l.off('.idle');return n;});
    assert.deepEqual(errors,[]);assert.equal(network.requests.blocked.length,0);
    return {mode,scene,rep,browse,select,back,pixels,postGC,idle,initial,found,layout,dimensions:await layoutSignature(page),returned:true};
  }finally{await context.close();}
}
export async function run(){const browser=await launch(),servers={};const samples=[];
  try{for(const mode of modes)servers[mode]=await serve(resolve(manifest.buildRoot,mode));
    for(let r=0;r<(process.env.SMOKE?1:5);r++)for(const scene of ['fanout','ordinary'])for(let i=0;i<4;i++){
      const mode=modes[(i+r)%4];if(process.env.SMOKE && mode!==process.env.SMOKE)continue;
      const sample=await trial(browser,servers[mode].origin,mode,scene,r+1),previous=samples.find(s=>s.scene===scene);
      if(previous){assert.deepEqual(sample.dimensions,previous.dimensions);assert.deepEqual(sample.initial,previous.initial);}
      samples.push(sample);console.log('verified',mode,scene,r+1);await save('final-progress.json',samples);
    }
    await save('final-trials.json',samples);
  }finally{await browser.close();for(const {server} of Object.values(servers))server.close();}
}
