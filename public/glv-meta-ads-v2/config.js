'use strict';
const v2Query=new URLSearchParams(location.search);
const reportCurrency=v2Query.get('currency')==='CZK'?'CZK':'USD';
const reportAccount=['TUC','TGLV'].includes(v2Query.get('account'))?v2Query.get('account'):'All';
const moneyLabel=text=>text.replace(/\bCZK\b/g,reportCurrency);
function initV2Controls(){
 document.getElementById('v2-date-note').textContent=`Prague / Los Angeles local dates, combined without rebucketing. Common completed cutoff: ${MadV2Dates.commonCutoff()}. Daily CNB FX; prior fixing on holidays. Account identity overrides naming.`;
 document.getElementById('v2-report-label').textContent=`GELAVIS · ${reportCurrency} reporting`;
 document.getElementById('v2-scope-currency').textContent=reportCurrency;
 document.querySelectorAll('[data-report-currency]').forEach(el=>el.textContent=reportCurrency);
 for(const [id,key,value] of [['v2-currency','currency',reportCurrency],['v2-account','account',reportAccount]]){
  const select=document.getElementById(id);select.value=value;
  select.addEventListener('change',()=>{
   // A full V2 reload avoids mixing amounts/axes from two currencies in-flight.
   const url=new URL(location.href);url.searchParams.set(key,select.value);
   try{sessionStorage.setItem('glv-mad-v2-date',JSON.stringify({datePreset,customRange,tab:document.querySelector('.tab-btn.active')?.dataset.tab}));}catch{}
   location.assign(url);
  });
 }
 try{const saved=JSON.parse(sessionStorage.getItem('glv-mad-v2-date'));if(saved){datePreset=saved.datePreset;customRange=saved.customRange;sessionStorage.removeItem('glv-mad-v2-date');if(saved.tab)document.addEventListener('DOMContentLoaded',()=>document.querySelector(`[data-tab="${saved.tab}"]`)?.click(),{once:true});}}catch{}
}
