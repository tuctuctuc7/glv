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
  // Synthetic future-launch fixtures, not live campaign data.
  const extras=[['kate','GLV_301_CZ_WL_ACTIONKATE',300,1500,3,15],['other','GLV_302_CZ_WL_New',100,700,7,30],['ambiguous','GLV_303_CZ_WL_Kristyna_ActionKate',200,100,1,5],['old','GLV_304_CZ_Kristyna',400,500,5,50],['sales','GLV_305_CZ_Sales',500,500,5,50],['precedence','GLV_306_CZ_WL_ActionKate_Promo',600,500,5,50],['befit','WL_befit_over40',800,2400,4,20],['befit-prefixed','GLV_307_CZ_WL_BEFIT_OVER40',200,400,6,60],['befit-kristyna','GLV_308_CZ_WL_befit_over40_Kristyna',70,90,2,10],['befit-kate','GLV_309_CZ_WL_befit_over40_ActionKate',80,110,3,20]];
  for(const [id,name,spend,revenue,purchases,lp] of extras){
   const [row]=processAggregateRows([{id,name,amount_spent:String(spend),'action_values:omni_purchase':String(revenue),'actions:omni_purchase':String(purchases),'actions:landing_page_view':String(lp)}]);
   if(!row)throw new Error('Launch campaign lost in normalization: '+name);
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
 const warning=page.locator('#wl-naming-warning');
 await warning.waitFor({state:'visible',timeout:2000});
 assert.match(await warning.textContent(),/breakdown unavailable until each WL campaign identifies exactly one recognized creator/i);
 assert.match(await warning.textContent(),/Combined WL totals shown/);
 for(const name of ['GLV_302_CZ_WL_New','GLV_303_CZ_WL_Kristyna_ActionKate','GLV_308_CZ_WL_befit_over40_Kristyna','GLV_309_CZ_WL_befit_over40_ActionKate'])assert.ok((await warning.textContent()).includes(name));
 const assertCombined=async()=>{
  const state=await page.evaluate(()=>({
   groups:activePromoGroups().map(g=>g.label),
   lines:['promo-spend','promo-roas'].map(key=>charts[key].data.datasets.map(d=>d.label)),
   pie:charts['promo-pie'].data.labels,
   accessible:document.querySelector('#promo-chart-table-spend').textContent,
   kpis:document.querySelector('#kpi-czsk-promo').textContent,
   table:document.querySelector('#promo-table').textContent,
   source:aggregate(getPromoKpiRows()),grouped:aggregate(byPromoGroup(getPromoKpiRows())),
   daily:aggregate(getPromoDailyRows()),periods:aggregate(byDateGroup(getPromoDailyRows()))
  }));
  assert.deepEqual(state.groups,['Promo','WL','BAU']);
  for(const labels of [...state.lines,state.pie])assert.deepEqual(labels,state.groups);
  for(const text of [state.accessible,state.kpis,state.table]){assert.ok(text.includes('WL'));assert.doesNotMatch(text,/WL ·|Other/);}
  assert.deepEqual(state.source,state.grouped);assert.deepEqual(state.daily,state.periods);
  assert.equal(await toggle.isChecked(),true);
 };
 await assertCombined();
 assert.equal(await warning.locator('li').count(),4,'aggregate/daily duplicates are listed once');
 await page.locator('#promo-mode-days').click();
 await assertCombined();
 await page.locator('#promo-mode-groups').click();
 // Zero and multiple matches are separate failures. A hostile source name is literal, never HTML.
 await page.evaluate(()=>{
  const row={...aggregateCampaigns.find(r=>r.id==='other'),id:'hostile-wl',name:'GLV_310_CZ_WL_Unknown_"><svg onload=window.__wlXss=1></svg>'};
  aggregateCampaigns.push(row);dailyCampaigns.push({...row,date:'2026-08-10'});
  filterState['tab-czsk-promo-campaign']=new Set(['hostile-wl']);buildAllFilters();renderTab('czsk-promo');
 });
 assert.ok((await warning.textContent()).includes('<svg onload=window.__wlXss=1></svg>'));
 assert.equal(await warning.locator('svg').count(),0);
 assert.equal(await page.evaluate(()=>window.__wlXss||0),0);
 await assertCombined();
 await page.locator('#tab-filters-czsk-promo').scrollIntoViewIfNeeded();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);Object.values(charts).forEach(chart=>{chart.stop();chart.update('none');});});
 await page.waitForTimeout(1200);
 await page.screenshot({path:path.join(evidenceDir,`${viewport.name}-wl-naming-warning.png`),fullPage:true});
 await page.evaluate(()=>{filterState['tab-czsk-promo-campaign']=new Set(['ambiguous']);buildAllFilters();renderTab('czsk-promo');});
 await assertCombined();
 assert.ok((await warning.textContent()).includes('GLV_303_CZ_WL_Kristyna_ActionKate'));
 assert.ok(!(await warning.textContent()).includes('GLV_302_CZ_WL_New'),'excluded campaigns do not block or appear');
 // Excluded invalid campaigns remain in the source: valid selected scope recovers without resetting ON.
 await page.evaluate(()=>{
  filterState['tab-czsk-promo-campaign']=new Set(aggregateCampaigns.filter(r=>!['other','ambiguous','befit-kristyna','befit-kate','hostile-wl'].includes(r.id)).map(r=>r.id));
  buildAllFilters();renderTab('czsk-promo');
 });
 assert.equal(await warning.isVisible(),false);
 assert.equal(await toggle.isChecked(),true);
 const labels=['Promo','WL · Kristyna','WL · ActionKate','WL · befit_over40','BAU'];
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
  assert.equal(new Set(state.lines[0].map(d=>d.color)).size,labels.length);
  assert.ok(state.lines[0].every(d=>d.metric==='purchases'));
  assert.ok(state.lines[1].every(d=>d.metric==='lp2pur'));
  assert.equal(state.lines[1][2].data[0],20,'ratio of sums for Kate');
  assert.equal(state.lines[1][3].data[0],10/80*100,'befit ratio of sums (not mean campaign ratios)');
  assert.equal(state.pie.datasets[0].data.reduce((a,b)=>a+b,0),state.total);
  assert.ok(await page.locator('#kpi-czsk-promo').textContent().then(t=>labels.every(label=>t.includes(label))));
  assert.equal(await page.locator('#promo-chart-table-pie tbody tr').count(),labels.length);
  await page.locator('#promo-mode-groups').click();
  for(const key of ['wl-kristyna','wl-actionkate','wl-befit-over40']){
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
  assert.equal(await page.locator('#promo-table .child-row').count(),(grain==='day'?3:1)*labels.length);
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
 for(const theme of ['dark','light']){
  if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#theme-toggle').click();
  const badge=page.locator('#promo-table .group-wl-befit-over40').first();
  const style=await badge.evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));
  assert.notEqual(style.background,'rgba(0, 0, 0, 0)','befit uses a native colored badge');
  for(const title of ['Promo Period Split','Promo Group Charts','Promo Group Table']){
   const button=page.getByRole('button',{name:`About ${title}`,exact:true});
   await button.focus();
   const popup=page.locator('#'+await button.getAttribute('aria-controls'));
   await popup.waitFor({state:'visible'});
   assert.match(await popup.textContent(),/Every WL campaign must identify exactly one recognized creator/);
   const box=await popup.boundingBox();
   assert.ok(box.x>=0&&box.x+box.width<=viewport.width,`${theme} ${title} popup fits`);
   await page.keyboard.press('Escape');
  }
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);Object.values(charts).forEach(chart=>{chart.options.animation=false;chart.resize();chart.update('none');});});
  await page.waitForTimeout(500);
  await page.screenshot({path:path.join(evidenceDir,`${viewport.name}-wl-influencers-${theme}.png`),fullPage:true});
 }
 await page.locator('#theme-toggle').click(); // Restore the suite's default dark theme.
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
 // Campaign subsets and explicit none must feed every surface, with no toggle reset.
 await page.evaluate(()=>{filterState['tab-czsk-promo-campaign']=new Set(['befit']);buildAllFilters();renderTab('czsk-promo');});
 for(const enabled of [true,false,true]){
  await toggle.setChecked(enabled);
  const filtered=await page.evaluate(()=>({
   kpi:aggregate(getPromoKpiRows()).spend,
   values:[...document.querySelectorAll('#kpi-czsk-promo .kpi-val')].map(e=>e.textContent),
   line:charts['promo-spend'].data.datasets.map(d=>({label:d.label,data:d.data})),
   pie:charts['promo-pie'].data.datasets[0].data,
   table:document.querySelector('#promo-table').textContent,
   accessible:document.querySelector('#promo-chart-table-spend').textContent,
  }));
  assert.equal(filtered.kpi,800);
  assert.ok(filtered.values.includes('800'));
  const selected=filtered.line.find(d=>d.label===(enabled?'WL · befit_over40':'WL'));
  assert.deepEqual(selected.data,[4,4,4]);
  assert.equal(filtered.pie.reduce((a,b)=>a+b,0),2400);
  assert.match(filtered.table,/2,400/);
  assert.ok(filtered.accessible.includes(enabled?'WL · befit_over40':'WL'));
 }
 await page.evaluate(()=>{filterState['tab-czsk-promo-campaign']=new Set();buildAllFilters();renderTab('czsk-promo');});
 assert.equal(await page.evaluate(()=>getPromoKpiRows().length+getPromoDailyRows().length),0);
 assert.equal(await page.evaluate(()=>charts['promo-pie'].data.datasets[0].data.reduce((a,b)=>a+b,0)),0);
 assert.equal(await warning.isVisible(),false,'explicit none has no naming blockers');
 // Daily-only invalid data must prevent a misleading split even with valid aggregate names.
 await page.evaluate(()=>{
  filterState['tab-czsk-promo-campaign']=new Set(['c2']);
  dailyCampaigns=dailyCampaigns.map(r=>r.id==='c2'?{...r,name:'GLV_102_CZ_WL_Unspecified'}:r);
  buildAllFilters();renderTab('czsk-promo');
 });
 assert.equal(await warning.isVisible(),true);
 await assertCombined();
 await toggle.uncheck();
 assert.equal(await warning.isVisible(),false,'OFF remains combined without a split warning');
 await toggle.check();
 assert.equal(await warning.isVisible(),true);
 // A real in-app load replaces the synthetic invalid rows with the server's valid names.
 await page.evaluate(()=>loadData({force:true}));
 assert.equal(await toggle.isChecked(),true);
 assert.equal(await warning.isVisible(),false);
 assert.deepEqual(await page.evaluate(()=>charts['promo-spend'].data.datasets.map(d=>d.label)),labels);
 assert.equal(await page.evaluate(()=>byPromoGroup(getPromoKpiRows()).find(r=>r.group==='wl-kristyna').spend),26000);
 // Promo-only active dates exclude invalid daily names outside the represented Promo scope.
 await page.evaluate(()=>{
  filterState['tab-czsk-promo-group']=null;filterState['tab-czsk-promo-campaign']=null;
  const row={...dailyCampaigns.find(r=>r.id==='c2'),date:'2026-08-09',name:'GLV_102_CZ_WL_Unspecified'};
  dailyCampaigns.push(row);buildAllFilters();setPromoActiveDaysOnly(false);
 });
 assert.equal(await warning.isVisible(),true);
 await page.evaluate(()=>setPromoActiveDaysOnly(true));
 assert.equal(await warning.isVisible(),false,'excluded dates do not block');
 assert.deepEqual(await page.evaluate(()=>charts['promo-spend'].data.datasets.map(d=>d.label)),labels);
 // Promo precedence, US rows and Lead-gen exclusions do not become naming blockers.
 await page.evaluate(()=>{
  const row=aggregateCampaigns.find(r=>r.id==='c2');
  for(const [id,name,segment] of [['precedence-invalid','GLV_401_CZ_WL_Unspecified_Promo','czsk'],['lead-invalid','GLV_402_CZ_WL_Unspecified_Lead','czsk'],['us-invalid','GLV_403_US_WL_Unspecified','us']]){
   const extra={...row,id,name,segment,group:promoGroupKey(name)};
   aggregateCampaigns.push(extra);dailyCampaigns.push({...extra,date:'2026-08-10'});
  }
  buildAllFilters();renderTab('czsk-promo');
 });
 assert.equal(await warning.isVisible(),false);
 assert.equal(await page.evaluate(()=>window.__promoXss||window.__wlXss||0),0);
};
