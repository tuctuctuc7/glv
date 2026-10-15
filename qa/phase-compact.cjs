const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const headers = ['Dimension','Spend','Revenue','Avg daily revenue','Share','ROAS','CAC','NC ROAS','NC Rate','NC Revenue','RC Revenue','CVR','Purchases','Cost per purchase','AOV','Visitors','Number of days'];
module.exports = async (browser, baseUrl, evidenceDir) => {
 const results=[];
 for(const width of [2560,1920,1440,1024,768,390,320]) for(const theme of ['dark','light']) {
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  const page=await context.newPage();
  await page.goto(baseUrl,{waitUntil:'networkidle'});
  await page.evaluate(t=>setTheme(t),theme);
  await page.locator('#phasesViewTab').click();
  for(const hierarchy of ['month-phase','phase-month']) for(const split of [false,true]) {
   await page.locator('#phaseHierarchy').selectOption(hierarchy);
   await page.locator('#phaseInfluSplit').setChecked(split,{force:true});
   for(const expanded of [false,true]) {
    await page.evaluate(expanded=>{
     const days=phases.buildPhaseDays(state.data.rows,state.data.phases,state.data.phase_contract.latest_date);
     state.phaseExpanded=new Set(expanded?phases.buildHierarchy(days,$('phaseHierarchy').value,$('phaseInfluSplit').checked).filter(n=>n.expandable).map(n=>n.id):[]);
     state.phaseExpansionInitialized=true; renderPhaseTable(days);
    },expanded);
    await page.evaluate(()=>document.fonts.ready);
    const actualHeaders=await page.locator('#phaseTable th').allTextContents();
    const geometry=await page.evaluate(()=>{
     const wrap=document.querySelector('.phase-table-wrap');wrap.scrollLeft=0;wrap.scrollTop=0;
     const cells=[...document.querySelectorAll('#phaseTableBody td:first-child')];
     const header=document.querySelector('#phaseTable th'); const range=document.createRange();range.selectNodeContents(header);const hs=getComputedStyle(header);
     const needed=Math.max(range.getBoundingClientRect().width+parseFloat(hs.paddingLeft)+parseFloat(hs.paddingRight),...cells.map(c=>{const s=getComputedStyle(c);return parseFloat(s.paddingLeft)+c.firstElementChild.getBoundingClientRect().width+parseFloat(s.paddingRight);}));
     const first=cells[0].getBoundingClientRect();
     const clips=cells.some(c=>c.firstElementChild.getBoundingClientRect().right>c.getBoundingClientRect().right-1);
     const touch=[...document.querySelectorAll('#phaseTable .phase-disclosure')].every(b=>b.getBoundingClientRect().height>=44);
     const head=document.querySelector('#phaseTable th').getBoundingClientRect();wrap.scrollLeft=350;wrap.scrollTop=180;
     return {table:document.querySelector('#phaseTable').getBoundingClientRect().width,viewport:wrap.clientWidth,firstWidth:first.width,needed,clips,touch,stickyX:Math.abs(cells[0].getBoundingClientRect().x-first.x)<1,stickyY:Math.abs(document.querySelector('#phaseTable th').getBoundingClientRect().y-head.y)<1,scroll:wrap.scrollLeft>0,overflow:document.documentElement.scrollWidth>innerWidth+1};
    });
    results.push({width,theme,hierarchy,split,expanded,...geometry});
    fs.writeFileSync(path.join(evidenceDir,process.env.PHASE_BASELINE?'phase-before.json':'phase-after.json'),JSON.stringify(results,null,2));
    if(!process.env.PHASE_BASELINE) {
     assert.deepEqual(actualHeaders,headers);
     assert.ok(geometry.firstWidth<=geometry.needed+2,JSON.stringify(results.at(-1)));
     assert.ok(!geometry.clips&&!geometry.overflow&&geometry.stickyX&&geometry.stickyY);
     assert.ok(geometry.table>=geometry.viewport-1);
     assert.equal(geometry.scroll,geometry.table>geometry.viewport+1);
     if(width<720) assert.ok(geometry.touch);
     const mismatch=await page.evaluate(()=>{
      const days=phases.buildPhaseDays(state.data.rows,state.data.phases,state.data.phase_contract.latest_date);
      const nodes=new Map(phases.buildHierarchy(days,$('phaseHierarchy').value,$('phaseInfluSplit').checked).map(n=>[n.id,n]));
      const keys=['spend','revenue','avg_daily_revenue','share','roas','cac','nc_roas','new_customer_rate','new_customer_revenue','returning_customer_revenue','cvr','purchases','cpa','aov','unique_visitors','day_count'];
      return [...document.querySelectorAll('#phaseTableBody tr')].some(row=>keys.some((key,i)=>row.cells[i+1].textContent!==(key==='share'?(nodes.get(row.dataset.phaseNode).share==null?'—':formatMetric('new_customer_rate',nodes.get(row.dataset.phaseNode).share)):phaseMetricCell(key,nodes.get(row.dataset.phaseNode).metrics[key]))));
     });
     assert.equal(mismatch,false,'every rendered metric stays aligned with its header');
    }
    if(expanded&&split){await page.locator('.phase-table-wrap').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidenceDir,`phase-${process.env.PHASE_BASELINE?'before':'after'}-${width}-${theme}-${hierarchy}.png`)});}
   }
  }
  await context.close();
 }
};
if(require.main===module) {
 const {chromium}=require('playwright-core'); const http=require('node:http');
 const server=http.createServer((req,res)=>{let p=path.join(__dirname,'../public',new URL(req.url,'http://localhost').pathname);if(fs.statSync(p).isDirectory())p=path.join(p,'index.html');res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.json')?'application/json':'text/html');fs.createReadStream(p).pipe(res);});
 (async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:'/home/tom/.cache/hermes-browser-libs/root/usr/lib/x86_64-linux-gnu:/home/tom/.cache/hermes-browser-libs/root/usr/lib'}});try{const dir='/tmp/glv-phase-compact-evidence';fs.mkdirSync(dir,{recursive:true});await module.exports(browser,`http://127.0.0.1:${server.address().port}/glv/`,dir);console.log('Phase compact matrix passed');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
}
