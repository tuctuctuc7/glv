'use strict';
const v2Query=new URLSearchParams(location.search);
const reportCurrency=v2Query.get('currency')==='CZK'?'CZK':'USD';
const reportAccount=['TUC','TGLV'].includes(v2Query.get('account'))?v2Query.get('account'):'All';
const moneyLabel=text=>text.replace(/\bCZK\b/g,reportCurrency);
const v2StateKey=account=>'glv-mad-v2-controls-v1-'+account;
// Only user controls, never source payloads, cookies, credentials or request state.
function snapshotV2Controls(){
 return {version:1,account:reportAccount,datePreset,customRange,filterState,creativeTypeFilter,chartGranularity,triageState,triageMarket,wlInfluencerBreakdown,promoTableMode,promoExpandedGroups,promoCollapsedPeriods,leadgenTableMode,promoActiveDaysOnly,includeLeadGen,leadgenOnly,sortState,tabGrain,conceptSelection,conceptSort,
  tab:document.querySelector('.tab-btn.active')?.dataset.tab,
  controls:Object.fromEntries([...document.querySelectorAll('.panel select[id],.panel input[type="date"][id],.panel input[type="checkbox"][id],#include-leadgen,#promo-active-days-only,#leadgen-only')].filter(e=>!e.closest('.filter-options-list')).map(e=>[e.id,e.type==='checkbox'?e.checked:e.value]))};
}
const v2Encode=value=>JSON.stringify(value,(_k,v)=>v instanceof Set?{set:[...v]}:v);
function readV2Controls(){
 try{const s=JSON.parse(sessionStorage.getItem(v2StateKey(reportAccount)),(k,v)=>v&&Object.keys(v).length===1&&Array.isArray(v.set)?new Set(v.set.filter(x=>typeof x==='string')):v);return validV2Controls(s)?s:null;}catch{return null;}
}
function validV2Controls(s){
 const object=v=>v&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof Set);
 if(s?.version!==1||s.account!==reportAccount)return false;
 if(!['filterState','creativeTypeFilter','chartGranularity','triageState','sortState','tabGrain','conceptSort','controls'].every(k=>object(s[k])))return false;
 if(!['wlInfluencerBreakdown','promoActiveDaysOnly','includeLeadGen','leadgenOnly'].every(k=>typeof s[k]==='boolean'))return false;
 if(!(s.promoExpandedGroups instanceof Set)||!(s.promoCollapsedPeriods instanceof Set))return false;
 if(!['groups','days'].includes(s.promoTableMode)||!['groups','days'].includes(s.leadgenTableMode)||!['czsk','us','all'].includes(s.triageMarket))return false;
 if(!Object.values(s.filterState).every(v=>v===null||v instanceof Set))return false;
 if(s.conceptSelection!==null&&(!Array.isArray(s.conceptSelection)||!s.conceptSelection.every(v=>typeof v==='string')))return false;
 if(![null,'last_7d','last_14d','last_30d','last_90d','this_month','last_month'].includes(s.datePreset))return false;
 if(s.customRange!==null&&(!object(s.customRange)||!['since','until'].every(k=>/^\d{4}-\d{2}-\d{2}$/.test(s.customRange[k]))))return false;
 const shape=(value,template)=>object(template)?object(value)&&Object.keys(template).every(k=>Object.hasOwn(value,k)&&shape(value[k],template[k])):typeof value===typeof template;
 return shape(s.sortState,sortState)&&shape(s.triageState,triageState)&&shape(s.creativeTypeFilter,creativeTypeFilter)&&shape(s.chartGranularity,chartGranularity);
}
let v2Restored=null;
function restoreV2Controls(){
 const s=v2Restored;if(!s)return;
 // Restore only known state slots; arbitrary stored object keys are never assigned to globals.
 datePreset=s.datePreset;customRange=s.customRange;
 filterState=s.filterState;creativeTypeFilter=s.creativeTypeFilter;chartGranularity=s.chartGranularity;triageState=s.triageState;triageMarket=s.triageMarket;
 wlInfluencerBreakdown=s.wlInfluencerBreakdown;promoTableMode=s.promoTableMode;promoExpandedGroups=s.promoExpandedGroups;promoCollapsedPeriods=s.promoCollapsedPeriods;
 leadgenTableMode=s.leadgenTableMode;promoActiveDaysOnly=s.promoActiveDaysOnly;includeLeadGen=s.includeLeadGen;leadgenOnly=s.leadgenOnly;sortState=s.sortState;
 for(const tab of TAB_KEYS)if(['day','week','month'].includes(s.tabGrain?.[tab]))tabGrain[tab]=s.tabGrain[tab];
 conceptSelection=s.conceptSelection;conceptSort=s.conceptSort;
}
function restoreV2ControlElements(wlOnly=false){
 for(const [id,value] of Object.entries(v2Restored?.controls||{})){
  if(id.startsWith('wl-')!==wlOnly)continue;
  const el=document.getElementById(id);if(!el||!el.closest('.panel')&&!['include-leadgen','promo-active-days-only','leadgen-only'].includes(id))continue;
  if(el.type==='checkbox')el.checked=value===true;
  else if(el.tagName==='SELECT'){
   if(id==='wl-campaign'&&![...el.options].some(o=>o.value===value)){const option=document.createElement('option');option.value=value;option.textContent='Selected campaign';el.append(option);}
   if([...el.options].some(o=>o.value===value))el.value=value;
  }else if(el.type==='date')el.value=value;
 }
 if(!wlOnly){
  for(const [prefix,mode] of [['promo',promoTableMode],['leadgen',leadgenTableMode]])for(const choice of ['groups','days'])document.getElementById(prefix+'-mode-'+choice)?.classList.toggle('active',mode===choice);
 }
 if(wlOnly){const custom=document.getElementById('wl-custom');if(custom)custom.hidden=document.getElementById('wl-date').value!=='custom';}
}
function initV2Controls(){
 document.getElementById('v2-date-note').textContent=`Prague / Los Angeles local dates, combined without rebucketing. Common completed cutoff: ${MadV2Dates.commonCutoff()}. Daily CNB FX; prior fixing on holidays. Account identity overrides naming.`;
 document.getElementById('v2-report-label').textContent=`GELAVIS · ${reportCurrency} reporting`;
 document.getElementById('v2-scope-currency').textContent=reportCurrency;
 document.querySelectorAll('[data-report-currency]').forEach(el=>el.textContent=reportCurrency);
 for(const [id,key,value] of [['v2-currency','currency',reportCurrency],['v2-account','account',reportAccount]]){
  const select=document.getElementById(id);select.value=value;
  select.addEventListener('change',()=>{
   // Full reload prevents mixing monetary units or in-flight account responses.
   const url=new URL(location.href);url.searchParams.set(key,select.value);
   try{
    const state=snapshotV2Controls();sessionStorage.setItem(v2StateKey(reportAccount),v2Encode(state));
    if(key==='account'){
     state.account=select.value;
     const prefix={TUC:'359758259164738:',TGLV:'1021777267558882:'}[state.account];
     const valid=id=>!prefix||id.startsWith(prefix);
     for(const [k,v] of Object.entries(state.filterState))if(v instanceof Set&&!k.endsWith('-group'))state.filterState[k]=new Set([...v].filter(valid));
     if(Array.isArray(state.conceptSelection))state.conceptSelection=state.conceptSelection.filter(valid);
     const campaign=state.controls['wl-campaign'];if(campaign&&!campaign.startsWith('__')&&!valid(campaign))state.controls['wl-campaign']='__none';
     sessionStorage.setItem(v2StateKey(state.account),v2Encode(state));
    }
   }catch{}
   location.assign(url);
  });
 }
 v2Restored=readV2Controls();restoreV2Controls();
 if(v2Restored?.tab)document.addEventListener('DOMContentLoaded',()=>{const tab=[...document.querySelectorAll('.tab-btn')].find(e=>e.dataset.tab===v2Restored.tab);tab?.click();},{once:true});
}
