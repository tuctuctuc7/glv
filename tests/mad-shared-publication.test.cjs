'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const shared=require('../lib/glv-mad-shared.cjs');
const v2=require('../lib/glv-mad-v2.cjs');
const range={since:'2026-11-01',until:'2026-11-02'},stamp='2026-11-03T12:33:00Z';
function fixture(){
 const row={id:'1',name:'TUC_001_CZSK_BAU',date_start:range.since,date_stop:range.since,amount_spent:'10.01',impressions:'50',reach:'40','actions:omni_purchase':'1','action_values:omni_purchase':'20'};
 const daily={creator_version:2,range,generated_at:stamp,rows:[row,{...row,date_start:range.until,date_stop:range.until}]};
 const aggregate={...daily,rows:[{...row,date_stop:range.until,amount_spent:'20.01',impressions:'100',reach:'65','actions:omni_purchase':'2','action_values:omni_purchase':'40'}]};
 const ad={...row,id:'2',campaign_id:'1',campaign_name:row.name,adset_id:'3',adset_name:'Banner',partnership:{status:'unverified',reason:'metadata_unavailable',evidence:[]}};
 const ads={...daily,wl_version:3,rows:[{...ad,amount_spent:'20.02',impressions:'100','actions:omni_purchase':'2','action_values:omni_purchase':'40'}]};
 const fx={'2026-11-01':{date:'2026-11-01',czk_per_usd:20},'2026-11-02':{date:'2026-11-02',czk_per_usd:25}};
 const native=Object.fromEntries(['daily','aggregate','ads'].map(type=>[type,{schema_version:1,creator_ad_version:1,complete:true,type,range,generated_at:stamp,generation_id:'old',fx,accounts:v2.ACCOUNTS.map(a=>({...a,rows:a.label==='TUC'?(type==='ads'?[ad,{...ad,date_start:range.until,date_stop:range.until}]:daily.rows):[],reach:type==='aggregate'&&a.label==='TUC'?[[a.id+':1',65]]:[]}))}]));
 return {legacy:{daily,aggregate,ads},native};
}
test('one original-account generation has exact direct-period parity and truthful daily FX',()=>{
 const f=fixture(),bundle=shared.compose(f);
 for(const type of ['daily','aggregate','ads']){
  const old=shared.render(bundle,type,'v1');const next=shared.render(bundle,type,'v2','CZK','TUC');
  assert.deepEqual(shared.facts(old),shared.facts(next));
  assert.equal(old.generation_id,next.generation_id);
 }
 assert.equal(shared.render(bundle,'aggregate','v1').rows[0].amount_spent,'20.01');
 assert.equal(shared.render(bundle,'aggregate','v2','CZK','TUC').rows[0].reach,'65');
 assert.equal(shared.render(bundle,'aggregate','v2','USD','TUC').rows[0].amount_spent,10.01/20+10.01/25);
 assert.equal(shared.render(bundle,'ads','v2','CZK','TUC').generated_at,stamp);
 assert.equal(bundle.provenance.aggregate_basis,'direct_period');
});
test('migration rejects older native ad extraction rather than downgrading V1',()=>{
 const f=fixture(); f.native.ads.generated_at='2026-11-03T08:00:00Z';
 assert.throws(()=>shared.compose(f),/Native ad correction required/);
});
test('partial shared piece write retains the previous verified generation',async()=>{
 const values=new Map();let fail=false;
 const redis=async(cmd,k,val)=>{if(cmd==='GET')return {result:values.get(k)||null};if(cmd==='TTL')return {result:values.has(k)?-1:-2};if(cmd==='EVAL')return {result:1};if(cmd==='SET'){if(fail&&k.includes(':piece:aggregate:'))throw Error('interrupted');values.set(k,val);return {result:'OK'};}throw Error(cmd);};
 const first=shared.compose(fixture());await shared.save(redis,'last_7d',first);
 const f=fixture();f.legacy.ads.rows[0].impressions='150';const next=shared.compose(f);fail=true;
 await assert.rejects(shared.save(redis,'last_7d',next),/interrupted/);
 const restored=await shared.read(async k=>{const b=values.get(k);return b?require('../lib/glv-mad-v2-storage.cjs').decode(b):null;},'last_7d');
 assert.equal(restored.generation_id,first.generation_id);
});
module.exports={fixture};
