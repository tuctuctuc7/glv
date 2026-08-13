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
  'date-btn', 'date-from', 'date-to', 'promo-active-days-only',
  'kpi-czsk', 'chart-grain-czsk', 'chart-left-czsk', 'chart-right-czsk', 'chart-czsk',
  'daily-table-czsk', 'creative-type-czsk', 'creative-sort-czsk', 'creative-czsk',
  'kpi-czsk-promo', 'chart-promo-spend', 'chart-promo-roas', 'chart-promo-pie', 'promo-table',
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

test('Meta Ads V2 preserves the V1 feature surface and shared API', () => {
  const v2 = read('public/glv-meta-ads-2/index.html');
  for (const tab of ['czsk', 'czsk-promo', 'us']) assert.match(v2, new RegExp(`data-tab="${tab}"`));
  for (const id of requiredIds) assert.match(v2, new RegExp(`id="${id}"`), `missing V1 control #${id}`);
  assert.match(v2, /\/api\/glv-meta-ads\/fb-data/);
  assert.match(v2, /last_7d/);
  assert.match(v2, /last_14d/);
  assert.match(v2, /last_30d/);
  assert.match(v2, /last_90d/);
  assert.match(v2, /this_month/);
  assert.match(v2, /last_month/);
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
