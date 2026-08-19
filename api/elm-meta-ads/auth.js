const crypto = require('crypto');

const AUTH_COOKIE = 'elm_audit_session';
const SESSION_TTL_SECONDS = 604800;
const RATE_LIMIT_WINDOW_SECONDS = 900;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

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
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function resolveRedisConfig(env = process.env) {
  const families = [
    [env.KV_REST_API_URL, env.KV_REST_API_TOKEN],
    [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN],
  ].filter(([url, token]) => Boolean(url || token));
  if (families.length !== 1) return null;
  const [url, token] = families[0];
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

function clientAddress(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const direct = String(req.headers?.['x-real-ip'] || '').trim();
  return (forwarded || direct || 'unknown').slice(0, 128);
}

function rateLimitKey(req, secret, nowSeconds) {
  const window = Math.floor(nowSeconds / RATE_LIMIT_WINDOW_SECONDS);
  const digest = crypto.createHmac('sha256', secret).update(clientAddress(req)).digest('hex').slice(0, 32);
  return `elm:auth:ratelimit:${window}:${digest}`;
}

async function checkRateLimit(req, redis, secret, nowSeconds) {
  const key = rateLimitKey(req, secret, nowSeconds);
  const response = await fetch(`${redis.url}/multi-exec`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redis.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, RATE_LIMIT_WINDOW_SECONDS],
    ]),
  });
  if (!response.ok) throw new Error('Rate limiter unavailable');
  const result = await response.json();
  const attempts = result?.[0]?.result;
  const expiryApplied = result?.[1]?.result;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || expiryApplied !== 1) {
    throw new Error('Invalid rate limiter response');
  }
  return { allowed: attempts <= RATE_LIMIT_MAX_ATTEMPTS, key };
}

async function clearRateLimit(redis, key) {
  const response = await fetch(`${redis.url}/multi-exec`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redis.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([['DEL', key]]),
  });
  if (!response.ok) throw new Error('Rate limiter unavailable');
  const result = await response.json();
  if (result?.[0]?.result !== 1) throw new Error('Rate-limit counter was not cleared');
}

function issueSession(secret, nowSeconds) {
  const expiresAt = nowSeconds + SESSION_TTL_SECONDS;
  const nonce = crypto.randomBytes(24).toString('base64url');
  const payload = `${expiresAt}.${nonce}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

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

  let body;
  try {
    body = await parseBody(req);
  } catch (error) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.password !== 'string') {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const expectedPassword = process.env.ELM_AUDIT_PASSWORD;
  const sessionSecret = process.env.ELM_AUDIT_SESSION_SECRET;
  const redis = resolveRedisConfig();
  if (!expectedPassword || !sessionSecret || sessionSecret.length < 32 || !redis) {
    res.status(503).json({ error: 'Private access is temporarily unavailable.' });
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  let guard;
  try {
    guard = await checkRateLimit(req, redis, sessionSecret, nowSeconds);
  } catch (error) {
    res.status(503).json({ error: 'Private access is temporarily unavailable.' });
    return;
  }

  if (!guard.allowed) {
    res.setHeader('Retry-After', String(RATE_LIMIT_WINDOW_SECONDS));
    res.status(429).json({ error: 'Too many attempts. Try again later.' });
    return;
  }

  if (!safeEqual(body.password, expectedPassword)) {
    res.status(401).json({ error: 'Wrong password' });
    return;
  }

  try {
    await clearRateLimit(redis, guard.key);
  } catch (error) {
    res.status(503).json({ error: 'Private access is temporarily unavailable.' });
    return;
  }

  const session = issueSession(sessionSecret, nowSeconds);
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE}=${session}; Path=/elm-meta-ads; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`
  );
  res.status(200).json({ ok: true });
};

module.exports._test = {
  resolveRedisConfig,
  rateLimitKey,
  issueSession,
};
