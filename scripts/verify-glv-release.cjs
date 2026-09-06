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

const canonicalBytes = fs.readFileSync(routePath('glv', 'glv_dashboard.json'));
if (fs.existsSync(path.join(root, 'public', 'glv-2'))) {
  fail('retired GLV overlap directory must not ship');
}
for (const file of ['export_glv_dashboard.py', 'deploy_glv_dashboard.sh']) {
  if (fs.readFileSync(path.join(root, file), 'utf8').includes('glv-2')) fail(`${file} still publishes the retired route`);
}
const middlewareSource = fs.readFileSync(path.join(root, 'middleware.js'), 'utf8');
if (!middlewareSource.includes("const LEGACY_BI_PATH = '/glv-2';")
    || !middlewareSource.includes("'/glv-2/:path*'")) fail('retired GLV route must retain its permanent redirect');

const payload = JSON.parse(canonicalBytes.toString('utf8'));
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

const canonicalHtml = fs.readFileSync(routePath('glv', 'index.html'), 'utf8');
if (!canonicalHtml.includes('<title>GLV Executive Pulse</title>') || !canonicalHtml.includes('Audit trail')) {
  fail('canonical GLV no longer has the approved Executive Pulse identity');
}
for (const file of ['app.js', 'metrics.js', 'styles.css']) {
  if (!canonicalHtml.includes(`/glv/${file}?v=canonical-20260906`)) fail(`unversioned canonical asset: ${file}`);
}
for (const file of ['index.html', 'app.js', 'metrics.js', 'styles.css']) {
  if (fs.readFileSync(routePath('glv', file), 'utf8').includes('/glv-2/')) fail(`stale overlap URL in ${file}`);
}
for (const url of canonicalHtml.matchAll(/(?:src|href)="(\/glv\/[^"?]+)(?:\?[^" ]*)?"/g)) {
  if (!fs.existsSync(path.join(root, 'public', url[1]))) fail(`missing runtime asset ${url[1]}`);
}
for (const file of ['glv_2025_monthly.json', 'fonts/inter-400.woff2', 'fonts/inter-500.woff2', 'fonts/inter-600.woff2', 'fonts/inter-700.woff2', 'fonts/INTER-LICENSE.txt']) {
  if (!fs.existsSync(routePath('glv', file))) fail(`missing runtime asset ${file}`);
}

const approvedIconHash = '4ee12623258531a1210f18833815132cdbf2be8624d1a43f72f9685b527d8685';
for (const route of ['glv']) {
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
if (!(config.headers || []).some(entry => entry.source === '/glv/:path*'
    && entry.headers.some(header => header.key === 'Cache-Control' && header.value === 'no-store'))) {
  fail('canonical GLV assets must not reuse stale V1 responses');
}
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
  canonicalSnapshotSha256: sha256(canonicalBytes),
  routes: { glv: 'GLV Executive Pulse', meta: 'GLV Meta Ads Pulse' },
}));
