/* Optional real-Chromium X6 router comparison. Run: node test/topology-router.bench.mjs */
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ configFile: './vite.config.ts', server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://127.0.0.1:${address.port}/nodes.html`);
  await page.waitForTimeout(1500);
  const result = await page.evaluate(async () => {
    const { TopologyCanvas } = await import('/src/features/topology/topology-canvas.ts');
    const root = document.createElement('div'); root.style.cssText = 'position:absolute;left:0;top:0;width:1200px;height:820px'; document.body.replaceChildren(root);
    const canvas = new TopologyCanvas(root);
    const nodeSpecs = [
      ['A',{x:70,y:90}], ['B',{x:720,y:90}], ['C',{x:390,y:340}], ['D',{x:70,y:570}], ['E',{x:720,y:570}], ['F',{x:1040,y:330}]
    ];
    const nodes = nodeSpecs.map(([id,position]) => ({ id,title:id,status:'Ready',summary:'',position,ports:[{id:'in',label:'Input',direction:'input'},{id:'out',label:'Output',direction:'output'}] }));
    const pairs = [['A','B'],['B','A'],['A','B'],['A','C'],['A','D'],['A','E'],['F','E']];
    const wires = pairs.map(([a,b],i) => ({ id:`w${i}`,source:{nodeId:a,portId:'out'},target:{nodeId:b,portId:'in'} }));
    canvas.update({nodes,wires});
    const measure = (router,connector) => {
      const records=[];
      for (const [index,edge] of canvas.graph.getEdges().entries()) {
        edge.setRouter({name:router,args:{padding:20,step:12,startDirections:['right','bottom','top','left'],endDirections:['left','right','top','bottom']}});
        edge.setConnector({name:connector,args:{radius:8}});
      }
      for (const [index,edge] of canvas.graph.getEdges().entries()) {
        const view=canvas.graph.findViewByCell(edge), path=view.container.querySelector('.connection');
        const d=path.getAttribute('d'), length=path.getTotalLength(), point=(at)=>path.getPointAtLength(at);
        const source=edge.getSourceNode(), target=edge.getTargetNode();
        const portCenter=(cell,id)=>{const r=canvas.graph.findViewByCell(cell).findPortElem(id).querySelector('circle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};};
        const s=portCenter(source,edge.getSourcePortId()), t=portCenter(target,edge.getTargetPortId()), p0=point(0), p1=point(length);
        const cardHits=[];
        for(const cell of canvas.graph.getNodes()) { if(cell===source||cell===target)continue; const r=canvas.graph.findViewByCell(cell).container.querySelector('rect').getBoundingClientRect(); for(let k=0;k<=Math.min(500,Math.ceil(length/3));k++){const p=point(length*k/Math.min(500,Math.ceil(length/3)));if(p.x>r.left&&p.x<r.right&&p.y>r.top&&p.y<r.bottom){cardHits.push(cell.getData().domainId);break;}} }
        const chord=Math.hypot(t.x-s.x,t.y-s.y);
        records.push({id:`w${index}`,d,length,chord,stretch:chord?length/chord:0,anchorError:Math.max(Math.hypot(p0.x-s.x,p0.y-s.y),Math.hypot(p1.x-t.x,p1.y-t.y)),waypoints:edge.getVertices().length,largeWaypoint:edge.getVertices().some(p=>Math.abs(p.x)>2400||Math.abs(p.y)>2400),cardHits});
      }
      const pathKeys=records.map(r=>r.d);
      return {router,connector,edges:records.length,totalLength:+records.reduce((n,r)=>n+r.length,0).toFixed(1),meanLength:+(records.reduce((n,r)=>n+r.length,0)/records.length).toFixed(1),meanStretch:+(records.reduce((n,r)=>n+r.stretch,0)/records.length).toFixed(3),maxStretch:+Math.max(...records.map(r=>r.stretch)).toFixed(3),maxAnchorError:+Math.max(...records.map(r=>r.anchorError)).toFixed(2),nodeIntersections:records.reduce((n,r)=>n+r.cardHits.length,0),coincidentPairs:records.reduce((n,r,i)=>n+pathKeys.slice(i+1).filter(d=>d===r.d).length,0),largeWaypoints:records.filter(r=>r.largeWaypoint).length,waypoints:records.reduce((n,r)=>n+r.waypoints,0),paths:records.map(r=>({id:r.id,length:+r.length.toFixed(1),stretch:+r.stretch.toFixed(3),anchorError:+r.anchorError.toFixed(2),waypoints:r.waypoints,cardHits:r.cardHits}))};
    };
    const combos=[];
    for(const router of ['orth','manhattan','metro']) for(const connector of ['rounded','jumpover']) { const start=performance.now(); const stats=measure(router,connector); combos.push({...stats,elapsedMs:+(performance.now()-start).toFixed(2)}); }
    return {fixture:{nodes:nodes.length,wires:wires.length,positions:nodeSpecs},combos};
  });
  console.log(JSON.stringify(result,null,2));
} finally { await browser?.close(); await server.close(); }
