// Synthetic geometry and exact native-component parity; never calls Meta.
const fs=require('node:fs'),assert=require('node:assert/strict');
module.exports=async function(page,width,theme){
 const baseline=process.argv.includes('--baseline'),dir=`/tmp/glv-concept-${baseline?'before':'after'}`;fs.mkdirSync(dir,{recursive:true});
 const evidence=await page.evaluate(()=>{
  const key=document.querySelector('#tab-filters-czsk-promo .filter-wrap').id.replace('filter-wrap-','');
  buildTriageFilterOptions(key,[{value:'qa',label:'Synthetic campaign'}]);
  const props=['fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor','borderColor','borderRadius','padding','minHeight'];
  const style=el=>Object.fromEntries(props.map(p=>[p,getComputedStyle(el)[p]]));
  const native=document.querySelector('#tab-filters-czsk-promo .filter-wrap');
  const concept=document.querySelector('#promo-concept-campaigns');
  const pairs=[['trigger','.filter-toggle','summary'],['search','.filter-search'],['option','.filter-option'],['actions','.filter-action-btn'],['dropdown','.filter-dropdown']];
  return Object.fromEntries(pairs.map(([name,sel,fallback])=>[name,{native:style(native.querySelector(sel)),concept:concept.querySelector(sel)||fallback&&concept.querySelector(fallback)?style(concept.querySelector(sel)||concept.querySelector(fallback)):null}]));
 });
 fs.writeFileSync(`${dir}/${width}-${theme}-styles.json`,JSON.stringify(evidence,null,2));
 if(!baseline)for(const [part,styles] of Object.entries(evidence))assert.deepEqual(styles.concept,styles.native,`${width}/${theme} ${part} exact native style parity`);
 const original=await page.evaluate(()=>conceptPayload);
 for(const count of [19,50]){
  await page.evaluate(({count,original})=>{conceptPayload={...original,rows:Array.from({length:count},(_,i)=>({...original.rows[0],ad_id:`qa${i}`,ad_name:`PAC${100+i}`}))};renderPromoConcepts();},{count,original});
  const geometry=await page.evaluate(()=>{
   const wrap=document.querySelector('.concept-scroll'),table=wrap.querySelector('table'),rows=[...table.querySelectorAll('tbody tr')],r=wrap.getBoundingClientRect();
   return {count:rows.filter(row=>!row.classList.contains('subtotal-row')).length,totalCount:rows.filter(row=>row.classList.contains('subtotal-row')).length,firstLabel:rows[0].cells[0].textContent,height:r.height,scrollHeight:wrap.scrollHeight,clientHeight:wrap.clientHeight,scrollWidth:wrap.scrollWidth,clientWidth:wrap.clientWidth,maxHeight:getComputedStyle(wrap).maxHeight,secondary:rows.some(row=>row.cells[0].children.length!==1),allVisible:rows.every(row=>{const b=row.getBoundingClientRect();return b.height>0&&b.top>=r.top&&b.bottom<=r.bottom+1;}),rowHeight:rows[0].getBoundingClientRect().height};
  });
  fs.writeFileSync(`${dir}/${width}-${theme}-${count}-geometry.json`,JSON.stringify(geometry,null,2));
  if(!baseline){assert.equal(geometry.count,count);assert.equal(geometry.totalCount,1);assert.equal(geometry.firstLabel,'Total');assert.equal(geometry.secondary,false);assert.equal(geometry.maxHeight,'none');assert.ok(geometry.scrollHeight<=geometry.clientHeight+1);assert.equal(geometry.allVisible,true);if(width===1440){assert.ok(geometry.scrollWidth<=geometry.clientWidth+1);assert.ok(geometry.rowHeight<=36);}}
  if(!baseline){
   const viewport=page.viewportSize();
   // Ordinary viewport, real document scroll, unchanged fixed navigation.
   await page.setViewportSize({width,height:width<=720?844:1100});
   await page.evaluate(()=>{document.querySelector('.concept-scroll').scrollLeft=0;window.scrollTo(0,document.documentElement.scrollHeight);});
   await page.waitForTimeout(100);
   const reach=await page.evaluate(()=>{
    const row=document.querySelector('#promo-concept-table tbody tr:last-child'),cell=row.cells[0],r=cell.getBoundingClientRect(),nav=document.querySelector('.header-tabs'),n=nav.getBoundingClientRect();
    const fixedBottom=getComputedStyle(nav).position==='fixed'&&n.top>innerHeight/2;
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return {viewport:{width:innerWidth,height:innerHeight},lastLabel:cell.textContent,lastRow:r.toJSON(),nav:n.toJSON(),fixedBottom,bodyPaddingBottom:getComputedStyle(document.body).paddingBottom,clearance:(fixedBottom?n.top:innerHeight)-r.bottom,visible:r.top>=0&&r.bottom<=(fixedBottom?n.top:innerHeight),hit:cell===hit||cell.contains(hit)};
   });
   fs.writeFileSync(`${dir}/${width}-${theme}-${count}-reachability.json`,JSON.stringify(reach,null,2));
   assert.equal(reach.visible,true,`${width}/${theme}/${count} last row above navigation`);
   assert.equal(reach.hit,true,`${width}/${theme}/${count} last row hit-test`);
   if([1440,390,320].includes(width))await page.screenshot({path:`${dir}/${width}-${theme}-${count}-bottom-viewport.png`});
   await page.setViewportSize(viewport);
  }
  if(width===1440&&count===19){
   // Tall desktop viewport shows the complete section plus real app chrome.
   const viewport=page.viewportSize();await page.setViewportSize({width,height:Math.ceil(geometry.height)+500});
   await page.evaluate(()=>window.scrollTo(0,document.querySelector('#promo-concept-section').getBoundingClientRect().top+scrollY-150));
   await page.screenshot({path:`${dir}/${width}-${theme}-19.png`});
   await page.setViewportSize(viewport);
  }
 }
 await page.evaluate(original=>{conceptPayload=original;renderPromoConcepts();},original);
 if(!baseline){
  const trigger=page.locator('#filter-toggle-promo-concept'),menu=page.locator('#filter-dropdown-promo-concept');
  await trigger.focus();await page.keyboard.press('Enter');assert.equal(await trigger.getAttribute('aria-expanded'),'true');
  const search=menu.locator('.filter-search');await search.fill('TUC_2');assert.equal(await menu.locator('.filter-option:visible').count(),1);
  await menu.locator('.filter-action-btn').filter({hasText:'Select all'}).click();assert.deepEqual(await page.evaluate(()=>conceptSelection),['c1','c2']);
  const labels=await page.locator('#promo-concept-table tbody td:first-child').evaluateAll(cells=>cells.filter(c=>c.textContent==='CC01').map(c=>c.getAttribute('aria-label')));assert.equal(new Set(labels).size,2,'same concept in two campaigns remains distinguishable');
  await search.fill('');const checkbox=menu.locator('input[value="c2"]');await checkbox.focus();await page.keyboard.press('Space');assert.deepEqual(await page.evaluate(()=>conceptSelection),['c1']);assert.equal(await checkbox.evaluate(el=>el===document.activeElement),true);
  if([1440,390].includes(width))await page.screenshot({path:`${dir}/${width}-${theme}-filter-open.png`});
  await page.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Space');assert.equal(await trigger.getAttribute('aria-expanded'),'true');await page.locator('#promo-concept-title').click();assert.equal(await trigger.getAttribute('aria-expanded'),'false');
 }
};
