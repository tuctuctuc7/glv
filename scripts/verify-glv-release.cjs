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

const metaPath = routePath('glv-meta-ads', 'index.html');
const metaHtml = fs.readFileSync(metaPath, 'utf8');
if (!metaHtml.includes('<title>GLV Meta Ads Pulse</title>') || !metaHtml.includes('/api/glv-meta-ads/fb-data')) {
  fail('canonical route no longer contains the approved Meta Ads Pulse dashboard');
}
if (metaHtml.includes('/glv-meta-ads-2/')) {
  fail('canonical Meta dashboard still references the retired V2 route');
}
if (fs.existsSync(path.join(root, 'public', 'glv-meta-ads-2'))) {
  fail('legacy Meta Ads V2 public directory still exists');
}
const metaIconPath = routePath('glv-meta-ads', 'agenthic-logo.svg');
if (!metaHtml.includes('/glv-meta-ads/agenthic-logo.svg') || !fs.existsSync(metaIconPath) || sha256(fs.readFileSync(metaIconPath)) !== approvedIconHash) {
  fail('canonical Meta Ads dashboard is missing its approved route-local icon');
}
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const approvedKursaRewrites = [
  { source: '/krs-meta-ads/', destination: 'https://kursa-cyan.vercel.app/krs-meta-ads/' },
  { source: '/krs-meta-ads/login/', destination: 'https://kursa-cyan.vercel.app/krs-meta-ads/login/' },
  { source: '/krs-meta-ads/:path*', destination: 'https://kursa-cyan.vercel.app/krs-meta-ads/:path*' },
  { source: '/api/krs-meta-ads/:path*', destination: 'https://kursa-cyan.vercel.app/api/krs-meta-ads/:path*' },
];
if (JSON.stringify(config.rewrites || []) !== JSON.stringify(approvedKursaRewrites)) {
  fail('KURSA Meta Ads ingress must route to the canonical tm-kursa runtime');
}
const allowedKursaFiles = new Set([
  'README.md',
  'scripts/verify-glv-release.cjs',
  'tests/kursa-route.test.cjs',
  'vercel.json',
]);
const ignoredDirectories = new Set(['.agent-worktrees', '.git', '.vercel', 'node_modules']);
const textExtensions = new Set(['.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.svg', '.ts', '.tsx']);
const projectFiles = [];
const collectFiles = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(absolute);
    else if (entry.isFile()) projectFiles.push(absolute);
  }
};
collectFiles(root);
const unexpectedKursaFiles = projectFiles.filter((file) => {
  const relative = path.relative(root, file).split(path.sep).join('/');
  if (allowedKursaFiles.has(relative)) return false;
  const basename = path.basename(relative);
  if (basename === '.env' || (basename.startsWith('.env.') && basename !== '.env.example')) return true;
  if (/kursa|krs[-_]?meta/i.test(relative)) return true;
  if (!textExtensions.has(path.extname(relative)) && !relative.endsWith('.env.example')) return false;
  return /K(?:URSA|RS)_META_|kursa-cyan\.vercel\.app|\/krs-meta-ads|KURSA Meta Ads/i.test(fs.readFileSync(file, 'utf8'));
});
if (unexpectedKursaFiles.length > 0) {
  fail('KURSA implementation must remain exclusively in tucmedia-hq/tm-kursa');
}
if ((config.crons || []).some(({ path: cronPath }) => /krs-meta-ads|kursa/i.test(cronPath))) {
  fail('Agenthic Labs must not own a KURSA cron');
}
const metaCronPaths = (config.crons || []).map(({ path: cronPath }) => cronPath).filter(cronPath => cronPath.includes('glv-meta-ads'));
if (metaCronPaths.length !== 1 || metaCronPaths[0] !== '/api/glv-meta-ads/cron') {
  fail('the canonical GLV Meta Ads dashboard must retain one cache-refresh cron');
}

console.log(JSON.stringify({
  passed: true,
  coverageEnd,
  expectedAtLeast: yesterdayUtc,
  snapshotsByteIdentical: true,
  routes: { v1: 'GLV Dashboard', v2: 'GLV Executive Pulse', meta: 'GLV Meta Ads Pulse' },
}));
