const crypto = require('crypto');

const AUTH_COOKIE = 'glv_meta_beta';

function safeEqual(a, b) {
  const left = Buffer.from(a || '');
  const right = Buffer.from(b || '');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10_000) {
        reject(new Error('Request body is too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const expectedPassword = process.env.GLV_META_BETA_PASSWORD;
  const authToken = process.env.GLV_META_BETA_AUTH_TOKEN;
  if (!expectedPassword || !authToken) {
    res.status(500).json({ error: 'Beta access is not configured.' });
    return;
  }

  try {
    const body = await parseBody(req);
    if (!safeEqual(body.password, expectedPassword)) {
      res.status(401).json({ error: 'Wrong password' });
      return;
    }

    res.setHeader(
      'Set-Cookie',
      `${AUTH_COOKIE}=${encodeURIComponent(authToken)}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: 'Invalid request' });
  }
};
