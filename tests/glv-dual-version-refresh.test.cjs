const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const exporter = fs.readFileSync(path.join(root, 'export_glv_dashboard.py'), 'utf8');
const deploy = fs.readFileSync(path.join(root, 'deploy_glv_dashboard.sh'), 'utf8');

const loadJson = (route) => JSON.parse(
  fs.readFileSync(path.join(root, 'public', route, 'glv_dashboard.json'), 'utf8'),
);

test('one exporter writes the same snapshot to v1 and v2', () => {
  assert.match(exporter, /public["'],\s*["']glv["'],\s*["']glv_dashboard\.json["']/);
  assert.match(exporter, /public["'],\s*["']glv-2["'],\s*["']glv_dashboard\.json["']/);

  const v1 = loadJson('glv');
  const v2 = loadJson('glv-2');
  assert.deepEqual(v2, v1);
});

test('the existing deploy flow commits both version snapshots', () => {
  assert.match(deploy, /public\/glv\/glv_dashboard\.json/);
  assert.match(deploy, /public\/glv-2\/glv_dashboard\.json/);
});

test('v1 and v2 remain separate working routes during the overlap period', () => {
  for (const route of ['glv', 'glv-2']) {
    assert.equal(fs.existsSync(path.join(root, 'public', route, 'index.html')), true, `${route} index is missing`);
    assert.equal(fs.existsSync(path.join(root, 'public', route, 'app.js')), true, `${route} app is missing`);
    assert.equal(fs.existsSync(path.join(root, 'public', route, 'styles.css')), true, `${route} styles are missing`);
  }

  const v1App = fs.readFileSync(path.join(root, 'public', 'glv', 'app.js'), 'utf8');
  const v2App = fs.readFileSync(path.join(root, 'public', 'glv-2', 'app.js'), 'utf8');
  assert.match(v1App, /glv_dashboard\.json/);
  assert.match(v2App, /\/glv-2\/glv_dashboard\.json/);
});
