const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const allowedKursaFiles = new Set([
  'README.md',
  'api/krs-meta-ads/cron.js',
  'api/krs-meta-ads/fb-data.js',

  'api/krs-meta-ads/frozen-data.js',
  'middleware.js',
  'public/krs-meta-ads/index.html',
  'public/krs-meta-ads/kursa-logo.svg',
  'scripts/verify-glv-release.cjs',
  'tests/krs-freeze.test.cjs',
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

test('Agenthic Labs freezes KURSA data while preserving the existing upstream UI and login', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const approvedRewrites = [
    { source: '/krs-meta-ads/', destination: 'https://kursa-cyan.vercel.app/krs-meta-ads/' },
    { source: '/krs-meta-ads/login/', destination: 'https://kursa-cyan.vercel.app/krs-meta-ads/login/' },
    { source: '/krs-meta-ads/:path*', destination: 'https://kursa-cyan.vercel.app/krs-meta-ads/:path*' },
    { source: '/api/krs-meta-ads/auth', destination: 'https://kursa-cyan.vercel.app/api/krs-meta-ads/auth' },
  ];

  assert.deepEqual(config.rewrites, approvedRewrites);
  const html = fs.readFileSync(path.join(root, 'public', 'krs-meta-ads', 'index.html'), 'utf8');
  assert.match(html, /frozenThrough\?shiftDate\(frozenThrough,1\)/);
  assert.match(html, /frozenThrough='2026-09-24'/);
  assert.match(html, /frozenSince='2026-06-27'/);
  assert.match(html, /meta\.frozen_through/);
  assert.match(html, /Prague · Frozen/);
  const middleware = fs.readFileSync(path.join(root, 'middleware.js'), 'utf8');
  assert.match(middleware, /'\/krs-meta-ads\/:path\*'/);
  assert.match(middleware, /hasKrsAccess/);
  assert.match(middleware, /\/index\.html/);
  assert.match(middleware, /fb-data\/:path\*/);
  const unexpectedKursaFiles = projectFiles.filter((file) => {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (allowedKursaFiles.has(relative)) return false;
    const basename = path.basename(relative);
    if (basename === '.env' || (basename.startsWith('.env.') && basename !== '.env.example')) return true;
    if (/kursa|krs[-_]?meta/i.test(relative)) return true;
    if (!textExtensions.has(path.extname(relative)) && !relative.endsWith('.env.example')) return false;
    return /K(?:URSA|RS)_META_|kursa-cyan\.vercel\.app|\/krs-meta-ads|KURSA Meta Ads/i.test(fs.readFileSync(file, 'utf8'));
  });
  assert.deepEqual(unexpectedKursaFiles, []);
  assert.equal((config.crons || []).some(({ path: cronPath }) => /krs-meta-ads|kursa/i.test(cronPath)), false);
});
