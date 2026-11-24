import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {launch,manifest,serve,pageFixture,save} from './port-window-benchmark.mjs';
import {setup,cleanRoundTrip,layoutSignature} from './port-window-trials.mjs';
// No event capture, rAF sampling, observers, scene replay, screenshots or GC in these trials.
const browser=await launch(),servers={},modes=['chooser','B','C','D'];try{
  for(const m of modes)servers[m]=await serve(resolve(manifest.buildRoot,m));
  const samples=[];for(let rep=0;rep<5;rep++)for(const scene of ['ordinary','fanout'])for(let i=0;i<4;i++){
    const mode=modes[(rep+i)%4],{context,page,errors,network}=await pageFixture(browser,servers[mode].origin,scene);
    try{await setup(page,scene);const dimensions=await layoutSignature(page),previous=samples.find(s=>s.scene===scene);if(previous)assert.deepEqual(previous.dimensions,dimensions);samples.push({scene,mode,rep:rep+1,dimensions,...await cleanRoundTrip(page,mode,scene)});assert.deepEqual(errors,[]);assert.equal(network.requests.blocked.length,0);}finally{await context.close();}
  }await save('final-clean.json',samples);
}finally{await browser.close();for(const s of Object.values(servers))s.server.close();}
