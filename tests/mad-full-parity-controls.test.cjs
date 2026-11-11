'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function renderer(version){
 const source=fs.readFileSync(require.resolve('../public/'+version+'/wl-report-ui.js'),'utf8');
 const model=require('../public/'+version+'/wl-report.js');const nodes={};const el=id=>nodes[id]??=(['campaign','creator','market'].includes(id)?{value:'__all'}:{});
 const context={model,el,rows:[],verification:{verified:2,noPositive:0,unavailable:0,naming:[]},escape:String,moneyLabel:s=>s,reportAccount:'All',reportCurrency:'CZK'};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf(' const headers='),source.indexOf(' function scope()')),context);
 return {context,nodes,render:()=>vm.runInContext('render()',context)};
}
test('versioned account-scoped control reader rejects malformed or partial state',()=>{
 const source=fs.readFileSync(require.resolve('../public/glv-meta-ads-v2/config.js'),'utf8');
 for(const saved of ['bad json',JSON.stringify({version:1,account:'TUC'}),JSON.stringify({version:2,account:'TUC'}),JSON.stringify({version:1,account:'All'})]){
  const c={location:{search:'?account=TUC'},URLSearchParams,sessionStorage:{getItem:key=>{assert.equal(key,'glv-mad-v2-controls-v1-TUC');return saved;}}};vm.createContext(c);vm.runInContext(source,c);assert.equal(vm.runInContext('readV2Controls()',c),null);
 }
});
const positive={status:'verified_positive',reason:'sponsor_metadata',evidence:['facebook_branded_content.sponsor_page_id']};
function row(account){return {account_id:account,id:account+':1',campaign_id:account+':1',campaign_name:'TUC_001_US_WL_ActionKate',name:'Kristyna_PAC419_V1',partnership:positive,amount_spent:100,'action_values:omni_purchase':200,'actions:omni_purchase':1};}
for(const version of ['glv-meta-ads','glv-meta-ads-v2'])test(version+' distinguishes retained creator conflicts from missing attribution',()=>{
 const h=renderer(version);h.context.rows=h.context.model.normalize([row('359758259164738')]);h.render();
 assert.doesNotMatch(h.nodes.warning.innerHTML,/Unresolved creator or market attribution/);
 assert.match(h.nodes.warning.innerHTML,/Parent naming conflicts/);
 h.context.rows=h.context.model.normalize([{...row('359758259164738'),campaign_name:'Unknown',name:'PAC419_V1'}]);h.render();assert.match(h.nodes.warning.innerHTML,/Unresolved creator or market attribution/);
});
test('All-account creatives expose distinct human-readable account identity without merging totals',()=>{
 const h=renderer('glv-meta-ads-v2');h.context.rows=h.context.model.normalize([row('359758259164738'),row('1021777267558882')]);h.render();
 assert.match(h.nodes.results.innerHTML,/PAC 419 V1 · TUC/);assert.match(h.nodes.results.innerHTML,/PAC 419 V1 · TGLV/);
 const report=h.context.model.report(h.context.rows);assert.equal(report.total.actual,200);assert.equal(report.creatives.Kristyna.length,2);
 h.context.reportAccount='TUC';h.context.rows=h.context.rows.slice(0,1);h.render();assert.doesNotMatch(h.nodes.results.innerHTML,/PAC 419 V1 · TUC/);
});
