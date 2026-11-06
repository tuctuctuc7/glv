const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const phases = require('../public/glv/phases.js');
const comparison = require('../public/glv/promo-comparison.js');
const entry = (start, end) => ({phase:'Promo', label:'promo gummies', start_date:start, end_date:end, source_row:53});
const cases = ['2026-11-04','2026-11-06','2026-11-08'].map(end => ({schedule:[entry('2026-10-28',end)], label:'VB2'}));
cases.push({schedule:[entry('2027-10-28','2027-11-06')],label:'October'}, {schedule:[entry('2026-10-01','2026-10-05')],label:'October'}, {schedule:[entry('2026-10-07','2026-10-14')],label:'Menopause'});
test('browser preserves VB2 display identity across end extensions, scoped to 2026 start', () => {
  for (const {schedule,label} of cases) {
    const [event] = phases.buildPromoEvents(schedule);
    assert.equal(event.label,label);
    assert.equal(event.id,`promo:${schedule[0].start_date}/${schedule[0].end_date}`);
    assert.equal(event.end_date,schedule[0].end_date);
    assert.deepEqual(event.sources,schedule);
    assert.equal(phases.buildPromoCohorts(schedule)[0].label,label);
  }
  const schedule=[entry('2026-10-28','2026-11-06')];
  const rows=['2026-10-28','2026-11-05'].map(date=>({date,region:'czsk',phase:'Promo',revenue:100,spend:20}));
  const result=comparison.buildEvents(rows,phases.buildPromoEvents(schedule),undefined,'revenue');
  assert.equal(result.series[0].month,'promo:2026-10-28/2026-11-06');
  assert.equal(result.series[0].values.length,9);
  assert.equal(result.series[0].values[8],100);
});
test('exporter preserves VB2 display identity across end extensions with unchanged sources and IDs', () => {
  const run=spawnSync(process.env.GLV_TEST_PYTHON || 'python3',['-c',`import json,sys
import ast,datetime as dt,pathlib
# Exercise the real pure producer without requiring live Sheets dependencies.
tree=ast.parse(pathlib.Path('export_glv_dashboard.py').read_text())
function=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='build_promo_events')
exec(compile(ast.Module(body=[function],type_ignores=[]),'export_glv_dashboard.py','exec'))
cases=json.load(sys.stdin)
print(json.dumps([build_promo_events(c['schedule']) for c in cases]))`],{input:JSON.stringify(cases),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  JSON.parse(run.stdout).forEach(([event],i)=>{
    const {schedule,label}=cases[i];
    assert.equal(event.label,label);
    assert.equal(event.id,`promo:${schedule[0].start_date}/${schedule[0].end_date}`);
    assert.equal(event.end_date,schedule[0].end_date);
    assert.deepEqual(event.sources,schedule);
  });
});
