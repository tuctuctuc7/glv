const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../public/glv/index.html'), 'utf8');
for (const id of ['trendMetric', 'trendMetricSecondary']) {
  test(`${id} always lists None first and retains CAC exactly once`, () => {
    const select = html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`))[1];
    const values = [...select.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
    assert.equal(values[0], 'none');
    assert.equal(values.filter(value => value === 'cac').length, 1);
    assert.equal(new Set(values).size, values.length);
  });
}
