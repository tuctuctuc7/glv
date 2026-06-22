const AUTH_COOKIE = 'glv_meta_beta';
const LOGIN_PATH = '/glv-meta-ads/login';
const AUTH_PATH = '/api/glv-meta-ads/auth';
const DATA_PATH = '/api/glv-meta-ads/fb-data';

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
  return pathname === '/glv-meta-ads' || pathname.startsWith('/glv-meta-ads/');
}

function hasAccess(request) {
  const token = process.env.GLV_META_BETA_AUTH_TOKEN;
  return Boolean(token && cookieValue(request.headers.get('cookie'), AUTH_COOKIE) === token);
}

export default function middleware(request) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === AUTH_PATH || pathname === LOGIN_PATH || pathname === `${LOGIN_PATH}.html`) {
    return;
  }

  if (pathname === DATA_PATH && !hasAccess(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isDashboardPath(pathname) && !hasAccess(request)) {
    const loginUrl = new URL(LOGIN_PATH, request.url);
    loginUrl.searchParams.set('next', `${url.pathname}${url.search}`);
    return Response.redirect(loginUrl);
  }
}

export const config = {
  matcher: ['/glv-meta-ads/:path*', '/api/glv-meta-ads/fb-data'],
};
