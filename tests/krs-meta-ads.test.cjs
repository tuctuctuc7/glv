const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const APPROVED_ICON_HASH = '4ee12623258531a1210f18833815132cdbf2be8624d1a43f72f9685b527d8685';

test('KURSA dashboard is a separate route with a route-local runtime contract', () => {
  const html = read('public/krs-meta-ads/index.html');
  assert.match(html, /<title>KURSA Meta Ads Pulse<\/title>/);
  assert.match(html, /\/api\/krs-meta-ads\/fb-data/);
  assert.doesNotMatch(html, /\/api\/glv-meta-ads\/fb-data/);
  assert.match(html, /\/krs-meta-ads\/agenthic-logo\.svg/);
  assert.match(html, /\/krs-meta-ads\/apple-touch-icon\.png/);
  assert.match(read('public/krs-meta-ads/login.html'), /KURSA Meta Ads/);
  const icon = fs.readFileSync(path.join(root, 'public/krs-meta-ads/agenthic-logo.svg'));
  assert.equal(sha256(icon), APPROVED_ICON_HASH);
});

test('KURSA dashboard presents the lead-quality funnel and required KPI contract', () => {
  const html = read('public/krs-meta-ads/index.html');
  for (const label of [
    'Spend', 'Purchases / leads', 'CPA / CPL', 'LP → Checkout',
    'Checkout → Purchase', 'LP → Purchase', 'CTR', 'Cost / LP view', 'CPM',
  ]) assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /Checkout = CTA button click/);
  assert.match(html, /Purchase = qualified lead submit/);
  assert.match(html, /Lead quality value/);
  assert.match(html, /Revenue & ROAS are directional/);
  assert.match(html, /function calcMetrics/);
  assert.match(html, /purchases\s*\/\s*a\.lp\s*\*\s*100/);
  assert.match(html, /purchases\s*\/\s*a\.checkouts\s*\*\s*100/);
  assert.match(html, /a\.clicks\s*\/\s*a\.impressions\s*\*\s*100/);
});

test('KURSA live normalizer uses fallback precedence without double counting events', () => {
  const api = require('../api/krs-meta-ads/fb-data.js');
  const row = api._test.normalizeCampaign({
    campaign_id: 'campaign', campaign_name: 'AG_Test', spend: '100', impressions: '1000', inline_link_clicks: '50',
    actions: [
      { action_type: 'landing_page_view', value: '40' },
      { action_type: 'omni_landing_page_view', value: '41' },
      { action_type: 'initiate_checkout', value: '12' },
      { action_type: 'offsite_conversion.fb_pixel_initiate_checkout', value: '13' },
      { action_type: 'purchase', value: '5' },
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '6' },
    ],
    action_values: [
      { action_type: 'purchase', value: '9000' },
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '9100' },
    ],
  });
  assert.deepEqual({
    lpv: row['actions:landing_page_view'],
    checkout: row['actions:initiate_checkout'],
    purchase: row['actions:purchase'],
    value: row['action_values:purchase'],
    clicks: row.inline_link_clicks,
  }, { lpv: '40', checkout: '12', purchase: '5', value: '9000', clicks: '50' });
  assert.deepEqual(api._test.accountContract(), {
    id: '903309897610642', currency: 'CZK', timezone: 'Europe/Prague', cachePrefix: 'krs',
  });
  assert.deepEqual(api._test.presetRange('last_7d', new Date('2026-08-15T12:00:00Z')), {
    since: '2026-08-08', until: '2026-08-14',
  });
  assert.deepEqual(api._test.presetRange('this_month', new Date('2026-08-01T12:00:00Z')), {
    since: '2026-08-01', until: '2026-08-01', empty: true,
  });
  assert.equal(api._test.cacheKey('last_7d'), 'krs:preset:last_7d');
});

