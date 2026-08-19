const GLV_AUTH_COOKIE = 'glv_meta_beta';
const GLV_LOGIN_PATH = '/glv-meta-ads/login';
const GLV_AUTH_PATH = '/api/glv-meta-ads/auth';
const DATA_PATH = '/api/glv-meta-ads/fb-data';
const MB_OS_DATA_PATH = '/api/glv-mb-os/decision-report';
const LEGACY_META_PATH = '/glv-meta-ads-2';

const ELM_AUTH_COOKIE = 'elm_audit_session';
const ELM_LOGIN_PATH = '/elm-meta-ads/login';
const ELM_AUTH_PATH = '/api/elm-meta-ads/auth';
const ELM_SESSION_TTL_SECONDS = 604800;
const ELM_CLOCK_SKEW_SECONDS = 60;

const PUBLIC_ASSET_PATHS = new Set([
  '/glv-meta-ads/agenthic-logo.svg',
  '/glv-meta-ads/apple-touch-icon.png',
]);

function cookieValue(cookieHeader, name) {
  if (!cookieHeader) return '';
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) return rawValue.join('=');
  }
  return '';
}

function isGlvDashboardPath(pathname) {
  return (
    pathname === '/glv-meta-ads'
    || pathname.startsWith('/glv-meta-ads/')
    || pathname === '/glv-mb-os'
    || pathname.startsWith('/glv-mb-os/')
  );
}

function isElmDashboardPath(pathname) {
  return pathname === '/elm-meta-ads' || pathname.startsWith('/elm-meta-ads/');
}

function hasGlvAccess(request) {
  const token = process.env.GLV_META_BETA_AUTH_TOKEN;
  return Boolean(token && cookieValue(request.headers.get('cookie'), GLV_AUTH_COOKIE) === token);
}

function decodeBase64Url(value) {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch (error) {
    return null;
  }
}

async function hasElmAccess(request) {
  const secret = process.env.ELM_AUDIT_SESSION_SECRET;
  const token = cookieValue(request.headers.get('cookie'), ELM_AUTH_COOKIE);
  if (!secret || secret.length < 32 || !token) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [rawExpiry, nonce, rawSignature] = parts;
  if (!/^\d{10}$/.test(rawExpiry) || !/^[A-Za-z0-9_-]{32,64}$/.test(nonce)) return false;

  const expiresAt = Number(rawExpiry);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + ELM_SESSION_TTL_SECONDS + ELM_CLOCK_SKEW_SECONDS) return false;

  const signature = decodeBase64Url(rawSignature);
  if (!signature || signature.length !== 32) return false;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    return crypto.subtle.verify('HMAC', key, signature, encoder.encode(`${rawExpiry}.${nonce}`));
  } catch (error) {
    return false;
  }
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === LEGACY_META_PATH || pathname.startsWith(`${LEGACY_META_PATH}/`)) {
    const canonicalUrl = new URL(request.url);
    canonicalUrl.pathname = `/glv-meta-ads${pathname.slice(LEGACY_META_PATH.length)}`;
    return Response.redirect(canonicalUrl, 308);
  }

  if (PUBLIC_ASSET_PATHS.has(pathname)) return;

  if (
    pathname === GLV_AUTH_PATH
    || pathname === GLV_LOGIN_PATH
    || pathname === `${GLV_LOGIN_PATH}.html`
    || pathname === ELM_AUTH_PATH
    || pathname === ELM_LOGIN_PATH
    || pathname === `${ELM_LOGIN_PATH}/`
    || pathname === `${ELM_LOGIN_PATH}.html`
  ) {
    return;
  }

  if ((pathname === DATA_PATH || pathname === MB_OS_DATA_PATH) && !hasGlvAccess(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isGlvDashboardPath(pathname) && !hasGlvAccess(request)) {
    const loginUrl = new URL(GLV_LOGIN_PATH, request.url);
    loginUrl.searchParams.set('next', `${url.pathname}${url.search}`);
    return Response.redirect(loginUrl);
  }

  if (isElmDashboardPath(pathname) && !(await hasElmAccess(request))) {
    const loginUrl = new URL(ELM_LOGIN_PATH, request.url);
    loginUrl.searchParams.set('next', `${url.pathname}${url.search}`);
    return Response.redirect(loginUrl);
  }
}

export const config = {
  matcher: [
    '/glv-meta-ads/:path*',
    '/glv-meta-ads-2',
    '/glv-meta-ads-2/:path*',
    '/glv-mb-os/:path*',
    '/api/glv-meta-ads/fb-data',
    '/api/glv-mb-os/decision-report',
    '/elm-meta-ads/:path*',
    '/api/elm-meta-ads/auth',
  ],
};
