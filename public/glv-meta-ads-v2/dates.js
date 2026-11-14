(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MadV2Dates=api;})(globalThis,function(){
 'use strict';
 const ACCOUNTS=Object.freeze([
  Object.freeze({id:'359758259164738',label:'TUC',currency:'CZK',timezone:'Europe/Prague'}),
  Object.freeze({id:'1021777267558882',label:'TGLV',currency:'USD',timezone:'America/Los_Angeles'})
 ]);
 const shift=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 const localDate=(now,timezone)=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 // Reporting cutoff = TUC's completed Prague day. CZSK is the core business
 // and must not wait for Los Angeles midnight. TGLV's last day is partial until
 // LA midnight; it is completed by the separate TGLV-only refresh.
 const accountCompleteThrough=(now,label)=>{const a=ACCOUNTS.find(x=>x.label===label);return shift(localDate(now,a.timezone),-1);};
 const commonCutoff=(now=new Date())=>accountCompleteThrough(now,'TUC');
 const tglvComplete=(now=new Date())=>accountCompleteThrough(now,'TGLV')>=commonCutoff(now);
 const refreshPhase=(now=new Date())=>tglvComplete(now)?'final':'tglv-partial';
 const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
 function rangeFor(preset,now=new Date()){
  const until=commonCutoff(now),today=shift(until,1),month=today.slice(0,7)+'-01';
  if(preset==='this_month')return {since:until<month?until.slice(0,7)+'-01':month,until};
  if(preset==='last_month'){const end=shift(month,-1);return {since:end.slice(0,7)+'-01',until:end};}
  const n={last_7d:7,last_14d:14,last_30d:30,last_90d:90}[preset];
  if(!n)throw new Error('Invalid preset');
  return {since:shift(until,1-n),until};
 }
 return {ACCOUNTS,shift,localDate,commonCutoff,accountCompleteThrough,tglvComplete,refreshPhase,rangeFor,validDate};
});
