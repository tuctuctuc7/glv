const AUTH_COOKIE = 'glv_meta_beta';
const LOGIN_PATH = '/glv-meta-ads/login';
const AUTH_PATH = '/api/glv-meta-ads/auth';
const DATA_PATH = '/api/glv-meta-ads/fb-data';
const MB_OS_DATA_PATH = '/api/glv-mb-os/decision-report';
const LEGACY_META_PATH = '/glv-meta-ads-2';
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

function isDashboardPath(pathname) {
  return (
    pathname === '/glv-meta-ads'
    || pathname.startsWith('/glv-meta-ads/')
    || pathname === '/glv-mb-os'
    || pathname.startsWith('/glv-mb-os/')
  );
}

function hasAccess(request) {
  const token = process.env.GLV_META_BETA_AUTH_TOKEN;
  return Boolean(token && cookieValue(request.headers.get('cookie'), AUTH_COOKIE) === token);
}

export default function middleware(request) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === LEGACY_META_PATH || pathname.startsWith(`${LEGACY_META_PATH}/`)) {
    const canonicalUrl = new URL(request.url);
    canonicalUrl.pathname = `/glv-meta-ads${pathname.slice(LEGACY_META_PATH.length)}`;
    return Response.redirect(canonicalUrl, 308);
  }

  if (PUBLIC_ASSET_PATHS.has(pathname)) return;

  if (pathname === AUTH_PATH || pathname === LOGIN_PATH || pathname === `${LOGIN_PATH}.html`) {
    return;
  }

  if ((pathname === DATA_PATH || pathname === MB_OS_DATA_PATH) && !hasAccess(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isDashboardPath(pathname) && !hasAccess(request)) {
    const loginUrl = new URL(LOGIN_PATH, request.url);
    loginUrl.searchParams.set('next', `${url.pathname}${url.search}`);
    return Response.redirect(loginUrl);
  }
}

export const config = {
  matcher: ['/glv-meta-ads/:path*', '/glv-meta-ads-2', '/glv-meta-ads-2/:path*', '/glv-mb-os/:path*', '/api/glv-meta-ads/fb-data', '/api/glv-mb-os/decision-report'],
};
