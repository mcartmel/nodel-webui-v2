import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {launch,manifest,serve,pageFixture,save,artifactRoot} from './port-window-benchmark.mjs';
async function state(page){return page.evaluate(()=>{
  const stage=window.Konva.stages[0],host=stage.container().getBoundingClientRect();const cards=stage.find('.topology-card');const bounds=cards.map(c=>{const f=c.find('Rect').find(r=>!r.x()&&!r.y());return [c.id(),c.x(),c.y(),f.width(),f.height()];}).sort();
  const label=cards.flatMap(c=>c.find('Text')).find(t=>t.text()==='Dense-A');const h=label.getAbsoluteTransform().point({x:label.width()/2,y:label.height()/2});
  let empty;for(let y=64;!empty&&y<stage.height()-80;y+=40)for(let x=80;!empty&&x<stage.width()-80;x+=50){if(!stage.getIntersection({x,y})&&document.elementFromPoint(host.left+x,host.top+y)?.closest('.konvajs-content'))empty=[host.left+x,host.top+y];}
  const expected={left:0,right:0,up:0,down:0};for(const [,x,y,w,h] of bounds){const l=stage.x()+x*stage.scaleX(),t=stage.y()+y*stage.scaleY(),r=l+w*stage.scaleX(),b=t+h*stage.scaleY();const dx=r<=0?-r:l>=stage.width()?l-stage.width():-1,dy=b<=0?-b:t>=stage.height()?t-stage.height():-1;if(dx<0&&dy<0)continue;const d=dx/stage.width()>=dy/stage.height()?(r<=0?'left':'right'):(b<=0?'up':'down');expected[d]++;}
  return {bounds,camera:[stage.x(),stage.y(),stage.scaleX()],header:[h.x+host.left,h.y+host.top],empty,expected,inspection:document.querySelector('[data-topology-accessible-summary]').textContent};
});}
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function cost(page,action){await page.evaluate(()=>{const f=[],e=[],long=[];let raf;const frame=t=>{f.push(t);raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);const event=x=>e.push([x.type,x.timeStamp]);for(const k of ['pointermove','pointerdown','pointerup','wheel','click'])document.addEventListener(k,event,true);const observer=new PerformanceObserver(list=>long.push(...list.getEntries().map(v=>v.duration)));observer.observe({type:'longtask'});window.finishCost=()=>{cancelAnimationFrame(raf);observer.disconnect();for(const k of ['pointermove','pointerdown','pointerup','wheel','click'])document.removeEventListener(k,event,true);return {frames:f,events:e,long};};});
  const start=performance.now();await action();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const ms=performance.now()-start;const r=await page.evaluate(()=>window.finishCost());return {...r,ms};}
async function move(page,point){await page.mouse.move(...point);await page.mouse.down();await page.mouse.move(point[0]+32,point[1]+16,{steps:8});await page.mouse.up();}
async function sample(browser,origin,scene,enabled,rep){const {context,page,errors,network}=await pageFixture(browser,origin,scene,enabled,true);try{
  const start=await state(page);await page.waitForTimeout(200);assert.deepEqual(await state(page),start);
  const drag=await cost(page,()=>move(page,start.header)),a=await state(page);assert.notDeepEqual(a.bounds,start.bounds);assert.deepEqual(a.camera,start.camera);
  const pan=await cost(page,()=>move(page,a.empty)),b=await state(page);assert.deepEqual(a.bounds,b.bounds);assert.notDeepEqual(a.camera,b.camera);
  const zoom=await cost(page,async()=>{await page.mouse.move(...b.empty);await page.mouse.wheel(0,-120);}),c=await state(page);assert(c.camera[2]>b.camera[2]);
  await page.waitForTimeout(180);const buttons=page.locator('.edge-navigation-button:not([hidden])');const counts=await buttons.evaluateAll(bs=>Object.fromEntries(bs.map(b=>[[...b.classList].find(s=>/^edge-navigation-(up|down|left|right)$/.test(s)).slice(16),Number(b.querySelector('.edge-navigation-count').textContent)])));
  assert.deepEqual(counts,enabled?Object.fromEntries(Object.entries(c.expected).filter(([,v])=>v)):{});
  let navigation=null;if(await buttons.count()){if(rep===1)await page.screenshot({path:resolve(artifactRoot,`final-arrows-${scene}.png`)});await buttons.first().click();const d=await state(page);assert.notDeepEqual(d.camera,c.camera);assert.equal(d.camera[2],c.camera[2]);navigation={before:c.camera,after:d.camera};}
  assert.deepEqual(errors,[]);assert.equal(network.requests.blocked.length,0);return {scene,enabled,rep,drag,pan,zoom,counts,navigation,states:[start,a,b,c].map(s=>({layout:hash(s.bounds),camera:s.camera,expected:s.expected,inspection:s.inspection}))};
}finally{await context.close();}}
const browser=await launch(),server=await serve(resolve(manifest.buildRoot,'D'));try{const rows=[];for(const scene of ['ordinary','mounted450'])for(let rep=1;rep<=5;rep++){const pair=[];for(const enabled of [rep%2===1,rep%2!==1]){const s=await sample(browser,server.origin,scene,enabled,rep);pair.push(s);rows.push(s);}assert.deepEqual(pair[0].states,pair[1].states);console.log('arrows matched',scene,rep);await save('final-arrows-progress.json',rows);}await save('final-arrows.json',rows);}finally{await browser.close();server.server.close();}
