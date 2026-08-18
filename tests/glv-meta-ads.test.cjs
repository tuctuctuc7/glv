const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const APPROVED_ICON_HASH = '4ee12623258531a1210f18833815132cdbf2be8624d1a43f72f9685b527d8685';
const requiredIds = [
  'date-btn', 'date-from', 'date-to', 'promo-active-days-only', 'include-leadgen',
  'kpi-czsk', 'chart-grain-czsk', 'chart-left-czsk', 'chart-right-czsk', 'chart-czsk',
  'daily-table-czsk', 'creative-type-czsk', 'creative-sort-czsk', 'creative-czsk',
  'kpi-czsk-promo', 'chart-metric-promo-spend', 'chart-metric-promo-roas', 'chart-metric-promo-pie',
  'promo-chart-title-spend', 'promo-chart-title-roas', 'promo-chart-title-pie',
  'promo-chart-table-spend', 'promo-chart-table-roas', 'promo-chart-table-pie',
  'chart-promo-spend', 'chart-promo-roas', 'chart-promo-pie', 'promo-table',
  'kpi-czsk-leadgen', 'chart-metric-leadgen', 'chart-grain-leadgen', 'chart-leadgen-metric', 'chart-leadgen-pie', 'leadgen-table',
  'kpi-us', 'chart-grain-us', 'chart-left-us', 'chart-right-us', 'chart-us',
  'daily-table-us', 'creative-type-us', 'creative-sort-us', 'creative-us',
];

test('the approved Meta Ads Pulse is the one canonical dashboard', () => {
  const dashboard = read('public/glv-meta-ads/index.html');
  const login = read('public/glv-meta-ads/login.html');
  assert.match(dashboard, /GLV Meta Ads Pulse/);
  assert.equal(fs.existsSync(path.join(root, 'public/glv-meta-ads-2')), false);
  assert.doesNotMatch(dashboard, /\/glv-meta-ads-2\//);
  assert.match(login, /Private dashboard access/);
  assert.doesNotMatch(login, /Beta access/i);
});

test('the canonical Meta dashboard exposes its home-screen icon and retires the old URL', async () => {
  const dashboard = read('public/glv-meta-ads/index.html');
  assert.match(dashboard, /<link rel="apple-touch-icon" sizes="180x180" href="\/glv-meta-ads\/apple-touch-icon\.png">/);
  const icon = fs.readFileSync(path.join(root, 'public/glv-meta-ads/apple-touch-icon.png'));
  assert.equal(icon.subarray(1, 4).toString('ascii'), 'PNG');
  assert.deepEqual([icon.readUInt32BE(16), icon.readUInt32BE(20)], [180, 180]);
  const middleware = read('middleware.js');
  assert.match(middleware, /'\/glv-meta-ads\/agenthic-logo\.svg'/);
  assert.match(middleware, /'\/glv-meta-ads\/apple-touch-icon\.png'/);
  assert.match(middleware, /PUBLIC_ASSET_PATHS\.has\(pathname\)/);
  const { default: authorize } = await import(`data:text/javascript;base64,${Buffer.from(middleware).toString('base64')}`);
  const request = pathname => ({ url: `https://lab.agenthic.com${pathname}`, headers: new Headers() });
  assert.equal(authorize(request('/glv-meta-ads/agenthic-logo.svg')), undefined);
  assert.equal(authorize(request('/glv-meta-ads/apple-touch-icon.png')), undefined);
  assert.equal(authorize(request('/glv-meta-ads/')).status, 302);
  for (const oldPath of ['/glv-meta-ads-2', '/glv-meta-ads-2/', '/glv-meta-ads-2/apple-touch-icon.png?install=1']) {
    const response = authorize(request(oldPath));
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), `https://lab.agenthic.com${oldPath.replace('/glv-meta-ads-2', '/glv-meta-ads')}`);
  }
  assert.equal(authorize(request('/api/glv-meta-ads/fb-data')).status, 401);
});

