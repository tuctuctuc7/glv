const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const root = path.join(__dirname, '..');
const exporter = fs.readFileSync(path.join(root, 'export_glv_dashboard.py'), 'utf8');
const deploy = fs.readFileSync(path.join(root, 'deploy_glv_dashboard.sh'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');

const loadJson = (route) => JSON.parse(
  fs.readFileSync(path.join(root, 'public', route, 'glv_dashboard.json'), 'utf8'),
);

test('one exporter writes the same snapshot to v1 and v2', () => {
  assert.match(exporter, /public["'],\s*["']glv["'],\s*["']glv_dashboard\.json["']/);
  assert.match(exporter, /public["'],\s*["']glv-2["'],\s*["']glv_dashboard\.json["']/);

  const v1 = loadJson('glv');
  const v2 = loadJson('glv-2');
  assert.deepEqual(v2, v1);
  assert.deepEqual(
    fs.readFileSync(path.join(root, 'public', 'glv-2', 'glv_dashboard.json')),
    fs.readFileSync(path.join(root, 'public', 'glv', 'glv_dashboard.json')),
    'the deployed route snapshots must be byte-identical',
  );
});

test('the existing deploy flow commits both version snapshots', () => {
  assert.match(deploy, /public\/glv\/glv_dashboard\.json/);
  assert.match(deploy, /public\/glv-2\/glv_dashboard\.json/);
  assert.match(deploy, /npm run verify:glv-release/, 'production deployment must run the dual-route release guard');
  assert.match(vercel, /"buildCommand":\s*"npm run verify:glv-release"/, 'Vercel builds must reject stale or mismatched route data');
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

test('both routes ship the pinned approved AGENTHIC icon', () => {
  const approvedHash = '4ee12623258531a1210f18833815132cdbf2be8624d1a43f72f9685b527d8685';
  for (const route of ['glv', 'glv-2']) {
    const icon = fs.readFileSync(path.join(root, 'public', route, 'agenthic-logo.svg'));
    assert.equal(crypto.createHash('sha256').update(icon).digest('hex'), approvedHash);
  }
});
