'use strict';
// Capture conditions only. Never change panel text, precision, colors or fonts.
async function settle(page){
 await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));for(const c of Object.values(charts)){if(!c.canvas.getClientRects().length)continue;c.stop();c.resize();c.options.animation=false;c.update('none');}});
 // Chart.js debounces ResizeObserver; reducedMotion does not disable that timer.
 await page.waitForTimeout(250);
 await page.evaluate(()=>{for(const c of Object.values(charts)){if(c.canvas.getClientRects().length){c.stop();c.resize();c.update('none');}}});
}
async function selectScope(page,id,value){
 if(await page.locator('#'+id).inputValue()===value)return false;
 const key=id==='v2-account'?'account':'currency';
 await Promise.all([page.waitForURL(u=>u.searchParams.get(key)===value,{waitUntil:'domcontentloaded'}),page.locator('#'+id).selectOption(value)]);
 await page.waitForFunction(()=>document.querySelector('#loading')?.style.display==='none',null,{timeout:20000});
 return true;
}
async function panelShot(page,tab,file){
 await page.mouse.move(0,0);
 const before=await page.evaluate(tab=>{document.activeElement?.blur();window.scrollTo(0,0);const panel=document.getElementById('panel-'+tab);const old=panel.style.marginTop;const r=panel.getBoundingClientRect();panel.style.marginTop=(parseFloat(getComputedStyle(panel).marginTop)+512-r.top)+'px';return old;},tab);
 try{
  // Rebuild offscreen sticky-table layers after moving the capture origin.
  await page.evaluate(tab=>{const e=document.getElementById('panel-'+tab),display=e.style.display;e.style.display='none';void e.offsetHeight;e.style.display=display;},tab);
  await settle(page);
  const clip=await page.locator('#panel-'+tab).boundingBox();
  if(!Number.isInteger(clip.x)||!Number.isInteger(clip.y))throw Error('Panel capture origin must be integer-aligned: '+JSON.stringify(clip));
  return await page.screenshot({path:file,fullPage:true,clip:{x:clip.x,y:clip.y,width:Math.ceil(clip.width),height:Math.ceil(clip.height)},animations:'disabled'});
 }finally{await page.evaluate(({tab,before})=>{document.getElementById('panel-'+tab).style.marginTop=before;},{tab,before});}
}
async function headerState(page){return page.evaluate(()=>{
 window.scrollTo(0,0);
 const ids=['date-btn','theme-toggle','mobile-controls-toggle','v2-account','v2-currency'];
 const visible=e=>!!e.getClientRects().length;
 return {overflow:document.documentElement.scrollWidth>innerWidth+1,controls:ids.map(id=>{const e=document.getElementById(id);if(!e)return {id,present:false};const r=e.getBoundingClientRect(),v=visible(e),hit=v&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {id,present:true,visible:v,value:e.value,inside:!v||(r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight),unoccluded:!v||e===hit||e.contains(hit)};})};
});}
module.exports={settle,selectScope,panelShot,headerState};
