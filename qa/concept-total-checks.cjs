// Synthetic rendered totals; expectations are independent raw sums, not UI helpers.
const assert=require('node:assert/strict');
module.exports=async page=>{
 const original=await page.evaluate(()=>({payload:conceptPayload,selection:conceptSelection}));
 const base=original.payload.rows[0];
 const rows=[{...base,ad_name:'AI_UGC'},{...base,ad_id:'second',ad_name:'AI Cartoon',spend:300,purchases:9,revenue:450,impressions:200,link_clicks:10,landing_page_views:10,checkouts:5},{...base,campaign_id:'c2',ad_name:'CC02',spend:20}];
 const total=page.locator('#promo-concept-table tbody tr.subtotal-row');
 const number=n=>n.toLocaleString('en-US',{maximumFractionDigits:2}),percent=n=>n.toFixed(2)+'%';
 for(const selected of [['c1'],['c1','c2'],[],['missing']]){
  await page.evaluate(({rows,selected})=>{conceptPayload={...conceptPayload,rows};chooseConceptCampaigns(selected);},{rows,selected});
  const raw=rows.filter(r=>selected.includes(r.campaign_id));
  if(!raw.length){assert.equal(await total.count(),0);assert.equal(await page.locator('#promo-concept-table tbody tr').count(),0);continue;}
  const sum=k=>raw.reduce((s,r)=>s+r[k],0),s=sum('spend'),p=sum('purchases'),lp=sum('landing_page_views'),co=sum('checkouts');
  assert.deepEqual(await total.locator('td').allTextContents(),['Total',number(s)+'100.00% share',number(p)+'100.00% share',(sum('revenue')/s).toFixed(2)+'x',number(sum('revenue')),percent(sum('link_clicks')/sum('impressions')*100),number(lp),number(s/lp),percent(co/lp*100),percent(p/co*100),percent(p/lp*100)]);
  assert.equal(await page.locator('#promo-concept-table tbody tr:not(.subtotal-row)').count(),selected.length);
  assert.equal(await page.locator('#promo-concept-table tbody tr:first-child').getAttribute('class'),'subtotal-row');
  assert.match(await page.locator('#promo-concept-status').textContent(),new RegExp('^'+selected.length+' concepts'));
 }
 for(const mode of ['zero','empty','error']){
  await page.evaluate(({mode,base})=>{conceptSelection=['c1'];conceptPayload=mode==='error'?null:{...conceptPayload,rows:mode==='empty'?[]:[{...base,...Object.fromEntries(PromoConcepts.inputs.map(k=>[k,0]))}]};renderPromoConcepts();},{mode,base});
  if(mode==='zero')assert.deepEqual(await total.locator('td').allTextContents(),['Total','0— share','0— share','—','0','—','0','—','—','—','—']);
  else assert.equal(await page.locator('#promo-concept-table tbody tr').count(),0);
 }
 await page.evaluate(original=>{conceptPayload=original.payload;chooseConceptCampaigns(original.selection);},original);
};
