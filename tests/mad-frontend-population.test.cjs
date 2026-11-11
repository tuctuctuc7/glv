'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const qa=require('../qa/mad-full-parity.cjs');
const {renderSnapshot}=require('../lib/glv-mad-v2-source.cjs');
const range={since:'2026-11-04',until:'2026-11-10'};
function runtime(version){
 const html=fs.readFileSync(path.join(__dirname,`../public/${version}/index.html`),'utf8');
 const slice=(a,b)=>{assert.ok(html.includes(a)&&html.includes(b));return html.slice(html.indexOf(a),html.indexOf(b));};
 const ctx=vm.createContext({GlvWlReport:require(`../public/${version}/wl-report.js`),MadPresentation:require('../public/glv-meta-ads/presentation.js'),reportAccount:'All'});
 vm.runInContext(`let campaignMeta={};const CAMPAIGN_COLORS=['#123456'];${slice('const parseAmt','function getCampaignColor')}${slice('function getCampaignColor','function fmt(')}${slice('function extractDate','function fmtDate')}${slice('function processRow','function getSegmentRows')}${html.match(/const campaignGroupKey=.*;/)[0]}`,ctx);
 return ctx;
}
for(const version of ['glv-meta-ads','glv-meta-ads-v2'])for(const type of ['aggregate','daily'])test(`${version} ${type}: production normalizer retains owned unknown-prefix identity and metrics`,()=>{
 const ctx=runtime(version),snapshot=qa.fixture(range,type,'current-wrong-prefix');
 snapshot.accounts[0].rows.forEach(r=>{if(r.id==='2')r.name='UNRECOGNIZED_002_US_BAU';});
 const native=qa.legacyPayload(snapshot,type,range),converted=renderSnapshot(snapshot,'CZK','TUC');
 ctx.rows=version==='glv-meta-ads'?native.rows:converted.rows;
 const fn=type==='aggregate'?'processAggregateRows':'processDaily';
 const result=vm.runInContext(`${fn}(rows)`,ctx),expected=ctx.rows.filter(r=>r.name==='UNRECOGNIZED_002_US_BAU'),actual=result.filter(r=>r.name==='UNRECOGNIZED_002_US_BAU');
 assert.equal(actual.length,expected.length);assert.ok(actual.length);
 for(let i=0;i<actual.length;i++){assert.equal(actual[i].id,expected[i].id);assert.equal(actual[i].spend,expected[i].amount_spent);assert.equal(actual[i].purchases,expected[i]['actions:omni_purchase']);assert.equal(actual[i].segment,'us');}
 ctx.rows=expected.map(({account_id,...r})=>r);
 if(version==='glv-meta-ads')assert.equal(vm.runInContext(`${fn}(rows).length`,ctx),0,'unowned unknown-prefix rows still excluded');
 else assert.throws(()=>vm.runInContext(`${fn}(rows)`,ctx),/Missing V2 account provenance/);
});
for(const type of ['daily','aggregate','ads'])test(`${type}: currency preserves exact account/entity population and all non-money facts`,async()=>{
 const t=require('../qa/mad-shared-transport.cjs').create();
 const identity=r=>({id:r.id,account_id:r.account_id,name:r.name,campaign_id:r.campaign_id,adset_id:r.adset_id,ad_id:r.ad_id,status:r.status,partnership:r.partnership,impressions:r.impressions,reach:r.reach,purchases:r['actions:omni_purchase'],leads:r['actions:lead'],clicks:r['actions:link_click'],date_start:r.date_start,date_stop:r.date_stop,creator_rows:r.creator_rows?.map(identity)});
 const scopes={};
 for(const account of ['TUC','TGLV','All'])for(const currency of ['CZK','USD']){
  const payload=await t.payload(new URLSearchParams({type,time_range:JSON.stringify(range),account,currency}),true);
  scopes[account+currency]=payload.rows.map(identity);
 }
 for(const account of ['TUC','TGLV','All'])assert.deepEqual(scopes[account+'CZK'],scopes[account+'USD'],`${account}: currency must not change cohort, attribution or non-money facts`);
 for(const currency of ['CZK','USD'])assert.deepEqual(scopes['All'+currency],[...scopes['TUC'+currency],...scopes['TGLV'+currency]],'All is the exact account-qualified union, including colliding raw IDs');
});
