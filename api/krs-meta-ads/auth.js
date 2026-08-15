const crypto = require('node:crypto');

const AUTH_COOKIE = 'krs_meta_beta';

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const expectedPassword = process.env.KRS_META_BETA_PASSWORD || process.env.GLV_META_BETA_PASSWORD;
  const authToken = process.env.KRS_META_BETA_AUTH_TOKEN || process.env.GLV_META_BETA_AUTH_TOKEN;
  if (!expectedPassword || !authToken) return res.status(500).json({ error: 'Beta access is not configured.' });
  try {
    const body = await parseBody(req);
    if (!safeEqual(body.password, expectedPassword)) return res.status(401).json({ error: 'Wrong password' });
    res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(authToken)}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`);
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(400).json({ error: 'Invalid request' });
  }
};