test('the canonical Meta dashboard preserves the approved feature surface and shared API', () => {
  const v2 = read('public/glv-meta-ads/index.html');
  for (const tab of ['czsk', 'czsk-triage', 'czsk-promo', 'czsk-leadgen', 'us']) assert.match(v2, new RegExp(`data-tab="${tab}"`));
  for (const id of requiredIds) assert.match(v2, new RegExp(`id="${id}"`), `missing V1 control #${id}`);
  assert.match(v2, /\/api\/glv-meta-ads\/fb-data/);
  assert.match(v2, /last_7d/);
  assert.match(v2, /last_14d/);
  assert.match(v2, /last_30d/);
  assert.match(v2, /last_90d/);
  assert.match(v2, /this_month/);
  assert.match(v2, /last_month/);
  assert.match(v2, /\$\{a\.purchases>0\?fmtInt\(a\.purchases\):'—'\}/);
});

test('the canonical Meta dashboard defines the Lead-gen inclusion and metric contract', () => {
  const v2 = read('public/glv-meta-ads/index.html');
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

test('Promo group charts have independent metric controls and LP to Purchase is available dashboard-wide', () => {
  const dashboard = read('public/glv-meta-ads/index.html');
  for (const id of ['chart-metric-promo-spend', 'chart-metric-promo-roas', 'chart-metric-promo-pie']) {
    assert.match(dashboard, new RegExp(`id="${id}"[^>]*onchange="refreshPromoCharts\\(\\)"`));
  }
  assert.match(dashboard, /const CHART_METRIC_OPTIONS = \[[^\]]*'lp2pur'/);
  assert.match(dashboard, /computeChartMetric\(metricKey,r,calcMetrics\(r\)\)/);
  assert.match(dashboard, /computeChartMetric\(pieMetricKey,row,calcMetrics\(row\)\)/);
  for (const titleId of ['promo-chart-title-spend', 'promo-chart-title-roas', 'promo-chart-title-pie']) {
    assert.match(dashboard, new RegExp(`id="${titleId}"`));
  }
  assert.equal((dashboard.match(/class="sr-only promo-chart-data-table"/g) || []).length, 3);
  assert.match(dashboard, /table\.querySelector\('caption'\)\.textContent=`\$\{metric\.label\} by Promo campaign group and day`/);
  assert.match(dashboard, /pieTable\.querySelector\('thead th:nth-child\(2\)'\)\.textContent=pieMetric\.label/);
  for (const surface of [
    /<div class="kpi-label">LP → Purchase<\/div>/,
    /\{key:'lp2pur',label:'LP→Purchase'\}/,
    /\{label:'LP→Purchase',text:r=>fmtPct\(r\.m\.lp2pur\)\}/,
    /'LP→Purchase'/,
  ]) assert.match(dashboard, surface);
});

test('shared Meta API exposes lead actions to the canonical dashboard', () => {
  for (const file of ['api/glv-meta-ads/fb-data.js', 'api/glv-meta-ads/cron.js']) {
    const api = read(file);
    assert.match(api, /'actions:lead'/);
    assert.match(api, /'actions:landing_page_view'/);
    assert.match(api, /onsite_conversion\.lead_grouped/);
    assert.match(api, /offsite_conversion\.fb_pixel_lead/);
  }
  const v2 = read('public/glv-meta-ads/index.html');
  assert.match(v2, /lp:parseNum\(r\['actions:landing_page_view'\]\)/);
  assert.match(v2, /getPromoSegmentRows/);
});

test('CZSK Triage defines seven independent presets and one unique color per selectable metric', () => {
  const dashboard = read('public/glv-meta-ads/index.html');
  assert.match(dashboard, /id="panel-czsk-triage"/);
  assert.match(dashboard, /id="triage-grid"/);
  assert.doesNotMatch(dashboard, /class="section triage-intro"/);
  assert.doesNotMatch(dashboard, /Seven daily presets for fast funnel diagnosis/);
  assert.match(dashboard, /const METRIC_REGISTRY = \[/);
  assert.match(dashboard, /const TRIAGE_PRESETS = \[/);

  const registry = dashboard.match(/const METRIC_REGISTRY = \[([\s\S]*?)\n\];/);
  assert.ok(registry, 'missing selectable metric registry');
  const keys = [...registry[1].matchAll(/key:'([^']+)'/g)].map(match => match[1]);
  const colors = [...registry[1].matchAll(/color:'(#[0-9A-Fa-f]{6})'/g)].map(match => match[1].toLowerCase());
  assert.equal(keys.length, 18, 'all dashboard and triage metrics must be registered');
  assert.equal(new Set(keys).size, keys.length, 'metric keys must be unique');
  assert.equal(colors.length, keys.length, 'every metric needs an explicit color');
  assert.equal(new Set(colors).size, colors.length, 'different metrics must never share a color');

  const presets = dashboard.match(/const TRIAGE_PRESETS = \[([\s\S]*?)\n\];/);
  assert.ok(presets, 'missing triage presets');
  const presetIds = [...presets[1].matchAll(/id:'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(presetIds, ['efficiency', 'lp-checkout', 'checkout-purchase', 'lp-purchase', 'value-aov', 'delivery-response', 'cost-frequency']);
  for (const contract of [
    /primary:'spend'.*secondary:'roas'/,
    /primary:'lp'.*secondary:'lp2co'/,
    /primary:'checkouts'.*secondary:'co2pur'/,
    /primary:'purchases'.*secondary:'lp2pur'/,
    /primary:'revenue'.*secondary:'aov'/,
    /primary:'impressions'.*secondary:'ctr'/,
    /primary:'cpm'.*secondary:'frequency'.*primaryType:'line'.*secondaryType:'line'/,
  ]) assert.match(presets[1], contract);
  assert.match(dashboard, /function initTriageCards\(/);
  assert.match(dashboard, /function refreshTriageChart\(/);
  assert.match(dashboard, /charts\[chartKey\]\.destroy\(\)/);
  assert.match(dashboard, /class="sr-only triage-data-table"/);
  assert.match(dashboard, /label:'Frequency proxy'/);
  assert.doesNotMatch(dashboard, /label:'Frequency'/);
  assert.match(dashboard, /key:'ctr',label:'CTR'/);
  assert.doesNotMatch(dashboard, /Outbound CTR|outboundCtr/);
  assert.match(dashboard, /function getTriageSegmentRows\(source='daily'\)/);
  assert.match(dashboard, /getMainSegmentRows\('czsk',source\)/);
  assert.match(dashboard, /id="triage-filter-section"[\s\S]*id="filter-wrap-triage-campaign"[\s\S]*id="filter-wrap-triage-group"[\s\S]*id="triage-grid"/);
  assert.match(dashboard, /id="triage-filter-label-campaign"[^>]*>Campaign name<\/span>/);
  assert.match(dashboard, /id="filter-toggle-triage-campaign"[^>]*aria-labelledby="triage-filter-label-campaign filter-label-triage-campaign"/);
  assert.match(dashboard, /id="triage-filter-label-group"[^>]*>Campaign group<\/span>/);
  assert.match(dashboard, /id="filter-toggle-triage-group"[^>]*aria-labelledby="triage-filter-label-group filter-label-triage-group"/);
  assert.match(dashboard, /'triage-campaign': null, 'triage-group': null/);
  assert.match(dashboard, /filterState\['triage-campaign'\]/);
  assert.match(dashboard, /filterState\['triage-group'\]/);
  assert.match(dashboard, /campaignSelection\.has\(r\.id\)/);
  assert.match(dashboard, /groupSelection\.has\(r\.group\|\|promoGroupKey\(r\.name\)\)/);
  assert.match(dashboard, /key==='triage-campaign'\|\|key==='triage-group'\)refreshTriageCharts\(\)/);
  assert.match(dashboard, /byPeriod\(getTriageSegmentRows\('daily'\),null,state\.grain\)/);
  assert.match(dashboard, /activeTab!==['"]czsk['"]&&activeTab!==['"]czsk-triage['"]/);
  assert.match(dashboard, /renderKPIs\('czsk'\);refreshChart\('czsk'\);renderDailyTable\('czsk'\);renderCreatives\('czsk'\);refreshTriageCharts\(\)/);
  const loadDataBody = dashboard.slice(dashboard.indexOf('async function loadData(){'), dashboard.indexOf("document.querySelectorAll('.tab-btn')"));
  assert.ok(loadDataBody.indexOf('buildTriageFilters();') < loadDataBody.indexOf('refreshTriageCharts();'), 'Triage selections must reconcile before charts refresh after data reload');
  assert.match(dashboard, /class="triage-primary-header"/);
  assert.match(dashboard, /class="triage-secondary-header"/);
  assert.match(dashboard, /tableCaption\.textContent/);
  assert.match(dashboard, /<h3 class="triage-preset" id="triage-preset-\$\{preset\.id\}" aria-live="polite"><\/h3>/);
  assert.doesNotMatch(dashboard, /<div class="chart-card-title">\$\{preset\.title\}<\/div>/);
  assert.match(dashboard, /role="tablist"/);
  assert.match(dashboard, /aria-selected="true"/);
  assert.match(dashboard, /setAttribute\('aria-selected'/);
});

test('Meta live and cached producers expose reach for the triage frequency metric', () => {
  for (const file of ['api/glv-meta-ads/fb-data.js', 'api/glv-meta-ads/cron.js']) {
    const api = read(file);
    assert.match(api, /spend,impressions,reach,actions,action_values/);
    assert.match(api, /reach:\s+row\.reach \|\| '0'/);
    const producer = require(path.join(root, file));
    assert.equal(producer._test.normalizeCampaign({ reach: '450' }).reach, '450');
  }
  const dashboard = read('public/glv-meta-ads/index.html');
  assert.match(dashboard, /reach:parseNum\(r\.reach\)/);
  assert.match(dashboard, /const frequency=a\.reach>0\?a\.impressions\/a\.reach:0/);
  assert.match(dashboard, /linkClicks:parseNum\(r\['actions:link_click'\]\)/);
  assert.match(dashboard, /const ctr=a\.impressions>0\?a\.linkClicks\/a\.impressions\*100:0/);
  assert.doesNotMatch(dashboard, /const ctr=a\.impressions>0\?a\.lp\/a\.impressions\*100:0/);
});

test('Meta cache rejects legacy aggregate and daily rows without reach', () => {
  const api = require('../api/glv-meta-ads/fb-data.js');
  assert.equal(api._test.cachedPayloadUsable('daily', { rows: [{ impressions: '100' }] }), false);
  assert.equal(api._test.cachedPayloadUsable('aggregate', { rows: [{ impressions: '100', reach: '60' }] }), true);
  assert.equal(api._test.cachedPayloadUsable('daily', { rows: [{ reach: 0 }] }), true);
  assert.equal(api._test.cachedPayloadUsable('daily', { rows: [{ reach: '0' }] }), true);
  assert.equal(api._test.cachedPayloadUsable('daily', { rows: [{ impressions: '100', reach: 'not-a-number' }] }), false);
  for (const reach of ['', '   ', null, false, []]) {
    assert.equal(api._test.cachedPayloadUsable('daily', { rows: [{ reach }] }), false, `reach ${JSON.stringify(reach)} must be rejected`);
  }
  assert.equal(api._test.cachedPayloadUsable('ads', { rows: [{ impressions: '100' }] }), true);
});

test('Meta Redis configuration selects one complete credential family atomically', () => {
  for (const file of ['../api/glv-meta-ads/fb-data.js', '../api/glv-meta-ads/cron.js']) {
    const api = require(file);
    assert.deepEqual(api._test.resolveRedisConfig({ KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 'kv-token' }), { url: 'https://kv.example', token: 'kv-token' });
    assert.deepEqual(api._test.resolveRedisConfig({ UPSTASH_REDIS_REST_URL: 'https://upstash.example', UPSTASH_REDIS_REST_TOKEN: 'upstash-token' }), { url: 'https://upstash.example', token: 'upstash-token' });
    assert.equal(api._test.resolveRedisConfig({ KV_REST_API_URL: 'https://kv.example', UPSTASH_REDIS_REST_TOKEN: 'mixed-token' }), null);
    assert.equal(api._test.resolveRedisConfig({ KV_REST_API_URL: 'https://kv.example', UPSTASH_REDIS_REST_URL: 'https://upstash.example', UPSTASH_REDIS_REST_TOKEN: 'upstash-token' }), null);
  }
});

test('Meta API handler rejects partial mixed-family Redis configuration', async () => {
  const api = require('../api/glv-meta-ads/fb-data.js');
  const envNames = ['GLV_META_FB_ACCESS_TOKEN', 'FB_ACCESS_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
  const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const originalFetch = global.fetch;
  for (const name of envNames) delete process.env[name];
  Object.assign(process.env, {
    FB_ACCESS_TOKEN: 'test-meta-token',
    KV_REST_API_URL: 'https://kv.example',
    UPSTASH_REDIS_REST_TOKEN: 'mixed-token',
  });
  try {
    global.fetch = async () => { throw new Error('handler must reject before network access'); };
    const response = {
      statusCode: 200,
      body: null,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return body; },
    };
    await api({ method: 'GET', query: { type: 'daily', date_preset: 'last_30d' } }, response);
    assert.equal(response.statusCode, 500);
    assert.match(response.body.error, /not configured/);
  } finally {
    global.fetch = originalFetch;
    for (const name of envNames) {
      if (originalEnv[name] === undefined) delete process.env[name]; else process.env[name] = originalEnv[name];
    }
  }
});

test('Meta date presets are semantic keyboard controls with disclosed popover state', () => {
  const dashboard = read('public/glv-meta-ads/index.html');
  assert.match(dashboard, /id="date-btn"[^>]*aria-expanded="false"[^>]*aria-controls="date-menu"/);
  assert.equal((dashboard.match(/<button type="button" class="date-preset-item/g) || []).length, 6);
  assert.doesNotMatch(dashboard, /<div class="date-preset-item"/);
  assert.match(dashboard, /function setDateMenuOpen\(/);
  assert.match(dashboard, /function handleDateMenuKeydown\(/);
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

test('Meta cron returns HTTP 500 when runtime configuration is missing', async () => {
  const cron = require('../api/glv-meta-ads/cron.js');
  const envNames = ['CRON_SECRET', 'GLV_META_FB_ACCESS_TOKEN', 'FB_ACCESS_TOKEN', 'KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'];
  const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  for (const name of envNames) delete process.env[name];
  try {
    const response = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return body; },
    };
    await cron({ headers: {}, query: {} }, response);
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.ok, false);
  } finally {
    for (const name of envNames) {
      if (originalEnv[name] === undefined) delete process.env[name]; else process.env[name] = originalEnv[name];
    }
  }
});

test('the canonical Meta dashboard provides accessible light and dark theme UX', () => {
  const v2 = read('public/glv-meta-ads/index.html');
  assert.match(v2, /rel="icon" type="image\/svg\+xml" href="\/glv-meta-ads\/agenthic-logo\.svg"/);
  const icon = fs.readFileSync(path.join(root, 'public/glv-meta-ads/agenthic-logo.svg'));
  assert.equal(crypto.createHash('sha256').update(icon).digest('hex'), APPROVED_ICON_HASH);
  assert.match(v2, /data-theme="dark"/);
  assert.match(v2, /data-theme="light"/);
  assert.match(v2, /id="theme-toggle"/);
  assert.match(v2, /aria-label="Switch to light theme"/);
  assert.match(v2, /prefers-reduced-motion/);
  assert.match(v2, /class="skip-link"/);
  assert.match(v2, /<main/);
});

test('one existing Meta Ads cron feeds the canonical dashboard without a duplicate schedule', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const cronPaths = vercel.crons.map(({ path: cronPath }) => cronPath);
  assert.deepEqual(cronPaths.filter(cronPath => cronPath.includes('glv-meta-ads')), ['/api/glv-meta-ads/cron']);

  const middleware = read('middleware.js');
  assert.match(middleware, /const LEGACY_META_PATH = '\/glv-meta-ads-2'/);
  assert.match(middleware, /Response\.redirect\(canonicalUrl, 308\)/);
  assert.match(middleware, /'\/glv-meta-ads-2\/:path\*'/);
  assert.match(middleware, /const DATA_PATH = '\/api\/glv-meta-ads\/fb-data'/);

  const releaseGuard = read('scripts/verify-glv-release.cjs');
  assert.match(releaseGuard, /approved Meta Ads Pulse/, 'the production build guard must enforce the promoted dashboard');
  assert.match(releaseGuard, /legacy Meta Ads V2 public directory still exists/, 'the production build guard must enforce old-route cleanup');
  assert.match(releaseGuard, /\/api\/glv-meta-ads\/cron/, 'the production build guard must enforce the shared cron');
});
