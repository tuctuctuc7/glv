'use strict';
// Real browser Date + focus rollover, actual handlers and last-good publication.
const dates=require('../public/glv-meta-ads-v2/dates.js');
async function run({pages,transport,check}){
 const ready=p=>p.waitForFunction(()=>document.querySelector('#loading')?.style.display==='none',null,{timeout:15000});
 const state=p=>p.evaluate(()=>({range:lastGoodSources?.[0]?.range,requested:presetBounds(datePreset||'last_7d'),rows:aggregateCampaigns.length,ads:adCreatives.length,visible:!!document.querySelector('#panel-czsk')?.getClientRects().length,warning:document.querySelector('#error').innerText,label:document.querySelector('#date-btn-range').textContent,sequence:loadSequence,generation:lastGoodSources?.[0]?.shared_generation_id,chart:[...document.querySelectorAll('#panel-czsk canvas')].some(e=>Chart.getChart(e)?.data.datasets.some(d=>d.data.length)),table:!!document.querySelector('#panel-czsk tbody tr')}));
 const choose=async(p,preset)=>{await p.locator('#date-btn').click();await p.locator('.date-preset-item[data-p="'+preset+'"]').click();await ready(p);};
 for(const boundary of [{name:'Prague',before:'2026-11-10T22:59:59Z',after:'2026-11-10T23:00:01Z',advances:false},{name:'Los Angeles',before:'2026-11-11T07:59:59Z',after:'2026-11-11T08:00:01Z',advances:true}]){
  transport.reset();transport.setClock(boundary.before);
  for(const p of pages){await p.clock.setFixedTime(new Date(boundary.before));await p.evaluate(()=>sessionStorage.clear());await p.reload({waitUntil:'domcontentloaded'});await ready(p);await p.locator('[data-tab="czsk"]').click();await choose(p,'last_7d');}
  const before=await Promise.all(pages.map(state));
  for(const [i,s]of before.entries()){check('browser-midnight-cold-load',{boundary:boundary.name,version:i+1},true,s.rows>0&&s.ads>0&&s.visible&&s.chart&&s.table);check('browser-midnight-initial-range',{boundary:boundary.name,version:i+1},dates.rangeFor('last_7d',new Date(boundary.before)),s.range);}
  transport.hold(true);transport.setClock(boundary.after);
  for(const p of pages){await p.clock.setFixedTime(new Date(boundary.after));await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.waitForTimeout(150);await ready(p);}
  for(const [i,p]of pages.entries()){
   const s=await state(p);check('browser-midnight-focus-refresh',{boundary:boundary.name,version:i+1},boundary.advances,s.sequence>before[i].sequence);check('browser-midnight-retained-visible',{boundary:boundary.name,version:i+1},true,s.rows>0&&s.ads>0&&s.visible&&s.chart&&s.table);check('browser-midnight-actual-history',{boundary:boundary.name,version:i+1},before[i].range,s.range);
   if(boundary.advances)check('browser-midnight-missing-coverage-disclosed',{version:i+1},true,/not selected-range totals; missing dates are not zero/.test(s.warning)&&/Available/.test(s.label));
   // Force real handler failure by removing all Redis bytes (no browser fixture interception).
   const saved=new Map(transport.values);transport.values.clear();await p.locator('#refresh-data').click();await ready(p);const failed=await state(p);check('browser-midnight-hard-failure-history',{boundary:boundary.name,version:i+1},true,failed.rows>0&&failed.visible&&/Refresh unavailable/.test(failed.warning));for(const [k,v]of saved)transport.values.set(k,v);
  }
  // Cold document at new time still reads the retained publication, with its real range.
  if(boundary.advances)for(const [i,p]of pages.entries()){await p.reload({waitUntil:'domcontentloaded'});await ready(p);await p.locator('[data-tab="czsk"]').click();await choose(p,'last_7d');const s=await state(p);check('browser-midnight-cold-stale',{version:i+1},true,s.rows>0&&s.visible&&/missing dates are not zero/.test(s.warning));check('browser-midnight-cold-stale-range',{version:i+1},before[i].range,s.range);}
  transport.hold(false);
  for(const [i,p]of pages.entries()){await p.locator('#refresh-data').click();await ready(p);const s=await state(p);check('browser-midnight-recovery',{boundary:boundary.name,version:i+1},dates.rangeFor('last_7d',new Date(boundary.after)),s.range);check('browser-midnight-recovery-visible',{boundary:boundary.name,version:i+1},true,s.rows>0&&s.ads>0&&s.visible&&s.chart&&s.table&&!/Refresh unavailable|missing dates are not zero/.test(s.warning));await choose(p,'last_month');const historical=await state(p);check('browser-historical-selection',{boundary:boundary.name,version:i+1},dates.rangeFor('last_month',new Date(boundary.after)),historical.range);}
 }
 for(const [i,p]of pages.entries()){
  await p.locator('#date-btn').click();await p.locator('#date-from').fill('2026-01-01');await p.locator('#date-to').fill('2026-03-31');await p.locator('.date-apply-btn').click();await ready(p);
  const s=await state(p);check('browser-custom-90-history',{version:i+1},{since:'2026-01-01',until:'2026-03-31'},s.range);check('browser-custom-90-visible',{version:i+1},true,s.visible&&s.rows>0&&s.chart&&s.table);
  await p.locator('#date-btn').click();await p.locator('#date-to').fill('2026-04-01');let alert='';p.once('dialog',async d=>{alert=d.message();await d.dismiss();});await p.locator('.date-apply-btn').click();check('browser-custom-91-rejected',{version:i+1},'Select at most 90 completed days.',alert);await p.locator('#date-btn').click();
  await p.locator('[data-tab="wl"]').click();await p.locator('#wl-date').selectOption('custom');await p.locator('#wl-from').fill('2026-01-01');await p.locator('#wl-to').fill('2026-03-31');await p.locator('#wl-apply').click();await p.waitForFunction(()=>!document.querySelector('#wl-status').textContent.startsWith('Loading'));check('browser-wl-custom-90',{version:i+1},true,/2026-01-01.*2026-03-31/.test(await p.locator('#wl-status').innerText())&&!/unavailable/.test(await p.locator('#wl-status').innerText()));
  await p.locator('#wl-to').fill('2026-04-01');await p.locator('#wl-apply').click();check('browser-wl-custom-91-rejected',{version:i+1},'Select at most 90 completed days.',await p.locator('#wl-status').innerText());
 }
 for(const v2 of [false,true]){const q=new URLSearchParams({type:'aggregate',date_preset:'last_7d'});check('handler-unauthenticated-denied',{v2},401,(await transport.request(q,v2,{authorized:false})).code);check('handler-method-denied',{v2},405,(await transport.request(q,v2,{method:'POST'})).code);}
 for(const v2 of [false,true])for(const type of ['promo_formats','promo_concepts']){const r=await transport.request(new URLSearchParams({type,currency:'CZK',account:'TUC'}),v2);check('shared-promo-publication-reader',{v2,type},true,r.code===200&&!!r.body.shared_generation_id&&r.body.rows.length>0);}
}
module.exports={run};
