const assert = require('node:assert/strict');
module.exports = async (browser, baseUrl) => {
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  try {
    await page.goto(baseUrl+'?period=all',{waitUntil:'networkidle'});
    async function check(canvas, axis='y') {
      const ticks = await page.evaluate(({canvas,axis}) => Chart.getChart(document.querySelector(canvas)).scales[axis].ticks.map(t=>({value:t.value,label:t.label})), {canvas,axis});
      assert.ok(ticks.length>2, `${canvas}/${axis}: rendered ticks`);
      assert.equal(new Set(ticks.map(t=>t.label)).size,ticks.length,`${canvas}/${axis}: distinct CPV labels ${JSON.stringify(ticks)}`);
      for(const tick of ticks) assert.ok(Math.abs(Number(tick.label.replace(/[^0-9.-]/g,''))-tick.value)<0.005,`${canvas}/${axis}: preserve decimals ${JSON.stringify(tick)}`);
    }
    await page.selectOption('#trendMetric','cpv');
    await page.selectOption('#trendMetricSecondary','cpv');
    const homeCanvas = await page.evaluate(()=> '#'+state.chart.canvas.id);
    await check(homeCanvas); await check(homeCanvas,'y1');
    await page.click('#phasesViewTab');
    await page.selectOption('#phaseMetric','cpv'); await check('#phaseChart');
    await page.selectOption('#promoMetric','cpv'); await check('#promoChart');
    await page.click('[data-phase-mode="promo"]'); await check('#promoChart');
    await page.click('[data-phase-mode="month"]'); await check('#promoChart');
  } finally { await page.close(); }
};
if(require.main===module){
 const {chromium}=require('playwright-core'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
 const root=path.resolve(__dirname,'../public');
 const server=http.createServer((req,res)=>{let p=path.join(root,new URL(req.url,'http://localhost').pathname);if(fs.existsSync(p)&&fs.statSync(p).isDirectory())p=path.join(p,'index.html');if(!fs.existsSync(p))return res.writeHead(404).end();res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'})[path.extname(p)]||'application/octet-stream');fs.createReadStream(p).pipe(res);});
 (async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const libs='/home/tom/.cache/hermes-browser-libs/root';const browser=await chromium.launch({executablePath:'/home/tom/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:`${libs}/usr/lib/x86_64-linux-gnu:${libs}/usr/lib`,FONTCONFIG_PATH:`${libs}/etc/fonts`,XDG_DATA_DIRS:`${libs}/usr/share`}});try{await module.exports(browser,`http://127.0.0.1:${server.address().port}/glv/`);console.log('Rendered CPV axes passed');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
}
