#!/usr/bin/env node

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const root = path.join(__dirname, '..');
const routePath = (route, file) => path.join(root, 'public', route, file);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (message) => {
  console.error(`GLV release guard failed: ${message}`);
  process.exit(1);
};

const v1Bytes = fs.readFileSync(routePath('glv', 'glv_dashboard.json'));
const v2Bytes = fs.readFileSync(routePath('glv-2', 'glv_dashboard.json'));
if (!v1Bytes.equals(v2Bytes)) {
  fail('V1 and V2 dashboard snapshots are not byte-identical. Run npm run export:glv before deploying.');
}

const payload = JSON.parse(v1Bytes.toString('utf8'));
const coverageEnd = payload.date_range?.end;
const coverageDate = new Date(`${coverageEnd}T00:00:00.000Z`);
if (
  !/^\d{4}-\d{2}-\d{2}$/.test(coverageEnd || '')
  || !Number.isFinite(coverageDate.getTime())
  || coverageDate.toISOString().slice(0, 10) !== coverageEnd
) {
  fail('dashboard snapshot has no valid date_range.end');
}

const now = new Date();
const yesterdayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
  .toISOString()
  .slice(0, 10);
if (coverageEnd < yesterdayUtc) {
  fail(`dashboard coverage ends ${coverageEnd}; expected at least ${yesterdayUtc}`);
}

const v1Html = fs.readFileSync(routePath('glv', 'index.html'), 'utf8');
const v2Html = fs.readFileSync(routePath('glv-2', 'index.html'), 'utf8');
if (!v1Html.includes('<title>GLV Dashboard</title>') || v1Html.includes('GLV Executive Pulse')) {
  fail('V1 no longer has the legacy GLV Dashboard identity');
}
if (!v2Html.includes('<title>GLV Executive Pulse</title>') || !v2Html.includes('Audit trail')) {
  fail('V2 no longer has the approved Executive Pulse identity');
}

const approvedIconHash = '4ee12623258531a1210f18833815132cdbf2be8624d1a43f72f9685b527d8685';
for (const route of ['glv', 'glv-2']) {
  const html = fs.readFileSync(routePath(route, 'index.html'), 'utf8');
  const favicon = `/${route}/agenthic-logo.svg`;
  if (!html.includes(`rel="icon" type="image/svg+xml" href="${favicon}"`)) {
    fail(`${route} does not reference its approved AGENTHIC favicon`);
  }
  const iconPath = routePath(route, 'agenthic-logo.svg');
  if (!fs.existsSync(iconPath)) {
    fail(`${route} is missing agenthic-logo.svg`);
  }
  const iconHash = sha256(fs.readFileSync(iconPath));
  if (iconHash !== approvedIconHash) {
    fail(`${route} agenthic-logo.svg does not match the approved icon`);
  }
}

const metaV1Path = routePath('glv-meta-ads', 'index.html');
const metaV2Path = routePath('glv-meta-ads-2', 'index.html');
const metaV1Hash = '422aa897010d80a8c8d4f40302c3a4c6a6bd85d982186c9d63560171dbfcbd7a';
if (sha256(fs.readFileSync(metaV1Path)) !== metaV1Hash) {
  fail('GLV Meta Ads V1 changed while the parallel V2 route is under review');
}
const metaV2Html = fs.readFileSync(metaV2Path, 'utf8');
if (!metaV2Html.includes('<title>GLV Meta Ads Pulse</title>') || !metaV2Html.includes('/api/glv-meta-ads/fb-data')) {
  fail('GLV Meta Ads V2 route or shared data source is missing');
}
const metaV2IconPath = routePath('glv-meta-ads-2', 'agenthic-logo.svg');
if (!metaV2Html.includes('/glv-meta-ads-2/agenthic-logo.svg') || !fs.existsSync(metaV2IconPath) || sha256(fs.readFileSync(metaV2IconPath)) !== approvedIconHash) {
  fail('GLV Meta Ads V2 is missing its approved route-local icon');
}
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const metaCronPaths = (config.crons || []).map(({ path: cronPath }) => cronPath).filter(cronPath => cronPath.includes('glv-meta-ads'));
if (metaCronPaths.length !== 1 || metaCronPaths[0] !== '/api/glv-meta-ads/cron') {
  fail('GLV Meta Ads V1 and V2 must share the one existing cron');
}

console.log(JSON.stringify({
  passed: true,
  coverageEnd,
  expectedAtLeast: yesterdayUtc,
  snapshotsByteIdentical: true,
  routes: { v1: 'GLV Dashboard', v2: 'GLV Executive Pulse', metaV1: 'GLV Meta Ads', metaV2: 'GLV Meta Ads Pulse' },
}));
