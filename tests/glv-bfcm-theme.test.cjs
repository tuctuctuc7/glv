const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/glv-bfcm/theme.js'),'utf8');
function boot(saved,blocked=false){
 const events={},attrs={},dataset={},stored={};
 const button={setAttribute:(key,value)=>attrs[key]=value,addEventListener:(name,fn)=>events[name]=fn};
 const context={document:{documentElement:{dataset},getElementById:()=>button,addEventListener:(name,fn)=>events[name]=fn},localStorage:{getItem:()=>{if(blocked)throw Error('Blocked');return saved;},setItem:(key,value)=>{if(blocked)throw Error('Blocked');stored[key]=value;}}};
 vm.runInNewContext(source,context);events.DOMContentLoaded();return {dataset,attrs,stored,click:()=>events.click()};
}
test('light default, accessible icon action and persisted toggle',()=>{
 const ui=boot(null);assert.equal(ui.dataset.theme,'light');assert.equal(ui.attrs['aria-label'],'Switch to dark mode');
 ui.click();assert.equal(ui.dataset.theme,'dark');assert.equal(ui.stored['glv-bfcm-theme'],'dark');assert.equal(ui.attrs['aria-label'],'Switch to light mode');
 ui.click();assert.equal(ui.dataset.theme,'light');assert.equal(ui.stored['glv-bfcm-theme'],'light');
});
test('saved preference is respected; invalid preference falls back to light',()=>{
 assert.equal(boot('dark').dataset.theme,'dark');assert.equal(boot('light').dataset.theme,'light');assert.equal(boot('invalid').dataset.theme,'light');
});
test('storage denial does not break initial paint or theme switching',()=>{
 const ui=boot(null,true);assert.equal(ui.dataset.theme,'light');ui.click();assert.equal(ui.dataset.theme,'dark');ui.click();assert.equal(ui.dataset.theme,'light');
});
