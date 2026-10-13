const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('public/glv/index.html','utf8');
const app = fs.readFileSync('public/glv/app.js','utf8');
const keys = ['spend','revenue','roas','cac','nc_roas','new_customer_rate','new_customer_revenue','returning_customer_revenue','cvr','purchases','cpa','aov','unique_visitors'];
test('Home headers and summary/detail values follow the requested metric order at every grain', () => {
  const headers = [...html.match(/<table id="metricsTable">([\s\S]*?)<\/table>/)[1].matchAll(/<th\b[^>]*>(.*?)<\/th>/g)].map(m=>m[1]);
  assert.deepEqual(headers,['Date','Spend','Revenue','ROAS','CAC','NC ROAS','NC rate','NC revenue','RC revenue','CVR','Purchases','Cost per purchase','AOV','Visitors']);
  for (const grain of ['day','week','month','year']) {
    const nodes = {}; const node = () => ({children:[],appendChild(n){this.children.push(n);}});
    const row = Object.fromEntries(keys.map((k,i)=>[k,i+1])); row.label='period';
    const context = { $:id=>nodes[id] ||= {...node(),value:grain}, clear:n=>n.children=[], element:(tag,cls,value)=>({value}), document:{createElement:node}, metrics:{groupRows:()=>[row],aggregateRows:()=>row}, rowsForGrain:()=>({rows:[row],history:{rows:[]}}), formatMetric:(k,v)=>`${k}:${v}`,formatAuditMetric:(k,v)=>`${k}:${v}`,renderHistoricalNote:()=>{} };
    vm.createContext(context);
    vm.runInContext(app.slice(app.indexOf('function renderTable(view)'),app.indexOf('function renderScope(view)')),context);
    context.renderTable({});
    for (const rendered of nodes.metricsTableBody.children) assert.deepEqual(Array.from(rendered.children.slice(1),n=>n.value),keys.map(k=>`${k}:${row[k]}`));
  }
});
