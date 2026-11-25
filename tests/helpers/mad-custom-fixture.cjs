'use strict';
const {environment,request}=require('./mad-independent-fixture.cjs');
const v2=require('../../lib/glv-mad-v2.cjs');
const range={since:'2026-11-19',until:'2026-11-24'},wide={since:'2026-11-18',until:'2026-11-24'};
const now=new Date('2026-11-25T05:00:00Z');
async function customEnvironment(fn){
 const RealDate=Date;
 global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now.toISOString()]));}static now(){return +now;}};
 try{return await environment(async h=>{
 const base=h.fetcher;h.graph=[];h.rejectDaily=false;
 h.fetcher=async(url,options)=>{
  const u=new URL(url);if(u.hostname!=='graph.facebook.com'||!u.pathname.endsWith('/insights'))return base(url,options);
  const r=JSON.parse(u.searchParams.get('time_range')),daily=u.searchParams.has('time_increment'),level=u.searchParams.get('level');h.graph.push({range:r,daily,level,path:u.pathname});
  if(h.rejectDaily&&daily)return {ok:false,status:403,json:async()=>({error:{code:190}})};
  const account=v2.ACCOUNTS.find(a=>u.pathname.includes(a.id)),rows=[];
  if(level==='campaign'){
   const dates=[];if(daily){for(let d=r.since;d<=r.until;d=v2.shift(d,1))dates.push(d);}else dates.push(r.since);
   for(const d of dates)rows.push({campaign_id:account.label==='TUC'?'123':'456',campaign_name:account.label==='TUC'?'TUC_001_CZSK_Leadgen':'TGLV_001_US_Leadgen',spend:daily?'10':String((1+(Date.parse(r.until)-Date.parse(r.since))/86400000)*10),impressions:daily?'100':'600',reach:daily?'80':'123',actions:[{action_type:'lead',value:daily?'2':'12'}],date_start:d,date_stop:daily?d:r.until});
  }
  return {ok:true,status:200,json:async()=>({data:rows})};
 };
 global.fetch=h.fetcher;
 await fn(h);
 });}finally{global.Date=RealDate;}}
module.exports={customEnvironment,request,range,wide,now};
