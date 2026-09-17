const assert=require('node:assert/strict');
const path=require('node:path');
module.exports=async function(page,viewport,evidenceDir){
 await page.locator('#tab-czsk-promo').click();
 const toggle=page.getByRole('checkbox',{name:'Break down WL influencers',exact:true});
 assert.equal(await toggle.isChecked(),false);
 assert.equal(await page.locator('#tab-filters-czsk-promo #wl-influencer-breakdown').count(),1);
 if(viewport.width>720){
  const boxes=await page.locator('#tab-filters-czsk-promo').evaluate(section=>[...section.querySelectorAll('.filter-toggle,.metric-select,.wl-breakdown-filter')].map(el=>{const r=el.getBoundingClientRect();return{top:r.top,bottom:r.bottom};}));
  assert.equal(boxes.length,4);
  assert.ok(Math.max(...boxes.map(b=>b.bottom))-Math.min(...boxes.map(b=>b.bottom))<=1,`all four Promo filters share one desktop row: ${JSON.stringify({viewport,boxes})}`);
 }
 await page.evaluate(()=>{
  const source=aggregateCampaigns.find(r=>r.id==='c2');
  const extras=[['kate','GLV_301_CZ_WL_ACTIONKATE',300,1500,3,15],['other','GLV_302_CZ_WL_New',100,700,7,30],['ambiguous','GLV_303_CZ_WL_Kristyna_ActionKate',200,100,1,5],['old','GLV_304_CZ_Kristyna',400,500,5,50],['sales','GLV_305_CZ_Sales',500,500,5,50],['precedence','GLV_306_CZ_WL_ActionKate_Promo',600,500,5,50]];
  for(const [id,name,spend,revenue,purchases,lp] of extras){
   const row={...source,id,name,group:promoGroupKey(name),spend,revenue,purchases,lp};
   aggregateCampaigns.push(row);
   dailyCampaigns.push(...['2026-08-10','2026-08-11','2026-08-12'].map(date=>({...row,date})));
  }
  buildAllFilters();renderTab('czsk-promo');promoExpandedGroups.add('wl');renderPromoTable();
 });
 const snapshot=()=>page.evaluate(()=>({totals:aggregate(getPromoKpiRows()),daily:aggregate(getPromoDailyRows()),filters:JSON.stringify(filterState,(_key,value)=>value instanceof Set?[...value]:value),grain:tabGrain['czsk-promo'],expanded:[...promoExpandedGroups]}));
 const before=await snapshot();
 await toggle.focus();await page.keyboard.press('Space');
 assert.equal(await toggle.isChecked(),true);
 assert.deepEqual(await snapshot(),before,'toggle preserves filters, grain, source totals and expansion');
 const labels=['Promo','WL · Kristyna','WL · ActionKate','WL · Other','BAU'];
 for(const grain of ['day','week','month']){
  await page.locator('#tab-grain-czsk-promo').selectOption(grain);
  await page.locator('#chart-metric-promo-spend').selectOption('purchases');
  await page.locator('#chart-metric-promo-roas').selectOption('lp2pur');
  await page.locator('#chart-metric-promo-pie').selectOption('revenue');
  const state=await page.evaluate(()=>({
   lines:['promo-spend','promo-roas'].map(key=>charts[key].data.datasets.map(d=>({label:d.label,metric:d.metricKey,data:d.data,color:d.borderColor}))),
   pie:charts['promo-pie'].data,
   headers:[...document.querySelectorAll('#promo-chart-table-roas thead th')].map(e=>e.textContent),
   kpis:[...document.querySelectorAll('#kpi-czsk-promo .kpi-label')].map(e=>e.textContent),
   total:byPromoGroup(getPromoKpiRows()).reduce((sum,r)=>sum+r.revenue,0),
  }));
  assert.deepEqual(state.lines[0].map(d=>d.label),labels);
  assert.deepEqual(state.headers.slice(1),labels);
  assert.deepEqual(state.pie.labels,labels);
  assert.equal(new Set(state.lines[0].map(d=>d.color)).size,5);
  assert.ok(state.lines[0].every(d=>d.metric==='purchases'));
  assert.ok(state.lines[1].every(d=>d.metric==='lp2pur'));
  assert.equal(state.lines[1][2].data[0],20,'ratio of sums for Kate');
  assert.equal(state.lines[1][3].data[0],8/35*100,'ambiguous and unknown stay Other');
  assert.equal(state.pie.datasets[0].data.reduce((a,b)=>a+b,0),state.total);
  assert.ok(await page.locator('#kpi-czsk-promo').textContent().then(t=>labels.every(label=>t.includes(label))));
  assert.equal(await page.locator('#promo-chart-table-pie tbody tr').count(),5);
  await page.locator('#promo-mode-groups').click();
  for(const key of ['wl-kristyna','wl-actionkate','wl-other']){
   const button=page.locator('#promo-group-toggle-'+key);
   if(await button.getAttribute('aria-expanded')==='true')await button.click();
   await button.click();assert.equal(await button.getAttribute('aria-expanded'),'true');
   assert.equal(await page.locator(`[data-promo-parent="${key}"]`).count(),grain==='day'?3:1);
   await button.click();assert.equal(await page.locator(`[data-promo-parent="${key}"]`).count(),0);
  }
  await page.locator('#promo-mode-days').click();
  const dayToggle=page.locator('.promo-period-toggle').first();
  await dayToggle.focus();await page.keyboard.press('Enter');
  assert.equal(await dayToggle.getAttribute('aria-expanded'),'false');
  await page.waitForFunction(()=>document.activeElement?.classList.contains('promo-period-toggle'),null,{timeout:1000});
  await page.keyboard.press('Enter');assert.equal(await dayToggle.getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('#promo-table .child-row').count(),(grain==='day'?3:1)*5);
 }
 await page.locator('#promo-mode-groups').click();
 await page.locator('#promo-group-toggle-wl-actionkate').click();
 await page.locator('#tab-grain-czsk-promo').selectOption('day');
 await page.locator('#tab-filters-czsk-promo').scrollIntoViewIfNeeded();
 const geometry=await toggle.locator('..').evaluate(el=>{const r=el.getBoundingClientRect();return {height:r.height,left:r.left,right:r.right,width:innerWidth,overflow:document.documentElement.scrollWidth};});
 assert.ok(geometry.height>=44&&geometry.left>=0&&geometry.right<=geometry.width&&geometry.overflow<=geometry.width,JSON.stringify(geometry));
 const clipped=await page.locator('#promo-table .group-badge').evaluateAll(badges=>badges.map(b=>({label:b.textContent,right:b.getBoundingClientRect().right,cellRight:b.closest('td').getBoundingClientRect().right})).filter(b=>b.right>b.cellRight));
 assert.deepEqual(clipped,[],'full influencer labels remain inside table cells');
 await page.evaluate(()=>Object.values(charts).forEach(chart=>{chart.stop();chart.update('none');}));
 await page.waitForTimeout(1200); // Let responsive resize/visibility animations settle before full-page evidence.
 await page.screenshot({path:path.join(evidenceDir,`${viewport.name}-wl-influencers.png`),fullPage:true});
 await toggle.uncheck();
 assert.deepEqual(await page.evaluate(()=>charts['promo-spend'].data.datasets.map(d=>d.label)),['Promo','WL','BAU']);
 assert.equal(await page.locator('#chart-metric-promo-spend').inputValue(),'purchases');
 assert.equal(await page.locator('#chart-metric-promo-roas').inputValue(),'lp2pur');
 assert.equal(await page.locator('#chart-metric-promo-pie').inputValue(),'revenue');
 assert.equal(await page.locator('#promo-group-toggle-wl').getAttribute('aria-expanded'),'true');
 await toggle.check();
 assert.equal(await page.locator('#promo-group-toggle-wl-actionkate').getAttribute('aria-expanded'),'true');
 await page.evaluate(()=>{filterState['tab-czsk-promo-group']=new Set(['wl']);buildAllFilters();renderTab('czsk-promo');});
 assert.ok(await page.evaluate(()=>getPromoKpiRows().length===4&&getPromoKpiRows().every(r=>r.group==='wl')));
 assert.equal(await page.evaluate(()=>window.__promoXss||0),0);
};
