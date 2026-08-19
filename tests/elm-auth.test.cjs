const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const SESSION_TTL_SECONDS = 604800;

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
    end() { return this; },
  };
}

function request(method, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)]);
  req.method = method;
  req.headers = headers;
  return req;
}

function signedSession(secret, expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, nonce = '0123456789abcdefghijklmnopqrstuv') {
  const payload = `${expiresAt}.${nonce}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function redisReply(count = 1) {
  return {
    ok: true,
    json: async () => [{ result: count }, { result: 1 }],
  };
}

test('ELM audit route has a dedicated signed and expiring password boundary', async () => {
  assert.equal(fs.existsSync(path.join(root, 'public/elm-meta-ads/login.html')), true);
  assert.equal(fs.existsSync(path.join(root, 'api/elm-meta-ads/auth.js')), true);

  const middleware = read('middleware.js');
  assert.match(middleware, /ELM_AUDIT_SESSION_SECRET/);
  assert.match(middleware, /elm_audit_session/);
  assert.match(middleware, /crypto\.subtle\.verify/);
  assert.match(middleware, /\/elm-meta-ads\/login/);
  assert.match(middleware, /\/api\/elm-meta-ads\/auth/);
  assert.match(middleware, /\/elm-meta-ads\/:path\*/);

  const { default: authorize } = await import(`data:text/javascript;base64,${Buffer.from(middleware).toString('base64')}`);
  const original = process.env.ELM_AUDIT_SESSION_SECRET;
  const secret = 'test-session-secret-with-sufficient-length';
  process.env.ELM_AUDIT_SESSION_SECRET = secret;
  try {
    const requestFor = (pathname, cookie = '') => ({
      url: `https://lab.agenthic.com${pathname}`,
      headers: new Headers(cookie ? { cookie } : {}),
    });
    for (const pathName of [
      '/elm-meta-ads', '/elm-meta-ads/', '/elm-meta-ads/index.html',
      '/elm-meta-ads/app.js', '/elm-meta-ads/styles.css',
      '/elm-meta-ads/metrics.mjs', '/elm-meta-ads/elm_meta_ads.json',
    ]) {
      const response = await authorize(requestFor(pathName));
      assert.equal(response.status, 302, `anonymous ${pathName} must redirect`);
      assert.match(response.headers.get('location'), /^https:\/\/lab\.agenthic\.com\/elm-meta-ads\/login\?next=/);
    }
    for (const publicPath of ['/elm-meta-ads/login', '/elm-meta-ads/login/', '/elm-meta-ads/login.html', '/api/elm-meta-ads/auth']) {
      assert.equal(await authorize(requestFor(publicPath)), undefined, `${publicPath} must remain public`);
    }

    const token = signedSession(secret);
    assert.equal(token.includes(secret), false);
    assert.equal(await authorize(requestFor('/elm-meta-ads/', `elm_audit_session=${token}`)), undefined);
    const signatureStart = token.lastIndexOf('.') + 1;
    const signatureCharacter = token[signatureStart];
    const replacement = signatureCharacter === 'x' ? 'y' : 'x';
    const tampered = `${token.slice(0, signatureStart)}${replacement}${token.slice(signatureStart + 1)}`;
    assert.notEqual(tampered, token);
    assert.equal((await authorize(requestFor('/elm-meta-ads/', `elm_audit_session=${tampered}`))).status, 302);
    const expired = signedSession(secret, Math.floor(Date.now() / 1000) - 1);
    assert.equal((await authorize(requestFor('/elm-meta-ads/', `elm_audit_session=${expired}`))).status, 302);
    const tooLong = signedSession(secret, Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS + 120);
    assert.equal((await authorize(requestFor('/elm-meta-ads/', `elm_audit_session=${tooLong}`))).status, 302);

    assert.equal(await authorize(requestFor('/unrelated/')), undefined);
    assert.equal((await authorize(requestFor('/glv-meta-ads/'))).status, 302);
  } finally {
    if (original === undefined) delete process.env.ELM_AUDIT_SESSION_SECRET;
    else process.env.ELM_AUDIT_SESSION_SECRET = original;
  }
});