test('KURSA cron and live API share the same normalized funnel schema', () => {
  const cron = require('../api/krs-meta-ads/cron.js');
  const now = new Date('2026-08-15T12:00:00Z');
  assert.deepEqual(cron._test.monthRange('last_7d', false, now), { since: '2026-08-08', until: '2026-08-14' });
  assert.deepEqual(cron._test.monthRange('last_7d', true, now), { since: '2026-08-09', until: '2026-08-15' });
  assert.deepEqual(cron._test.summarizeRows([
    { amount_spent: '100', 'actions:landing_page_view': '20', 'actions:initiate_checkout': '8', 'actions:purchase': '3' },
    { amount_spent: '50', 'actions:landing_page_view': '10', 'actions:initiate_checkout': '4', 'actions:purchase': '2' },
  ]), { rows: 2, spend: 150, landingPageViews: 30, checkouts: 12, purchases: 5 });
  for (const file of ['api/krs-meta-ads/fb-data.js', 'api/krs-meta-ads/cron.js']) {
    const source = read(file);
    for (const field of ["'actions:landing_page_view'", "'actions:initiate_checkout'", "'actions:purchase'", "'action_values:purchase'"]) {
      assert.match(source, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  }
  assert.match(read('api/krs-meta-ads/cron.js'), /redisSet\(shared\.cacheKey\(preset\), datasets\)/);
});

test('KURSA API treats a transient Redis read failure as a live-cache miss', async () => {
  const handler = require('../api/krs-meta-ads/fb-data.js');
  const previousFetch = global.fetch;
  const previousEnv = { token: process.env.KRS_META_FB_ACCESS_TOKEN, url: process.env.KV_REST_API_URL, redisToken: process.env.KV_REST_API_TOKEN };
  process.env.KRS_META_FB_ACCESS_TOKEN = 'test-token';
  process.env.KV_REST_API_URL = 'https://redis.invalid';
  process.env.KV_REST_API_TOKEN = 'test-redis-token';
  global.fetch = async url => {
    if (String(url).startsWith('https://redis.invalid')) return { ok: false, status: 503, json: async () => ({ error: 'temporary' }) };
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  const headers = {};
  const response = { code: 0, body: null, setHeader: (key, value) => { headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return body; } };
  try {
    await handler({ method: 'GET', query: { type: 'aggregate', date_preset: 'last_7d' } }, response);
    assert.equal(response.code, 200);
    assert.deepEqual(response.body.rows, []);
    assert.equal(headers['X-Cache'], 'MISS');
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries({ KRS_META_FB_ACCESS_TOKEN: previousEnv.token, KV_REST_API_URL: previousEnv.url, KV_REST_API_TOKEN: previousEnv.redisToken })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('KURSA authentication, cron, and release guard are independently wired', () => {
  const middleware = read('middleware.js');
  assert.match(middleware, /KRS_AUTH_COOKIE/);
  assert.match(middleware, /\/krs-meta-ads\/login/);
  assert.match(middleware, /\/api\/krs-meta-ads\/fb-data/);
  assert.match(middleware, /'\/krs-meta-ads\/:path\*'/);
  const auth = require('../api/krs-meta-ads/auth.js');
  assert.match(read('api/krs-meta-ads/auth.js'), /checkRateLimit/);
  const rateKey = auth._test.rateLimitKey({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } });
  assert.match(rateKey, /^krs:auth:[a-f0-9]{24}$/);
  assert.doesNotMatch(rateKey, /203\.0\.113\.7/);
  const vercel = JSON.parse(read('vercel.json'));
  assert.equal(vercel.crons.some(({ path: cronPath }) => cronPath === '/api/krs-meta-ads/cron'), true);
  assert.equal(vercel.functions['api/krs-meta-ads/cron.js'].maxDuration, 60);
  const guard = read('scripts/verify-glv-release.cjs');
  assert.match(guard, /krs-meta-ads/);
  assert.match(guard, /KURSA Meta Ads Pulse/);
});
