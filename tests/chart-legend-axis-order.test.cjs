const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('every generated dual-axis legend explicitly sorts left-axis metrics before right-axis metrics', () => {
  const legacy = read('public/glv/app.js');
  const elm = read('public/elm-meta-ads/app.js');
  const meta = read('public/glv-meta-ads/index.html');

  assert.match(legacy, /function sortLegendByAxis\(/);
  assert.match(legacy, /legend:\s*\{\s*labels:\s*\{[^}]*sort:\s*sortLegendByAxis/s);

  assert.match(elm, /function sortLegendByAxis\(/);
  assert.match(elm, /legend:\s*\{\s*labels:\s*\{[^}]*sort:\s*sortLegendByAxis/s);

  assert.match(meta, /function sortLegendByAxis\(/);
  assert.ok((meta.match(/sort:sortLegendByAxis/g) || []).length >= 3,
    'Meta Home, Triage, and Lead-gen dual-axis charts must share the axis-aware legend sort');
});

test('GLV V2 custom trend legend already renders primary left-axis metric before secondary right-axis metric', () => {
  const app = read('public/glv-2/app.js');
  const legendBlock = app.match(/const legend = \$\('trendLegend'\);([\s\S]*?)if \(!window\.Chart\)/)?.[1] || '';
  assert.ok(legendBlock.indexOf('barLegend') < legendBlock.indexOf('lineLegend'));
  assert.match(app, /yAxisID:\s*'y'[\s\S]*?yAxisID:\s*'y1'/);
});
