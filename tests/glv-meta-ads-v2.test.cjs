const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const V1_HASH = '422aa897010d80a8c8d4f40302c3a4c6a6bd85d982186c9d63560171dbfcbd7a';
const APPROVED_ICON_HASH = '4ee12623258531a1210f18833815132cdbf2be8624d1a43f72f9685b527d8685';
const requiredIds = [
  'date-btn', 'date-from', 'date-to', 'promo-active-days-only', 'include-leadgen',
  'kpi-czsk', 'chart-grain-czsk', 'chart-left-czsk', 'chart-right-czsk', 'chart-czsk',
  'daily-table-czsk', 'creative-type-czsk', 'creative-sort-czsk', 'creative-czsk',
  'kpi-czsk-promo', 'chart-promo-spend', 'chart-promo-roas', 'chart-promo-pie', 'promo-table',
  'kpi-czsk-leadgen', 'chart-metric-leadgen', 'chart-grain-leadgen', 'chart-leadgen-metric', 'chart-leadgen-pie', 'leadgen-table',
  'kpi-us', 'chart-grain-us', 'chart-left-us', 'chart-right-us', 'chart-us',
  'daily-table-us', 'creative-type-us', 'creative-sort-us', 'creative-us',
];

test('Meta Ads V1 remains byte-identical while V2 is a separate route', () => {
  const v1 = fs.readFileSync(path.join(root, 'public/glv-meta-ads/index.html'));
  assert.equal(crypto.createHash('sha256').update(v1).digest('hex'), V1_HASH);
  const v2 = read('public/glv-meta-ads-2/index.html');
  assert.match(v2, /GLV Meta Ads Pulse/);
  assert.doesNotMatch(v1.toString('utf8'), /GLV Meta Ads Pulse/);
});

test('Meta Ads V2 exposes the Agenthic favicon as an iPhone home-screen icon', () => {
  const v2 = read('public/glv-meta-ads-2/index.html');
  assert.match(v2, /<link rel="apple-touch-icon" sizes="180x180" href="\/glv-meta-ads-2\/apple-touch-icon\.png">/);
  const icon = fs.readFileSync(path.join(root, 'public/glv-meta-ads-2/apple-touch-icon.png'));
  assert.equal(icon.subarray(1, 4).toString('ascii'), 'PNG');
  assert.deepEqual([icon.readUInt32BE(16), icon.readUInt32BE(20)], [180, 180]);
});

test('Meta Ads V2 preserves the V1 feature surface and shared API', () => {
  const v2 = read('public/glv-meta-ads-2/index.html');
  for (const tab of ['czsk', 'czsk-promo', 'czsk-leadgen', 'us']) assert.match(v2, new RegExp(`data-tab="${tab}"`));
  for (const id of requiredIds) assert.match(v2, new RegExp(`id="${id}"`), `missing V1 control #${id}`);
  assert.match(v2, /\/api\/glv-meta-ads\/fb-data/);
  assert.match(v2, /last_7d/);
  assert.match(v2, /last_14d/);
  assert.match(v2, /last_30d/);
  assert.match(v2, /last_90d/);
  assert.match(v2, /this_month/);
  assert.match(v2, /last_month/);
});

test('Meta Ads V2 defines the Lead-gen inclusion and metric contract', () => {
  const v2 = read('public/glv-meta-ads-2/index.html');
  assert.match(v2, /Include Lead-gen/);
  assert.match(v2, /Lead-gen only/);
  assert.match(v2, /id="leadgen-only"/);
  assert.match(v2, /_Lead<\/strong> = Lead-gen/);
  for (const metric of ["key:'leads'", "key:'cpl'", "key:'lp2lead'"]) assert.match(v2, new RegExp(metric));
  assert.match(v2, /const isLeadGen/);
  assert.match(v2, /includeLeadGen = false/);
  assert.match(v2, /leadgenOnly = false/);
  assert.match(v2, /id="chart-metric-leadgen"/);
  assert.match(v2, /id="chart-grain-leadgen"/);
  assert.match(v2, /id="chart-left-leadgen"/);
  assert.match(v2, /id="chart-right-leadgen"/);
  assert.match(v2, /id="leadgen-pie-card"/);
  assert.match(v2, /setLeadgenChartGranularity/);
});

test('shared Meta API exposes lead actions without changing the V1 route', () => {
  for (const file of ['api/glv-meta-ads/fb-data.js', 'api/glv-meta-ads/cron.js']) {
    const api = read(file);
    assert.match(api, /'actions:lead'/);
    assert.match(api, /'actions:landing_page_view'/);
    assert.match(api, /onsite_conversion\.lead_grouped/);
    assert.match(api, /offsite_conversion\.fb_pixel_lead/);
  }
  const v2 = read('public/glv-meta-ads-2/index.html');
  assert.match(v2, /lp:parseNum\(r\['actions:landing_page_view'\]\)/);
  assert.match(v2, /getPromoSegmentRows/);
});

