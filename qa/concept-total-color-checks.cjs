// Real rendered CSS on synthetic metrics; no Meta requests.
const assert=require('node:assert/strict'),fs=require('node:fs');
module.exports=async(page,width,theme)=>{
 const dir='/tmp/glv-total-color-qa';fs.mkdirSync(dir,{recursive:true});
 const row=page.locator('#promo-concept-table .subtotal-row'),first=row.locator('td').first();
 await row.scrollIntoViewIfNeeded();
 for(const hover of [false,true]){
  if(hover)await first.hover();else await page.mouse.move(0,0);
  const styles=await page.evaluate(()=>{
   const table=document.querySelector('#promo-concept-table'),ctx=document.createElement('canvas').getContext('2d');
   const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
   const style=el=>({rgba:rgba(getComputedStyle(el).backgroundColor),position:getComputedStyle(el).position});
   return {cells:[...table.querySelectorAll('.subtotal-row td')].map(style),header:style(table.querySelector('th')),data:style(table.querySelector('tr:not(.subtotal-row) td')),surface:rgba(getComputedStyle(table).getPropertyValue('--surface'))};
  });
  for(const cell of styles.cells){assert.deepEqual(cell.rgba,styles.cells[1].rgba,`${width}/${theme}/hover=${hover}: Total matches native subtotal`);assert.equal(cell.rgba[3],255,'subtotal is opaque');}
  assert.equal(styles.cells[0].position,'sticky');
  for(const cell of [styles.header,styles.data]){assert.equal(cell.position,'sticky');assert.deepEqual(cell.rgba,styles.surface,'normal pinned cells retain surface');}
  // Compare actual painted background, away from text and borders.
  const a=await first.boundingBox(),b=await row.locator('td').nth(1).boundingBox();
  if(b.x+3<width){
   const shot=await page.screenshot();
   const pixels=await page.evaluate(async({image,points})=>{const img=new Image();img.src=image;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return points.map(([x,y])=>[...ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data]);},{image:`data:image/png;base64,${shot.toString('base64')}`,points:[[a.x+3,a.y+4],[b.x+3,b.y+4]]});
   assert.deepEqual(pixels[0],pixels[1],'painted Total and metric backgrounds match');
  }
 }
 const scroll=await page.evaluate(()=>{const el=document.querySelector('.concept-scroll');el.scrollLeft=140;return el.scrollLeft;});
 if(scroll){
  await page.mouse.move(0,0);
  const clip=await first.boundingBox();
  const before=await page.screenshot({clip});
  // A high-contrast moving metric must remain completely hidden by the pinned cell.
  await row.locator('td').nth(1).evaluate(el=>{el.dataset.oldStyle=el.getAttribute('style')||'';el.style.background='#ff00ff';el.style.color='#000';});
  const after=await page.screenshot({clip});assert.equal(await page.locator('.concept-scroll').evaluate(el=>el.scrollLeft),scroll,'capture preserves real horizontal scroll');assert.deepEqual(after,before,`${width}/${theme}: no underlying metric bleed-through`);
  await row.locator('td').nth(1).evaluate(el=>{el.setAttribute('style',el.dataset.oldStyle);delete el.dataset.oldStyle;});
 }
 await page.screenshot({path:`${dir}/${width}-${theme}-subtotal${scroll?'-scrolled':''}.png`});
 await page.evaluate(()=>{document.querySelector('.concept-scroll').scrollLeft=0;});
};
