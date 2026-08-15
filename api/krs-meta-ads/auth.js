const crypto = require('node:crypto');
const shared = require('./_shared.js');

const AUTH_COOKIE = 'krs_meta_beta';
const WINDOW_SECONDS = 600;
const MAX_ATTEMPTS = 10;

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(leftValue || '');
  const right = Buffer.from(rightValue || '');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10_000) reject(new Error('Request body is too large'));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function rateLimitKey(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const digest = crypto.createHash('sha256').update(forwarded).digest('hex').slice(0, 24);
  return `${shared.CACHE_PREFIX}:auth:${digest}`;
}

async function checkRateLimit(req) {
  const key = rateLimitKey(req);
  try {
    const count = Number(await shared.redisCommand(['INCR', key]));
    if (count === 1) await shared.redisCommand(['EXPIRE', key, String(WINDOW_SECONDS)]);
    return { allowed: count <= MAX_ATTEMPTS, key };
  } catch (error) {
    console.error('krs-meta-ads auth rate-limit failure:', error.message);
    return { allowed: false, key };
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const expectedPassword = process.env.KRS_META_BETA_PASSWORD || process.env.GLV_META_BETA_PASSWORD;
  const authToken = process.env.KRS_META_BETA_AUTH_TOKEN || process.env.GLV_META_BETA_AUTH_TOKEN;
  if (!expectedPassword || !authToken) return res.status(500).json({ error: 'Beta access is not configured.' });
  try {
    const rateLimit = await checkRateLimit(req);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(WINDOW_SECONDS));
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    const body = await parseBody(req);
    if (!safeEqual(body.password, expectedPassword)) return res.status(401).json({ error: 'Wrong password' });
    await shared.redisCommand(['DEL', rateLimit.key]);
    res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(authToken)}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`);
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(400).json({ error: 'Invalid request' });
  }
};

module.exports._test = { checkRateLimit, rateLimitKey };
