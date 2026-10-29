const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
for(const [file,loader,payloadName,render] of [['promo-format-ui.js','loadPromoFormats','promoFormatPayload','refreshPromoFormats'],['promo-concepts-ui.js','loadPromoConcepts','conceptPayload','renderPromoConcepts']])test(`${file} retains valid last-good facts after a refresh failure`,async()=>{
 const status={textContent:''};const context=vm.createContext({sessionStorage:{getItem:()=>null},document:{getElementById:()=>status},PromoFormat:{validPayload:()=>true,validConceptPayload:()=>true},PromoConcepts:{selection:()=>[]},apiFetch:async()=>({rows:[{spend:100}],range:{since:'2026-03-01',until:'2026-10-20'},generated_at:'2026-10-21T00:00:00Z'})});
 vm.runInContext(fs.readFileSync(require.resolve('../public/glv-meta-ads/'+file),'utf8'),context);vm.runInContext(`${render}=()=>{}`,context);
 await vm.runInContext(`${loader}()`,context);context.apiFetch=async()=>{throw Error('refresh unavailable')};await vm.runInContext(`${loader}()`,context);
 assert.equal(vm.runInContext(`${payloadName}?.rows[0].spend`,context),100);
});
