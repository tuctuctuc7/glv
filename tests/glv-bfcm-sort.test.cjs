const test = require('node:test');
const assert = require('node:assert/strict');
const sort = require('../public/glv-bfcm/sort.js');
test('default purchases descending; first click descending, second ascending',()=>{
 let state=sort.initial();assert.equal(state.key,'purchases');assert.equal(state.direction,'desc');
 state=sort.next(state,'purchases');assert.equal(state.direction,'desc');
 state=sort.next(state,'purchases');assert.equal(state.direction,'asc');
 state=sort.next(state,'spend');assert.equal(state.direction,'desc');
 state=sort.next(state,'spend');assert.equal(state.direction,'asc');
 state=sort.next(state,'purchases');assert.equal(state.direction,'desc');
});
test('every metric sorts numerically in both directions; missing stays last',()=>{
 for(const key of ['spend','purchases','roas','ctr','cpm','cost_lpv','cvr']){
  const rows=[{label:'missing',purchases:0,spend:0,[key]:null},{label:'large',purchases:0,spend:0,[key]:12},{label:'small',purchases:0,spend:0,[key]:2},{label:'zero',purchases:0,spend:0,[key]:0}];
  assert.deepEqual([...rows].sort(sort.compare({key,direction:'desc'})).map(r=>r.label),['large','small','zero','missing']);
  assert.deepEqual([...rows].sort(sort.compare({key,direction:'asc'})).map(r=>r.label),['zero','small','large','missing']);
 }
});
test('sorting keeps values unchanged and deterministic ties',()=>{
 const rows=[{label:'B',purchases:2,spend:5,roas:1},{label:'A',purchases:2,spend:5,roas:1}];const before=JSON.stringify(rows);
 assert.deepEqual([...rows].sort(sort.compare({key:'roas',direction:'desc'})).map(r=>r.label),['A','B']);assert.equal(JSON.stringify(rows),before);
});
