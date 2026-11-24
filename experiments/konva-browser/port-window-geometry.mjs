import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {launch,manifest,serve,pageFixture,save,artifactRoot} from './port-window-benchmark.mjs';
import {setup,wheel} from './port-window-trials.mjs';
// Deliberately separate browser process from the timing matrix. Replaying scene commands
// measures changed *painted* paths per wire-layer draw, not internal routing invocations.
const browser=await launch();try{const samples=[];for(const mode of ['B','C','D']){
  const {origin,server}=await serve(resolve(manifest.buildRoot,mode));try{for(const scene of ['ordinary','fanout']){
    const {page,context}=await pageFixture(browser,origin,scene);try{await setup(page,scene);await page.evaluate(()=>{
      const b=window.bench,wires=b.stage.find('.topology-wire'),layer=wires[0].getLayer();const last=new Map();const shared=new Set(wires.filter(w=>{
        const tuple=JSON.parse(w.id().slice(2).match(/.{4}/g).map(s=>String.fromCharCode(parseInt(s,16))).join(''));return tuple[3].startsWith('simple:alias208');
      }).map(w=>w.id()));
      const measure=()=>{let changed=0,sharedChanged=0;for(const w of wires){const commands=[];const ctx={beginPath(){},stroke(){},fill(){},closePath(){}};for(const method of ['moveTo','lineTo','bezierCurveTo'])ctx[method]=(...args)=>commands.push([method,...args]);w.sceneFunc()(ctx,w);const sig=JSON.stringify(commands),old=last.get(w.id());if(old!==undefined&&sig!==old){changed++;if(shared.has(w.id()))sharedChanged++;}last.set(w.id(),sig);}return {changed,sharedChanged};};
      measure();b.updates=[];b.shared=shared.size;layer.on('draw.paths',()=>b.updates.push(measure()));
    });await wheel(page,1);const forward=await page.evaluate(()=>window.bench.updates.splice(0));await wheel(page,-1);const reverse=await page.evaluate(()=>window.bench.updates.splice(0));const shared=await page.evaluate(()=>window.bench.shared);
    if(scene==='fanout'){assert.equal(shared,100);for(const direction of [forward,reverse])assert.equal(Math.max(...direction.map(d=>d.sharedChanged)),100);}
    const descendants=await page.evaluate(()=>{const size=n=>1+(n.getChildren?.()??[]).reduce((s,c)=>s+size(c),0);return size(window.bench.stage)-1;});
    samples.push({mode,scene,shared,forward,reverse,descendants});
    await page.setViewportSize({width:1920,height:1080});await page.waitForTimeout(300);await page.screenshot({path:resolve(artifactRoot,`final-${mode}-${scene}-1920.png`)});
  }finally{await context.close();}}}finally{server.close();}}
  await save('final-geometry.json',samples);
}finally{await browser.close();}
