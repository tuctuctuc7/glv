const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const exporter = fs.readFileSync(path.join(root, 'export_glv_dashboard.py'), 'utf8');
const deploy = fs.readFileSync(path.join(root, 'deploy_glv_dashboard.sh'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

test('one exporter writes only the canonical snapshot', () => {
  assert.match(exporter, /public["'],\s*["']glv["'],\s*["']glv_dashboard\.json["']/);
  assert.equal((exporter.match(/os\.path\.join\(ROOT, "public"/g) || []).length, 1);
  assert.doesNotMatch(exporter, /glv-2/);
});

test('shared refresh commits only canonical data from current origin/main and fails closed', () => {
  assert.match(deploy, /git -C "\$ROOT" fetch origin main/);
  assert.match(deploy, /git -C "\$ROOT" worktree add --detach "\$RELEASE_ROOT" origin\/main/);
  assert.match(deploy, /DATASETS=\(\s*public\/glv\/glv_dashboard\.json\s*\)/);
  assert.match(deploy, /npm run verify:glv-release/);
  assert.match(deploy, /git push origin HEAD:main/);
  assert.doesNotMatch(deploy, /git push[^\n]+\|\| echo/);
  assert.doesNotMatch(deploy, /vercel --prod/);
  assert.match(deploy, /commits\/\$release_sha\/status/);
  assert.equal(vercel.buildCommand, 'npm run verify:glv-release');
  assert.deepEqual(vercel.crons, [{ path: '/api/glv-meta-ads/cron', schedule: '0 0 * * *' }]);
  assert.ok(vercel.headers.some(entry => entry.source === '/glv/:path*' && entry.headers.some(header => header.key === 'Cache-Control' && header.value === 'no-store')));
});
