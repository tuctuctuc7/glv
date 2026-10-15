const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
module.exports=async(browser,baseUrl,evidenceDir,{baseline=false}={})=>{
 const results=[];
 for(const width of [2560,1920,1440,1024,768,390,320]) for(const theme of ['dark','light']) {
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  await page.goto(baseUrl+'?period=all',{waitUntil:'networkidle'});
  await page.evaluate(t=>setTheme(t),theme);
  await page.locator('#auditGrain').selectOption('day');
  await page.locator('#auditTable').scrollIntoViewIfNeeded();
  const geometry=await page.evaluate(()=>{
   const t=document.querySelector('#metricsTable'),w=document.querySelector('#auditTableWrap');
   const columns=[...t.querySelectorAll('th')].map(n=>({label:n.textContent,width:n.getBoundingClientRect().width,font:getComputedStyle(n).fontSize}));
   const clipped=[...t.querySelectorAll('td')].filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>n.textContent);
   return {table:t.getBoundingClientRect().width,viewport:w.clientWidth,columns,clipped,overflow:document.documentElement.scrollWidth-innerWidth,bodyFont:getComputedStyle(t.querySelector('td')).fontSize};
  });
  if(!baseline){assert.deepEqual(geometry.clipped,[]);assert.ok(geometry.overflow<=1);assert.ok(geometry.table>=geometry.viewport-1,'table fills available scrollport');if(width>=1440)assert.ok(Math.abs(geometry.table-geometry.viewport)<=1,'no unnecessary desktop scroll');}
  await page.locator('#auditTable').screenshot({path:path.join(evidenceDir,`home-${baseline?'before':'after'}-${width}-${theme}.png`)});
  const sticky=await page.evaluate(()=>{
   const w=document.querySelector('#auditTableWrap'),h=document.querySelector('#metricsTable th'),d=document.querySelector('#metricsTableBody tr:nth-child(3) td');
   const before={h:h.getBoundingClientRect().top,d:d.getBoundingClientRect().left};w.scrollLeft=500;w.scrollTop=200;
   return new Promise(resolve=>requestAnimationFrame(()=>resolve({left:w.scrollLeft,top:w.scrollTop,headerDelta:h.getBoundingClientRect().top-before.h,dimensionDelta:d.getBoundingClientRect().left-before.d})));
  });
  if(geometry.table>geometry.viewport+1) assert.ok(sticky.left>0);assert.ok(sticky.top>0);assert.ok(Math.abs(sticky.headerDelta)<2);assert.ok(Math.abs(sticky.dimensionDelta)<2);
  const states=[];
  if(!baseline) for(const region of ['all','czsk','us','row']) {
   await page.locator('[data-region="all"]').evaluate(n=>n.click());
   if(region!=='all') await page.locator(`[data-region="${region}"]`).evaluate(n=>n.click());
   for(const grain of ['day','week','month','year']) {
    await page.locator('#auditGrain').selectOption(grain);
    const result=await page.evaluate(()=>{
     const keys=['spend','revenue','roas','cac','nc_roas','new_customer_rate','new_customer_revenue','returning_customer_revenue','cvr','purchases','cpa','aov','unique_visitors'];
     const grain=document.querySelector('#auditGrain').value,combined=rowsForGrain(getViewData(),grain);
     const rows=[metrics.aggregateRows(combined.rows),...metrics.groupRows(combined.rows,grain).reverse()];
     const expected=rows.map(r=>keys.map(k=>['spend','revenue','roas','nc_roas','new_customer_revenue','returning_customer_revenue'].includes(k)?formatAuditMetric(k,r[k]):formatMetric(k,r[k])));
     const actual=[...document.querySelectorAll('#metricsTableBody tr')].map(r=>[...r.cells].slice(1).map(c=>c.textContent));
     const clipped=[...document.querySelectorAll('#metricsTable td')].filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>n.textContent);
     return {expected,actual,clipped,history:combined.history.rows.length};
    });
    assert.deepEqual(result.actual,result.expected,`${width}/${theme}/${region}/${grain}: every summary/detail value aligns`);
    assert.deepEqual(result.clipped,[],`${region}/${grain}: no clipped values`);
    if(['month','year'].includes(grain)&&['all','czsk'].includes(region)) assert.ok(result.history>0);
    else assert.equal(result.history,0);
    states.push({region,grain,rows:result.actual.length,history:result.history});
   }
  }
  results.push({width,theme,...geometry,sticky,states});await page.close();
 }
 fs.writeFileSync(path.join(evidenceDir,`home-${baseline?'before':'after'}-geometry.json`),JSON.stringify(results,null,2));
};
if(require.main===module){
 const {chromium}=require('playwright-core');const http=require('node:http');
 const root=path.resolve(__dirname,'../public');const dir=process.env.GLV_QA_EVIDENCE_DIR||'/tmp/glv-home-compact-evidence';fs.mkdirSync(dir,{recursive:true});
 const server=http.createServer((req,res)=>{let p=path.join(root,new URL(req.url,'http://localhost').pathname);if(fs.existsSync(p)&&fs.statSync(p).isDirectory())p=path.join(p,'index.html');if(!fs.existsSync(p))return res.writeHead(404).end();res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'})[path.extname(p)]||'application/octet-stream');fs.createReadStream(p).pipe(res);});
 (async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const libs='/home/tom/.cache/hermes-browser-libs/root';const browser=await chromium.launch({executablePath:'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`,XDG_DATA_DIRS:`${libs}/usr/share`}});try{await module.exports(browser,`http://127.0.0.1:${server.address().port}/glv/`,dir,{baseline:process.argv.includes('--baseline')});console.log('Home geometry passed');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
}
