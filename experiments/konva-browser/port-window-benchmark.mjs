import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createOrdinaryFixture, createFanoutFixture, createMounted450Fixture, installPortWindowFixture, LOCAL_SESSION_KEY } from './port-window-fixture.mjs';

export const artifactRoot = fileURLToPath(new URL('../../artifacts/konva-local/port-window/benchmark/', import.meta.url));
export const manifest = JSON.parse(await readFile(resolve(artifactRoot, 'build-manifest.json')));
export async function serve(root) {
  const server = createServer(async (req,res) => {
    try {
      const file = resolve(root, '.' + decodeURIComponent(new URL(req.url,'http://localhost').pathname));
      assert(file.startsWith(root + sep));
      const bytes = await readFile(file);
      res.writeHead(200, {'content-type': {'.html':'text/html','.js':'text/javascript','.css':'text/css'}[extname(file)] ?? 'application/octet-stream'}); res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((yes,no) => { server.once('error',no); server.listen(0,'127.0.0.1',yes); });
  return {server,origin:`http://127.0.0.1:${server.address().port}`};
}
export async function pageFixture(browser, origin, scenario, enabled=true, orderedReads=true) {
  const context = await browser.newContext({viewport:{width:1366,height:768},deviceScaleFactor:1,reducedMotion:'reduce'});
  const page = await context.newPage();
  const fixture = scenario === 'mounted450' ? createMounted450Fixture() : scenario === 'ordinary' ? createOrdinaryFixture() : createFanoutFixture();
  fixture.orderedReads=orderedReads;
  await page.addInitScript(({cards,key}) => sessionStorage.setItem(key,JSON.stringify({version:1,cards,camera:{cx:0,cy:210,scale:1}})),{cards:fixture.cardPositions,key:LOCAL_SESSION_KEY});
  const network = await installPortWindowFixture(page,fixture,origin);
  const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`${origin}/topology-canvas.html?source=local${enabled?'':'&testEdgeNavigation=off'}`);
  await page.waitForFunction(({cards,wires,partial})=>{
    const stage=window.Konva?.stages[0];
    return stage?.find('.topology-card').length===cards && stage.find('.topology-wire').length===wires && (partial ? window.__portWindowHeldOwners.length===4 : document.querySelector('[data-topology-accessible-summary]').textContent.includes('scheduler settled'));
  },{cards:fixture.owners.length,wires:scenario==='ordinary'?250:scenario==='fanout'?343:350,partial:scenario==='mounted450'});
  await page.waitForTimeout(400);
  return {page,context,network,fixture,errors};
}
export const save = (name,data) => writeFile(resolve(artifactRoot,name),JSON.stringify(data,null,2)+'\n');
export const launch = () => chromium.launch({headless:true,channel:'chromium'});
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  import('./port-window-trials.mjs').then(({run})=>run()).catch(error=>{console.error(error);process.exitCode=1;});
}
