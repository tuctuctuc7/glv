const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const allowedKursaFiles = new Set(['README.md', 'scripts/verify-glv-release.cjs', 'tests/kursa-route.test.cjs', 'vercel.json']);
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

test('Agenthic Labs owns only the KURSA ingress while tm-kursa remains canonical source', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const approvedRewrites = [
    { source: '/krs-meta-ads/:path*', destination: 'https://kursa-cyan.vercel.app/krs-meta-ads/:path*' },
    { source: '/api/krs-meta-ads/:path*', destination: 'https://kursa-cyan.vercel.app/api/krs-meta-ads/:path*' },
  ];

  assert.deepEqual(config.rewrites, approvedRewrites);
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
