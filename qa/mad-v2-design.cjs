// Presentation assertions for the real V2 HTML, invoked by the synthetic API browser harness.
const assert=require('node:assert/strict');
exports.header=async page=>{
 await page.evaluate(()=>window.scrollTo(0,0));
 const geometry=await page.evaluate(()=>{
  const rect=el=>el.getBoundingClientRect().toJSON();
  const shown=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
  const header=rect(document.querySelector('.sticky-header'));
  const disclosures=[...document.querySelectorAll('#v2-date-note,#v2-naming-warnings,#error')].filter(shown).map(el=>({id:el.id,...rect(el)}));
  const controls=[...document.querySelectorAll('.header-top button,.header-top select,.header-top .tick-filter,#updated-at')].filter(el=>shown(el)&&!el.closest('.date-menu')).map(el=>{
   const r=rect(el),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
   return {id:el.id||el.className,...r,reachable:el===hit||el.contains(hit)};
  });
  const active=document.querySelector('[role=tab][aria-selected=true]'),nav=rect(active),hit=document.elementFromPoint(nav.x+nav.width/2,nav.y+nav.height/2);
  return {header,disclosures,controls,nav:{...nav,reachable:active===hit||active.contains(hit)},width:innerWidth,height:innerHeight};
 });
 for(const d of geometry.disclosures)assert.ok(d.top>=geometry.header.bottom-1,`disclosure ${d.id} behind header: ${JSON.stringify(geometry)}`);
 for(const c of geometry.controls)assert.ok(c.width>0&&c.left>=0&&c.right<=geometry.width+1&&c.top>=0&&c.bottom<=geometry.height&&c.reachable,`inaccessible header control: ${JSON.stringify(c)}`);
 assert.ok(geometry.nav.reachable&&geometry.nav.top>=0&&geometry.nav.bottom<=geometry.height,'selected tab remains accessible in the horizontal nav');
 return geometry;
};
exports.inspect=async(page,{width,theme,tab})=>{
 const headerGeometry=await exports.header(page);
 const result=await page.evaluate(()=>{
  const visible=el=>Boolean(el.getClientRects().length)&&!el.closest('.sr-only');
  const title=document.querySelector('.dashboard-title');
  const panel=document.querySelector('.panel.active');
  const grid=panel.querySelector('.kpi-grid');
  return {
   titleSize:parseFloat(getComputedStyle(title).fontSize),
   navCount:document.querySelectorAll('[role=tab]').length,
   navTop:document.querySelector('.header-tabs').getBoundingClientRect().top,
   panelSurface:getComputedStyle(document.querySelector('.section')).backgroundImage,
   kpiColumns:grid?getComputedStyle(grid).gridTemplateColumns.split(' ').length:null,
   actions:[...document.querySelectorAll('.filter-actions')].map(el=>el.firstElementChild.textContent.trim()),
   sticky:[...panel.querySelectorAll('thead th')].filter(visible).map(el=>getComputedStyle(el).position),
   legends:Object.values(charts).filter(c=>visible(c.canvas)&&c.options.plugins.legend.display!==false).map(c=>({position:c.options.plugins.legend.position,align:c.options.plugins.legend.align})),
   textColor:Chart.defaults.color,
   documentWidth:document.documentElement.scrollWidth,
  };
 });
 assert.equal(result.navCount,7);assert.ok(result.titleSize<=25);assert.ok(result.navTop<headerGeometry.header.bottom);
 assert.equal(result.panelSurface,'none');assert.ok(result.actions.length>0);assert.ok(result.actions.every(s=>s==='None'));
 assert.ok(result.sticky.every(s=>s==='sticky'));assert.ok(result.legends.every(l=>l.position==='bottom'&&l.align==='start'),JSON.stringify(result.legends));
 assert.equal(result.textColor,theme==='light'?'#646674':'#b2b5c4');assert.ok(result.documentWidth<=width+1);
 if(width<=720&&result.kpiColumns!==null)assert.equal(result.kpiColumns,2);
 return {width,theme,tab,headerGeometry,...result};
};
exports.interactions=async(page,width,evidence)=>{
 await page.locator('[data-tab="us"]').click();
 if(width<=720)await page.locator('#mobile-controls-toggle').click();
 await page.locator('#date-btn').click();
 const dateBox=await page.locator('#date-menu').boundingBox();
 assert.ok(dateBox&&dateBox.x>=0&&dateBox.x+dateBox.width<=width+1&&dateBox.y>=0&&dateBox.y+dateBox.height<=900,`date picker remains within viewport: ${JSON.stringify({width,dateBox})}`);
 await page.locator('#date-menu .date-preset-item').first().focus();await page.keyboard.press('Escape');
 assert.equal(await page.locator('#date-menu').isVisible(),false);
 await exports.header(page);
 if(width<=720)await page.locator('#mobile-controls-toggle').click();
 const state=()=>page.evaluate(()=>({instances:Object.keys(Chart.instances).length,metrics:JSON.stringify(Object.values(charts).map(c=>c.data)),filters:JSON.stringify(filterState),theme:document.documentElement.dataset.theme}));
 const before=await state();
 for(let i=0;i<6;i++)await page.locator('#theme-toggle').click();
 const after=await state();assert.deepEqual(after,before,'repeated theme toggles must retain chart count/data and filters');
 await page.locator('#filter-toggle-tab-us-campaign').click();
 const menu=page.locator('#filter-dropdown-tab-us-campaign');
 const box=await menu.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=900);
 await page.screenshot({path:require('node:path').join(evidence,`${width}-open-menu.png`)});
 await page.keyboard.press('Escape');assert.equal(await menu.isVisible(),false);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');
 assert.equal(await page.locator('html').getAttribute('data-theme'),before.theme);
 return {width,toggles:6,stableCharts:true,stableMetrics:true,stableFilters:true,menuContained:true,themePersisted:true};
};
