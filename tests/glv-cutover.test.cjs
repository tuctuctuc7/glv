const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const middleware = () => import(`data:text/javascript;base64,${Buffer.from(read('middleware.js')).toString('base64')}`);

test('approved Pulse is the sole canonical runtime, with release-versioned dependencies', () => {
  assert.equal(fs.existsSync(path.join(root, 'public/glv-2')), false);
  const html = read('public/glv/index.html');
  assert.match(html, /<title>GLV Executive Pulse<\/title>/);
  for (const file of ['app.js', 'metrics.js', 'styles.css']) {
    assert.ok(html.includes(`/glv/${file}?v=canonical-20260906`), file);
  }
  for (const file of ['index.html', 'app.js', 'styles.css', 'metrics.js']) assert.ok(!read(`public/glv/${file}`).includes('/glv-2/'));
  assert.ok(!read('export_glv_dashboard.py').includes('glv-2'));
  assert.ok(!read('deploy_glv_dashboard.sh').includes('glv-2'));
});

test('retired bookmarks and already-open asset requests permanently redirect before auth', async () => {
  const { default: run, config } = await middleware();
  assert.ok(config.matcher.includes('/glv-2'));
  assert.ok(config.matcher.includes('/glv-2/:path*'));
  for (const suffix of ['', '/', '/glv_dashboard.json', '/glv_2025_monthly.json', '/metrics.js', '/fonts/inter-400.woff2']) {
    const old = `https://example.test/glv-2${suffix}?preset=custom&from=2025-01-01&regions=czsk&regions=us#trend`;
    const response = await run(new Request(old));
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), old.replace('/glv-2', '/glv'));
  }
  assert.equal(await run(new Request('https://example.test/glv-20/')), undefined);
  assert.equal(await run(new Request('https://example.test/glv/')), undefined);
  assert.equal((await run(new Request('https://example.test/api/glv-meta-ads/fb-data'))).status, 401);
});