test('manual Meta cron can include the current partial day without changing the scheduled yesterday cutoff', () => {
  const cron = require('../api/glv-meta-ads/cron.js');
  const now = new Date('2026-08-14T12:00:00Z');
  assert.deepEqual(cron._test.monthRange('last_7d', false, now), { since: '2026-08-07', until: '2026-08-13' });
  assert.deepEqual(cron._test.monthRange('last_7d', true, now), { since: '2026-08-08', until: '2026-08-14' });
  assert.deepEqual(cron._test.monthRange('this_month', true, now), { since: '2026-08-01', until: '2026-08-14' });
  assert.deepEqual(cron._test.monthRange('this_month', false, new Date('2026-09-01T00:05:00Z')), { since: '2026-08-01', until: '2026-08-31' });
  const source = read('api/glv-meta-ads/cron.js');
  assert.match(source, /include_today/);
  assert.match(source, /partial current day/);
});

test('Meta cron rejects failed Redis writes instead of reporting a false success', async () => {
  const cron = require('../api/glv-meta-ads/cron.js');
  const originalFetch = global.fetch;
  const originalUrl = process.env.KV_REST_API_URL;
  const originalToken = process.env.KV_REST_API_TOKEN;
  process.env.KV_REST_API_URL = 'https://redis.invalid';
  process.env.KV_REST_API_TOKEN = 'test-token';
  try {
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'write failed' }) });
    await assert.rejects(cron._test.redisCmd('SET', 'key', 'value'), /Redis HTTP 500/);
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ error: 'ERR simulated' }) });
    await assert.rejects(cron._test.redisCmd('SET', 'key', 'value'), /Redis: ERR simulated/);
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ result: 'OK' }) });
    assert.deepEqual(await cron._test.redisCmd('SET', 'key', 'value'), { result: 'OK' });
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = originalUrl;
    if (originalToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = originalToken;
  }
});

test('Meta cron reports aggregate lead and landing-page-view totals for verification', () => {
  const cron = require('../api/glv-meta-ads/cron.js');
  assert.deepEqual(cron._test.summarizeRows([
    { 'actions:lead': '3', 'actions:landing_page_view': '12' },
    { 'actions:lead': '2', 'actions:landing_page_view': '8' },
  ]), { rows: 2, leads: 5, landingPageViews: 20 });
});

test('Meta cron returns HTTP 500 when cache writes fail', async () => {
  const cron = require('../api/glv-meta-ads/cron.js');
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const envNames = ['CRON_SECRET', 'GLV_META_FB_ACCESS_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];
  const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    CRON_SECRET: 'test-cron-secret',
    GLV_META_FB_ACCESS_TOKEN: 'test-meta-token',
    KV_REST_API_URL: 'https://redis.invalid',
    KV_REST_API_TOKEN: 'test-redis-token',
  });
  try {
    console.log = () => {};
    global.fetch = async (_url, options) => options?.method === 'POST'
      ? { ok: false, status: 500, json: async () => ({ error: 'write failed' }) }
      : { ok: true, status: 200, json: async () => ({ data: [] }) };
    const response = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return body; },
    };
    await cron({ headers: { authorization: 'Bearer test-cron-secret' }, query: { include_today: '1' } }, response);
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.ok, false);
    assert.match(response.body.message, /Redis HTTP 500/);
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
    for (const name of envNames) {
      if (originalEnv[name] === undefined) delete process.env[name]; else process.env[name] = originalEnv[name];
    }
  }
});

test('Meta Ads V2 provides accessible light and dark theme UX', () => {
  const v2 = read('public/glv-meta-ads-2/index.html');
  assert.match(v2, /rel="icon" type="image\/svg\+xml" href="\/glv-meta-ads-2\/agenthic-logo\.svg"/);
  const icon = fs.readFileSync(path.join(root, 'public/glv-meta-ads-2/agenthic-logo.svg'));
  assert.equal(crypto.createHash('sha256').update(icon).digest('hex'), APPROVED_ICON_HASH);
  assert.match(v2, /data-theme="dark"/);
  assert.match(v2, /data-theme="light"/);
  assert.match(v2, /id="theme-toggle"/);
  assert.match(v2, /aria-label="Switch to light theme"/);
  assert.match(v2, /prefers-reduced-motion/);
  assert.match(v2, /class="skip-link"/);
  assert.match(v2, /<main/);
});

test('one existing Meta Ads cron feeds both authenticated dashboard versions', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const cronPaths = vercel.crons.map(({ path: cronPath }) => cronPath);
  assert.deepEqual(cronPaths.filter(cronPath => cronPath.includes('glv-meta-ads')), ['/api/glv-meta-ads/cron']);

  const middleware = read('middleware.js');
  assert.match(middleware, /pathname === '\/glv-meta-ads-2'/);
  assert.match(middleware, /pathname\.startsWith\('\/glv-meta-ads-2\/'\)/);
  assert.match(middleware, /'\/glv-meta-ads-2\/:path\*'/);
  assert.match(middleware, /const DATA_PATH = '\/api\/glv-meta-ads\/fb-data'/);

  const releaseGuard = read('scripts/verify-glv-release.cjs');
  assert.match(releaseGuard, /glv-meta-ads-2/, 'the production build guard must preserve Meta Ads V2');
  assert.match(releaseGuard, /422aa897010d80a8c8d4f40302c3a4c6a6bd85d982186c9d63560171dbfcbd7a/, 'the production build guard must pin Meta Ads V1');
  assert.match(releaseGuard, /\/api\/glv-meta-ads\/cron/, 'the production build guard must enforce the shared cron');
});
