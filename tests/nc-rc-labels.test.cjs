const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('customer metric display names use NC/RC throughout the master dashboard',()=>{
 for(const file of ['app.js','promo-comparison-ui.js','index.html','section-info.js']) {
  const text=fs.readFileSync(`public/glv/${file}`,'utf8');
  assert.doesNotMatch(text,/New customer (?:revenue|rate)|Returning customer revenue|RC revenue|NC revenue|NC rate/,file);
 }
 const app=fs.readFileSync('public/glv/app.js','utf8');
 assert.ok(app.includes("'NC Revenue (USD)', 'RC Revenue (USD)', 'NC ROAS'"),'CSV display headers');
 for(const [key,label] of Object.entries({nc_roas:'NC ROAS',new_customer_revenue:'NC Revenue',returning_customer_revenue:'RC Revenue',new_customer_rate:'NC Rate'})) assert.ok(app.includes(`${key}: { label: '${label}'`));
});
