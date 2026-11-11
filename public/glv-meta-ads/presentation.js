/* Shared MAD presentation. Indicative FX is never a reporting conversion. */
(function(root){
 'use strict';
 const api={
  syncSortIndicators(state,doc){for(const [group,segments] of Object.entries(state))for(const [segment,sort] of Object.entries(segments)){const el=doc.getElementById(`${group}-sort-dir-${segment}`);if(el)el.textContent=sort.dir==='asc'?'↑':'↓';}},
  ownedTuc:row=>row.account_id==='359758259164738',
  accountMarket:row=>row.account_id==='1021777267558882'||String(row.campaign_name||row.name||'').includes('_US_')?'us':'czsk',
  namingWarnings(payloads){
   const warnings=payloads.flatMap(p=>p.warnings||[]);
   for(const p of payloads)for(const row of p.rows||[]){
    const label=row.account_id==='359758259164738'?'TUC':row.account_id==='1021777267558882'?'TGLV':null;if(!label)continue;
    const name=String(row.campaign_name||row.name||'');
    const prefix=label==='TUC'?/^(TUC|GLV)_\d+_/:/^TGLV_\d+_/;
    const legacy=label==='TUC'&&name.startsWith('WL_')&&/^wl_befit_over40(?:_|$)/i.test(name);
    if(!prefix.test(name)&&!legacy)warnings.push(`${label}: campaign prefix mismatch; retained under account ${row.account_id}`);
   }
   return [...new Set(warnings)];
  },
  campaignCode(name,mixed=false,account=null){const parts=String(name||'').split('_').filter(Boolean),code=parts[1]||'—';return mixed?(['TUC','TGLV'].includes(account)?account+'_'+code:/^(TUC|TGLV|GLV)$/.test(parts[0])?parts.slice(0,2).join('_'):String(name||'—')):code;},
  usdEquivalent(amount,rate,currency='CZK'){
   if(currency!=='CZK')return '';
   if(!Number.isFinite(rate)||rate<=0)return 'USD estimate unavailable';
   return !amount||amount<=0?'—':'≈ $'+(amount*rate).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  },
  fetchUsdRate(cache){return cache.get('fx:CZK:USD',async()=>{
   const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),1500);
   try{const response=await fetch('https://api.frankfurter.dev/v1/latest?from=CZK&to=USD',{signal:ctrl.signal,cache:'no-store'});const data=await response.json();if(!response.ok||!Number.isFinite(data.rates?.USD)||data.rates.USD<=0)throw Error('Exchange rate unavailable');return data.rates.USD;}finally{clearTimeout(timer);}
  });},
  usdNote:'Indicative USD equivalent at the latest Frankfurter CZK/USD rate, not historical daily reporting FX. Primary reporting amounts are unchanged.'
 };
 if(typeof module==='object'&&module.exports)module.exports=api;else root.MadPresentation=api;
})(typeof window==='object'?window:globalThis);
