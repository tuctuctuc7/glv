/* Independent report state: never consumes legacy normalized/positive-spend creatives. */
(function(){
 'use strict';
 const model=window.GlvWlReport,host=document.getElementById('panel-wl');
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const el=id=>document.getElementById('wl-'+id);
 let rows=[],sequence=0,controller,loadedKey='',loadedDay='',stamp='',range=null;
 const fresh=timestamp=>{const age=Date.now()-Date.parse(timestamp);return typeof timestamp==='string'&&Number.isFinite(age)&&age>=0&&age<=25*60*60*1000;};
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 host.innerHTML=`<div class="wl-toolbar" aria-label="WL report filters">
 <label>Campaign<select id="wl-campaign"><option value="__all">All campaigns</option></select></label>
 <label>Market<select id="wl-market"><option value="__all">All markets</option><option value="__none">None</option><option>CZSK</option><option>US</option><option value="__unresolved">Unresolved market</option></select></label>
 <div><label>Date<select id="wl-date"><option value="last_month">LAST FULL MONTH</option><option value="custom">Custom range</option></select></label><div id="wl-custom" hidden><label>From<input type="date" id="wl-from"></label><label>To<input type="date" id="wl-to"></label><button id="wl-apply" type="button">Apply</button></div></div>
 <label>Creator<select id="wl-creator"><option value="__all">All creators</option><option value="__none">None</option>${model.creators.map(c=>`<option>${c}</option>`).join('')}<option value="__unresolved">Unresolved attribution</option></select></label>
 </div><div class="wl-status-row"><p id="wl-status" role="status"></p><button type="button" id="wl-reload">Reload WL</button></div>
 <details class="wl-method"><summary>Report methodology · CZK</summary><p>WL campaign token, both CZSK and US. Creator names are matched in the campaign name first; only when absent is the ad-set name used. Multiple matches at the chosen level remain unresolved. Unknown or ambiguous attribution is disclosed and retained in totals, never inferred from a PAC. ActionKate PAC 462 spend is excluded only from reported spend. All revenue and purchases remain; creative rows and standard ROAS use actual spend. Ratios use summed inputs. Missing inputs or nonpositive denominators show —. Dates are inclusive, Europe/Prague; Meta account reporting timezone must remain Europe/Prague. Daily shared refresh at 00:00 UTC; custom ranges are fetched live. Attribution can change after the original report.</p></details>
 <div id="wl-warning" role="status" hidden></div><div id="wl-results"></div>`;
 const initial=model.lastMonth();el('from').value=initial.since;el('to').value=initial.until;
 const headers={overview:['Creator','Actual spend CZK','Excluded CZK','Reported spend CZK','Meta-attributed revenue CZK','Purchases','Standard ROAS','Adjusted ROAS'],market:['Creator','Market','Actual CZK','Reported CZK','Meta-attributed revenue CZK','Purchases','Standard ROAS'],creative:['PAC / asset label','Market','Spend CZK','Meta-attributed revenue CZK','Purchases','ROAS']};
 const fmt=(n,ratio=false)=>n===null?'—':n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+(ratio?'×':'');
 const creator=r=>r.creator||`Unresolved: ${r.campaign}`;
 function table(id,title,kind,data){
  const cells=r=>kind==='overview'?[creator(r),fmt(r.actual),fmt(r.excluded),fmt(r.reported),fmt(r.revenue),r.purchases??'—',fmt(r.standard,true),r.excluded===0&&r.adjusted!==null?'same as standard':fmt(r.adjusted,true)]:kind==='market'?[creator(r),r.market||'Unresolved',fmt(r.actual),fmt(r.reported),fmt(r.revenue),r.purchases??'—',fmt(r.standard,true)]:[r.label,r.market||'Unresolved',fmt(r.actual),fmt(r.revenue),r.purchases??'—',fmt(r.standard,true)];
  return `<section class="wl-section" id="${id}"><h3>${escape(title)}</h3><div class="wl-scroll" tabindex="0" role="region" aria-label="${escape(title)} table"><table><caption class="sr-only">${escape(title)}</caption><thead><tr>${headers[kind].map((h,i)=>`<th scope="col"${kind==='overview'&&i===3?' class="wl-reported"':''}>${escape(h)}</th>`).join('')}</tr></thead><tbody>${data.map(r=>`<tr${r.creator==='Total'?' class="wl-total"':''}>${cells(r).map((c,i)=>i===0?`<th scope="row">${escape(c)}</th>`:`<td${kind==='overview'&&i===3?' class="wl-reported"':''}>${escape(c)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${headers[kind].length}">No WL ads in this selection.</td></tr>`}</tbody></table></div></section>`;
 }
 function render(){
  const filters=Object.fromEntries(['campaign','market','creator'].map(k=>{const v=el(k).value;return [k,v==='__all'?null:v==='__none'?[]:[v==='__unresolved'?null:v]];}));
  const report=model.report(rows,filters);
  el('warning').hidden=!report.issues.length;
  el('warning').innerHTML=report.issues.length?`<strong>Unresolved creator or market attribution. These ads remain in totals; no creator is invented.</strong><ul>${report.issues.map(n=>`<li>${escape(n)}</li>`).join('')}</ul>`:'';
  const unresolved=report.unresolvedOverview;
  el('results').innerHTML=(report.rows.length?'':'<p>No WL ads in this selection.</p>')+table('wl-overview','Creator overview','overview',[...report.overview,...unresolved,{creator:'Total',...report.total}])+table('wl-market-table','Performance by market','market',report.markets)+`<h2>Creative performance · Actual spend / standard ROAS</h2>`+['Kristyna','ActionKate','befit_over40'].map(c=>table('wl-creative-'+c,c,'creative',report.creatives[c])).join('')+(report.creatives.null.length?table('wl-unresolved','Unresolved creator · source assets','creative',report.creatives.null):'');
 }
 function scope(){return el('date').value==='last_month'?model.lastMonth():{since:el('from').value,until:el('to').value};}
 async function load(force=false){
  const requested=scope(),key=JSON.stringify(requested);
  if(!force&&key===loadedKey&&loadedDay===today()&&fresh(stamp))return;
  const generation=++sequence;controller?.abort();controller=new AbortController();
  loadedKey='';rows=[];el('results').innerHTML='';el('warning').hidden=true;
  const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
  if(!valid(requested.since)||!valid(requested.until)||requested.since>requested.until){el('status').textContent='Choose a valid inclusive date range.';return;}
  el('status').textContent=`Loading WL · ${requested.since} – ${requested.until}…`;
  const query=new URLSearchParams({type:'ads',wl:'1'});
  if(el('date').value==='last_month')query.set('date_preset','last_month');else query.set('time_range',key);
  const timer=setTimeout(()=>controller?.abort(),60000);
  try{
   const response=await fetch('/api/glv-meta-ads/fb-data?'+query,{cache:'no-store',signal:controller.signal});
   if(!response.ok)throw new Error('unavailable');const data=await response.json();
   if(generation!==sequence)return;
   if(data.wl_version!==2||!Array.isArray(data.rows)||data.range?.since!==requested.since||data.range?.until!==requested.until||!fresh(data.generated_at)||data.rows.some(r=>typeof r.campaign_name!=='string'||!r.campaign_name))throw new Error('incomplete');
   rows=model.normalize(data.rows);range=requested;stamp=data.generated_at;loadedKey=key;loadedDay=today();
   const previous=el('campaign').value;const options=new Map(rows.map(r=>[r.campaignId,r.campaign]));
   el('campaign').innerHTML='<option value="__all">All campaigns</option><option value="__none">None</option>'+[...options].map(([id,name])=>`<option value="${escape(id)}">${escape(name)}</option>`).join('');
   // A disappeared selection remains None, never silently expands to All.
   el('campaign').value=previous==='__all'||previous==='__none'||options.has(previous)?previous:'__none';
   el('status').textContent=`${range.since} – ${range.until} · Europe/Prague · CZK · Source refreshed ${new Date(stamp).toLocaleString('en-GB',{timeZone:'Europe/Prague'})} Prague`;
   render();
  }catch(error){if(generation!==sequence)return;el('status').innerHTML='WL data unavailable. No results are shown for this range. <button type="button" id="wl-retry">Retry</button>';el('retry').addEventListener('click',()=>load(true));}
  finally{clearTimeout(timer);}
 }
 ['campaign','market','creator'].forEach(k=>el(k).addEventListener('change',()=>{if(loadedKey)render();}));
 el('date').addEventListener('change',()=>{el('custom').hidden=el('date').value!=='custom';if(el('date').value==='last_month')void load();});
 el('apply').addEventListener('click',()=>load());el('reload').addEventListener('click',()=>load(true));
 document.getElementById('tab-wl').addEventListener('click',()=>load());
 const resume=()=>{if(document.visibilityState!=='hidden'&&document.getElementById('tab-wl').classList.contains('active'))void load();};
 window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);setInterval(resume,60000);
 window.GlvWlUI={load};
})();