test('ELM auth signs sessions, rate-limits guesses, and fails closed without its guard', async () => {
  const handler = require('../api/elm-meta-ads/auth.js');
  const names = ['ELM_AUDIT_PASSWORD', 'ELM_AUDIT_SESSION_SECRET', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];
  const originalEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = global.fetch;
  Object.assign(process.env, {
    ELM_AUDIT_PASSWORD: 'test-password',
    ELM_AUDIT_SESSION_SECRET: 'test-session-secret-with-sufficient-length',
    KV_REST_API_URL: 'https://redis.example',
    KV_REST_API_TOKEN: 'test-redis-token',
  });
  try {
    global.fetch = async () => redisReply(1);
    const wrong = responseRecorder();
    await handler(request('POST', { password: 'wrong' }, { 'x-forwarded-for': '203.0.113.10' }), wrong);
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.headers['set-cookie'], undefined);

    const right = responseRecorder();
    await handler(request('POST', { password: 'test-password' }, { 'x-forwarded-for': '203.0.113.10' }), right);
    assert.equal(right.statusCode, 200);
    assert.deepEqual(right.payload, { ok: true });
    assert.match(right.headers['set-cookie'], /^elm_audit_session=/);
    assert.doesNotMatch(right.headers['set-cookie'], /test-session-secret/);
    assert.match(right.headers['set-cookie'], /Path=\/elm-meta-ads/);
    assert.match(right.headers['set-cookie'], /Max-Age=604800/);
    assert.match(right.headers['set-cookie'], /HttpOnly/);
    assert.match(right.headers['set-cookie'], /Secure/);
    assert.match(right.headers['set-cookie'], /SameSite=Lax/);

    global.fetch = async () => redisReply(6);
    const limited = responseRecorder();
    await handler(request('POST', { password: 'wrong' }, { 'x-forwarded-for': '203.0.113.10' }), limited);
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.headers['retry-after'], '900');

    delete process.env.KV_REST_API_URL;
    const unavailable = responseRecorder();
    await handler(request('POST', { password: 'test-password' }), unavailable);
    assert.equal(unavailable.statusCode, 503);
  } finally {
    global.fetch = originalFetch;
    for (const name of names) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  }
});

test('ELM auth rejects malformed methods and bodies without issuing sessions', async () => {
  const handler = require('../api/elm-meta-ads/auth.js');
  const originalPassword = process.env.ELM_AUDIT_PASSWORD;
  const originalSecret = process.env.ELM_AUDIT_SESSION_SECRET;
  process.env.ELM_AUDIT_PASSWORD = 'test-password';
  process.env.ELM_AUDIT_SESSION_SECRET = 'test-session-secret-with-sufficient-length';
  try {
    const get = responseRecorder();
    await handler(request('GET'), get);
    assert.equal(get.statusCode, 405);
    const options = responseRecorder();
    await handler(request('OPTIONS'), options);
    assert.equal(options.statusCode, 204);
    const malformed = responseRecorder();
    await handler(request('POST', '{'), malformed);
    assert.equal(malformed.statusCode, 400);
    assert.equal(malformed.headers['set-cookie'], undefined);
    for (const password of [1, {}, [], null, { type: 'Buffer', data: [112, 119] }]) {
      const invalidType = responseRecorder();
      await handler(request('POST', { password }), invalidType);
      assert.equal(invalidType.statusCode, 400);
      assert.equal(invalidType.headers['set-cookie'], undefined);
    }
    for (const rawBody of ['null', '1', 'true', '[]', '"text"']) {
      const invalidTopLevel = responseRecorder();
      await handler(request('POST', rawBody), invalidTopLevel);
      assert.equal(invalidTopLevel.statusCode, 400);
      assert.equal(invalidTopLevel.headers['set-cookie'], undefined);
    }
  } finally {
    if (originalPassword === undefined) delete process.env.ELM_AUDIT_PASSWORD;
    else process.env.ELM_AUDIT_PASSWORD = originalPassword;
    if (originalSecret === undefined) delete process.env.ELM_AUDIT_SESSION_SECRET;
    else process.env.ELM_AUDIT_SESSION_SECRET = originalSecret;
  }
});

test('ELM auth confirms rate-limit clearing before issuing a session', async () => {
  const handler = require('../api/elm-meta-ads/auth.js');
  const names = ['ELM_AUDIT_PASSWORD', 'ELM_AUDIT_SESSION_SECRET', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];
  const originalEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = global.fetch;
  Object.assign(process.env, {
    ELM_AUDIT_PASSWORD: 'test-password',
    ELM_AUDIT_SESSION_SECRET: 'test-session-secret-with-sufficient-length',
    KV_REST_API_URL: 'https://redis.example',
    KV_REST_API_TOKEN: 'test-redis-token',
  });
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) return redisReply(1);
    return { ok: false, json: async () => ({ error: 'unavailable' }) };
  };
  try {
    const response = responseRecorder();
    await handler(request('POST', { password: 'test-password' }), response);
    assert.equal(calls, 2);
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers['set-cookie'], undefined);

    calls = 0;
    global.fetch = async () => {
      calls += 1;
      return { ok: true, json: async () => [{ result: 1 }, { result: 0 }] };
    };
    const missingExpiry = responseRecorder();
    await handler(request('POST', { password: 'test-password' }), missingExpiry);
    assert.equal(calls, 1);
    assert.equal(missingExpiry.statusCode, 503);
    assert.equal(missingExpiry.headers['set-cookie'], undefined);

    for (const invalidAttempts of ['1', null, true, [1], 1.5, -1]) {
      global.fetch = async () => ({ ok: true, json: async () => [{ result: invalidAttempts }, { result: 1 }] });
      const invalidCounter = responseRecorder();
      await handler(request('POST', { password: 'test-password' }), invalidCounter);
      assert.equal(invalidCounter.statusCode, 503);
      assert.equal(invalidCounter.headers['set-cookie'], undefined);
    }
    for (const invalidExpiry of ['1', null, true, [1], 0]) {
      global.fetch = async () => ({ ok: true, json: async () => [{ result: 1 }, { result: invalidExpiry }] });
      const invalidExpiryResponse = responseRecorder();
      await handler(request('POST', { password: 'test-password' }), invalidExpiryResponse);
      assert.equal(invalidExpiryResponse.statusCode, 503);
      assert.equal(invalidExpiryResponse.headers['set-cookie'], undefined);
    }
    for (const invalidDelete of ['1', null, true, [1], 0]) {
      calls = 0;
      global.fetch = async () => {
        calls += 1;
        return calls === 1
          ? redisReply(1)
          : { ok: true, json: async () => [{ result: invalidDelete }] };
      };
      const invalidDeleteResponse = responseRecorder();
      await handler(request('POST', { password: 'test-password' }), invalidDeleteResponse);
      assert.equal(invalidDeleteResponse.statusCode, 503);
      assert.equal(invalidDeleteResponse.headers['set-cookie'], undefined);
    }
  } finally {
    global.fetch = originalFetch;
    for (const name of names) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  }
});

test('ELM auth selects one complete Redis credential family atomically', () => {
  const { resolveRedisConfig } = require('../api/elm-meta-ads/auth.js')._test;
  assert.deepEqual(resolveRedisConfig({ KV_REST_API_URL: 'https://kv', KV_REST_API_TOKEN: 'kv-token' }), { url: 'https://kv', token: 'kv-token' });
  assert.deepEqual(resolveRedisConfig({ UPSTASH_REDIS_REST_URL: 'https://upstash/', UPSTASH_REDIS_REST_TOKEN: 'upstash-token' }), { url: 'https://upstash', token: 'upstash-token' });
  assert.equal(resolveRedisConfig({ KV_REST_API_URL: 'https://kv' }), null);
  assert.equal(resolveRedisConfig({ KV_REST_API_TOKEN: 'kv-token' }), null);
  assert.equal(resolveRedisConfig({
    KV_REST_API_URL: 'https://kv', KV_REST_API_TOKEN: 'kv-token',
    UPSTASH_REDIS_REST_URL: 'https://upstash', UPSTASH_REDIS_REST_TOKEN: 'upstash-token',
  }), null);
});

test('ELM login canonicalizes next inside its route and blocks traversal or prefix escapes', () => {
  const login = read('public/elm-meta-ads/login.html');
  assert.match(login, /Elmich Audit/);
  assert.match(login, /\/api\/elm-meta-ads\/auth/);
  assert.match(login, /new URL\(raw,window\.location\.origin\)/);
  assert.match(login, /candidate\.origin!==window\.location\.origin/);
  assert.match(login, /pathname==='\/elm-meta-ads'\|\|pathname\.startsWith\('\/elm-meta-ads\/'\)/);
  assert.match(login, /LOGIN_PATHS\.has\(pathname\)/);
  assert.doesNotMatch(login, /glv-meta-ads|glv_meta_beta/i);

  const trackedText = [read('middleware.js'), read('api/elm-meta-ads/auth.js'), login].join('\n');
  assert.doesNotMatch(trackedText, /ELM_AUDIT_PASSWORD\s*=\s*['"][^'"]+['"]/);
  assert.doesNotMatch(trackedText, /ELM_AUDIT_SESSION_SECRET\s*=\s*['"][^'"]+['"]/);
});
