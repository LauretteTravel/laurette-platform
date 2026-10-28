import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { openDb, seedDatabase, loadSeed, one, q } from './lib/db.js';
import { hashPassword, sessionUser, purgeExpiredSessions } from './lib/auth.js';
import { CLIENT_COOKIE, clientSessionUser } from './lib/client-auth.js';
import { emailConfigured, sendClientOtp } from './lib/client-email.js';
import { HttpError, createRouter, json, html, text, redirect, parseCookies, securityHeaders, clientIp, RateLimiter } from './lib/http.js';
import { artSvg, ART_KEYS } from './lib/art.js';
import { ASSET_V, trackingFlags } from './lib/views/layout.js';
import { homePage, programsPage, programsPrintPage, programPage, umrahPage, hotelsPage, getSettings } from './lib/views/public.js';
import { flightsPage, visaPage, consultPage, destinationsPage, destinationPage, guidePage, articlePage, faqPage, trackPage, aboutPage, privacyPage, newsPage, offlinePage, offersPage } from './lib/views/public2.js';
import * as API from './lib/api.js';
import * as CLIENT_API from './lib/client-api.js';
import { COOKIE } from './lib/api.js';
import { customerAccountPage, customerProfilePage } from './lib/views/account.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(HERE, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function localAdminPassword() {
  const credentialsFile = join(HERE, 'data', 'admin-credentials.txt');
  if (!existsSync(credentialsFile)) return null;
  return readFileSync(credentialsFile, 'utf8').match(/كلمة المرور المؤقتة:\s*(\S+)/)?.[1] || null;
}

export function createApp(options = {}) {
  const dbFile = options.dbFile || process.env.DB_FILE || join(HERE, 'data', 'laurette.db');
  const baseUrl = (options.baseUrl || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const db = openDb(dbFile);
  const sendVerificationEmail = options.sendVerificationEmail || sendClientOtp;
  const clientEmailEnabled = Boolean(options.sendVerificationEmail || emailConfigured());
  const seed = options.seed || loadSeed(options.seedFile || join(HERE, 'data', 'seed.json'));
  const adminPassword = options.adminPassword || process.env.ADMIN_PASSWORD || localAdminPassword();
  const seedResult = seedDatabase(db, seed, hashPassword, adminPassword);
  purgeExpiredSessions(db);

  const limiter = new RateLimiter();
  const router = createRouter();
  const startedAt = Date.now();

  /* ---------------- pages ---------------- */
  const page = (fn, opts = {}) => (ctx) => {
    const body = fn(ctx, ctx.params?.slug);
    if (body === null) {
      const settings = getSettings(db);
      return html(ctx.res, 404, offlinePage({ settings, nonce: ctx.nonce, baseUrl }), { ...securityHeaders(ctx.nonce, ctx.secure, ctx.tracking) });
    }
    return html(ctx.res, 200, body, { ...securityHeaders(ctx.nonce, ctx.secure, ctx.tracking) });
  };

  router.get('/', page(homePage));
  router.get('/programs/print', page(programsPrintPage));
  router.get('/programs', page(programsPage));
  router.get('/offers', page(offersPage));
  router.get('/programs/:slug', page(programPage));
  router.get('/umrah', page(umrahPage));
  router.get('/flights', page(flightsPage));
  router.get('/hotels', page(hotelsPage));
  router.get('/visa', page(visaPage));
  router.get('/consult', page(consultPage));
  router.get('/destinations', page(destinationsPage));
  router.get('/destinations/:slug', page(destinationPage));
  router.get('/guide', page(guidePage));
  router.get('/guide/:slug', page(articlePage));
  router.get('/faq', page(faqPage));
  router.get('/track', page(trackPage));
  router.get('/account', page(customerAccountPage));
  router.get('/account/profile', page(customerProfilePage));
  router.get('/about', page(aboutPage));
  router.get('/privacy', page(privacyPage));
  router.get('/news', page(newsPage));

  /* ---------------- admin shell ---------------- */
  router.get('/admin', (ctx) => html(ctx.res, 200, adminShell(ctx), {
    ...securityHeaders(ctx.nonce, ctx.secure, ctx.tracking), 'cache-control': 'no-store',
  }));
  router.get('/admin/:rest*', (ctx) => html(ctx.res, 200, adminShell(ctx), {
    ...securityHeaders(ctx.nonce, ctx.secure, ctx.tracking), 'cache-control': 'no-store',
  }));

  /* ---------------- api ---------------- */
  const POST_LIMITS = {
    '/api/requests': { max: 20, window: 3600_000 },
    '/api/track': { max: 30, window: 3600_000 },
    '/api/assistant': { max: 80, window: 3600_000 },
    '/api/recommend': { max: 60, window: 3600_000 },
    '/api/auth/login': { max: 12, window: 600_000 },
    '/api/track-event': { max: 300, window: 3600_000 },
    '/api/client/auth/register': { max: 8, window: 3600_000 },
    '/api/client/auth/verify': { max: 10, window: 600_000 },
    '/api/client/auth/resend': { max: 5, window: 3600_000 },
    '/api/client/auth/login': { max: 12, window: 600_000 },
  };

  const api = (handler, { auth = false, action = null, limit = null } = {}) => async (ctx) => {
    if (limit) {
      const rule = POST_LIMITS[limit];
      if (rule) {
        const hit = limiter.hit(`${limit}|${ctx.ip}`, rule.max, rule.window);
        if (!hit.allowed) {
          ctx.res.setHeader('retry-after', String(hit.retryAfter));
          return json(ctx.res, 429, { ok: false, message: 'عدد المحاولات كبير. حاول لاحقًا.' });
        }
      }
    }
    if (auth && !ctx.user) return json(ctx.res, 401, { ok: false, message: 'يلزم تسجيل الدخول' });
    if (action && !ctx.user) return json(ctx.res, 401, { ok: false, message: 'يلزم تسجيل الدخول' });
    return handler(ctx);
  };

  router.post('/api/auth/login', api(API.login, { limit: '/api/auth/login' }));
  router.post('/api/auth/logout', api(API.logout));
  router.get('/api/auth/me', API.me);
  router.post('/api/auth/change-password', api(API.changePassword, { auth: true }));

  router.post('/api/client/auth/register', api((ctx) => CLIENT_API.registerClient(ctx, sendVerificationEmail, clientEmailEnabled), { limit: '/api/client/auth/register' }));
  router.post('/api/client/auth/verify', api(CLIENT_API.verifyClientEmail, { limit: '/api/client/auth/verify' }));
  router.post('/api/client/auth/resend', api((ctx) => CLIENT_API.resendClientOtp(ctx, sendVerificationEmail, clientEmailEnabled), { limit: '/api/client/auth/resend' }));
  router.post('/api/client/auth/login', api(CLIENT_API.loginClient, { limit: '/api/client/auth/login' }));
  router.post('/api/client/auth/logout', api(CLIENT_API.logoutClient));
  router.get('/api/client/auth/me', CLIENT_API.currentClient);
  router.get('/api/client/bookings', CLIENT_API.clientBookings);
  router.get('/api/client/profile', CLIENT_API.currentClient);
  router.patch('/api/client/profile', CLIENT_API.updateClientProfile);

  router.post('/api/requests', api(API.createRequestApi, { limit: '/api/requests' }));
  router.post('/api/admin/requests', api(API.createInternalRequest, { action: 'requests:write', limit: '/api/requests' }));
  router.post('/api/track', api(API.trackRequest, { limit: '/api/track' }));
  router.get('/api/programs', API.listProgramsApi);
  router.get('/api/programs/:slug', API.getProgramApi);
  router.post('/api/recommend', api(API.recommendApi, { limit: '/api/recommend' }));
  router.post('/api/assistant', api(API.assistantApi, { limit: '/api/assistant' }));
  router.post('/api/track-event', api(API.trackEvent, { limit: '/api/track-event' }));

  router.get('/api/admin/overview', api(API.overview, { action: 'overview:read' }));
  router.get('/api/admin/requests', api(API.listRequests, { action: 'requests:read' }));
  router.get('/api/admin/requests/:id', api(API.getRequest, { action: 'requests:read' }));
  router.patch('/api/admin/requests/:id', api(API.updateRequest, { action: 'requests:write' }));
  router.post('/api/admin/requests/:id/transfers', api(API.createRequestTransfer, { action: 'requests:write' }));
  router.get('/api/admin/transfers', api(API.listRequestTransfers, { action: 'requests:read' }));
  router.post('/api/admin/transfers/:id/respond', api(API.respondRequestTransfer, { action: 'requests:write' }));
  router.get('/api/admin/customers', api(API.listCustomers, { action: 'customers:read' }));
  router.get('/api/admin/customers/:id', api(API.getCustomer, { action: 'customers:read' }));
  router.patch('/api/admin/customers/:id', api(API.updateCustomer, { action: 'customers:write' }));

  for (const resource of ['programs', 'offers', 'news', 'articles', 'faq', 'visa', 'kb', 'destinations', 'reviews']) {
    router.get(`/api/admin/${resource}`, (ctx) => API.listResource(ctx, resource));
    router.post(`/api/admin/${resource}`, (ctx) => API.createResource(ctx, resource));
    router.patch(`/api/admin/${resource}/:id`, (ctx) => API.updateResource(ctx, resource));
    router.delete(`/api/admin/${resource}/:id`, (ctx) => API.deleteResource(ctx, resource));
  }

  router.get('/api/admin/users', api(API.listUsers, { action: 'users:write' }));
  router.post('/api/admin/users', api(API.createUser, { action: 'users:write' }));
  router.patch('/api/admin/users/:id', api(API.updateUser, { action: 'users:write' }));
  router.get('/api/admin/organization', api(API.organization, { action: 'organization:read' }));
  router.post('/api/admin/branches', api(API.createBranch, { action: 'organization:write' }));
  router.post('/api/admin/departments', api(API.createDepartment, { action: 'organization:write' }));
  router.post('/api/admin/roles', api(API.createRole, { action: 'organization:write' }));
  router.patch('/api/admin/roles/:roleKey', api(API.updateRole, { action: 'organization:write' }));
  router.get('/api/admin/audit', api(API.auditLog, { action: 'audit:read' }));
  router.get('/api/admin/media', api(API.listMedia, { action: 'content:write' }));
  router.get('/api/admin/reports', api(API.reports, { action: 'reports:read' }));
  router.get('/api/admin/reports.csv', api(API.reportsCsv, { action: 'reports:read' }));
  router.get('/api/admin/tracking-events', api(API.trackingEvents, { action: 'overview:read' }));
  router.get('/api/admin/settings', api(API.getSettings, { action: 'settings:write' }));
  router.patch('/api/admin/settings', api(API.updateSettings, { action: 'settings:write' }));
  router.get('/api/admin/assistant-log', api(API.assistantLog, { action: 'overview:read' }));

  /* ---------------- generated assets & seo ---------------- */
  router.get('/art/:file', (ctx) => {
    const match = /^([a-z]+)\.svg$/.exec(ctx.params.file || '');
    const key = match && ART_KEYS.includes(match[1]) ? match[1] : 'haram';
    const variant = Number(ctx.query.v || 0) % 4;
    const svg = artSvg(key, variant);
    ctx.res.writeHead(200, {
      'content-type': 'image/svg+xml; charset=utf-8',
      'content-length': Buffer.byteLength(svg),
      'cache-control': 'public, max-age=604800, immutable',
    });
    ctx.res.end(svg);
  });

  router.get('/sitemap.xml', (ctx) => {
    const urls = ['/', '/programs', '/offers', '/umrah', '/flights', '/hotels', '/visa', '/consult', '/destinations', '/guide', '/faq', '/about', '/news'];
    const programs = q(db, "SELECT slug, updated_at FROM programs WHERE status IN ('published','sold_out')");
    const destinations = q(db, 'SELECT slug FROM destinations WHERE published = 1');
    const articles = q(db, "SELECT slug, updated_at FROM articles WHERE status = 'published'");
    const entries = [
      ...urls.map((u) => ({ loc: `${baseUrl}${u}`, priority: u === '/' ? '1.0' : '0.8' })),
      ...programs.map((p) => ({ loc: `${baseUrl}/programs/${p.slug}`, priority: '0.7', lastmod: String(p.updated_at || '').slice(0, 10) })),
      ...destinations.map((d) => ({ loc: `${baseUrl}/destinations/${d.slug}`, priority: '0.6' })),
      ...articles.map((a) => ({ loc: `${baseUrl}/guide/${a.slug}`, priority: '0.6', lastmod: String(a.updated_at || '').slice(0, 10) })),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((e) => `  <url><loc>${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}<priority>${e.priority}</priority></url>`).join('\n')}\n</urlset>`;
    text(ctx.res, 200, xml, 'application/xml; charset=utf-8', { 'cache-control': 'public, max-age=3600' });
  });

  router.get('/robots.txt', (ctx) => {
    const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /track\nDisallow: /api/\n\nSitemap: ${baseUrl}/sitemap.xml\n`;
    text(ctx.res, 200, body, 'text/plain; charset=utf-8', { 'cache-control': 'public, max-age=3600' });
  });

  router.get('/site.webmanifest', (ctx) => {
    const manifest = {
      name: 'لوريت للسياحة والسفر',
      short_name: 'لوريت',
      start_url: '/',
      display: 'standalone',
      background_color: '#FFFFFF',
      theme_color: '#0B2A43',
      lang: 'ar',
      dir: 'rtl',
      icons: [{ src: '/art/haram.svg?v=0', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    };
    text(ctx.res, 200, JSON.stringify(manifest), 'application/manifest+json; charset=utf-8');
  });

  router.get('/health', (ctx) => json(ctx.res, 200, {
    ok: true, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), seeded: seedResult.seeded, programs: one(db, 'SELECT COUNT(*) n FROM programs').n,
  }));

  /* ---------------- static ---------------- */
  async function serveStatic(req, res, pathname) {
    const rel = normalize(pathname).replace(/^([/\\])+/, '');
    const file = resolve(PUBLIC_DIR, rel);
    if (!file.startsWith(resolve(PUBLIC_DIR))) return false;
    try {
      const data = await readFile(file);
      const ext = extname(file).toLowerCase();
      const isHtml = ext === '.html';
      const revalidate = isHtml || ext === '.js' || ext === '.css';
      const range = req.headers.range;
      if (range && /^bytes=\d*-\d*$/.test(range)) {
        const [startRaw, endRaw] = range.replace('bytes=', '').split('-');
        const start = startRaw ? Number(startRaw) : 0;
        const end = endRaw ? Math.min(Number(endRaw), data.length - 1) : data.length - 1;
        if (start >= data.length || start > end) {
          res.writeHead(416, { 'content-range': `bytes */${data.length}` });
          return res.end();
        }
        const chunk = data.subarray(start, end + 1);
        res.writeHead(206, {
          'content-type': MIME[ext] || 'application/octet-stream',
          'content-length': chunk.length,
          'content-range': `bytes ${start}-${end}/${data.length}`,
          'accept-ranges': 'bytes',
          'cache-control': revalidate ? 'no-cache' : 'public, max-age=604800',
          'x-content-type-options': 'nosniff',
        });
        return res.end(req.method === 'HEAD' ? undefined : chunk);
      }
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'content-length': data.length,
        'accept-ranges': 'bytes',
        'cache-control': revalidate ? 'no-cache' : 'public, max-age=604800',
        'x-content-type-options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
      return true;
    } catch {
      return false;
    }
  }

  async function handle(req, res) {
    const started = Date.now();
    const url = new URL(req.url, baseUrl);
    const pathname = url.pathname;
    const nonce = randomBytes(16).toString('base64');
    const secure = req.headers['x-forwarded-proto'] === 'https' || baseUrl.startsWith('https://');
    const cookies = parseCookies(req);
    const token = cookies[COOKIE] || null;
    const clientToken = cookies[CLIENT_COOKIE] || null;
    const user = sessionUser(db, token);
    const clientUser = clientSessionUser(db, clientToken);
    const settings = getSettings(db);
    const tracking = trackingFlags(settings);
    const ctx = {
      req, res, db, params: {}, query: Object.fromEntries(url.searchParams.entries()),
      user, token, clientUser, clientToken, nonce, baseUrl, secure, ip: clientIp(req),
      settings, tracking,
    };

    res.setHeader('x-request-id', randomBytes(6).toString('hex'));
    for (const [headerName, headerValue] of Object.entries(securityHeaders(nonce, secure, tracking))) {
      res.setHeader(headerName, headerValue);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (pathname.startsWith('/assets/') || pathname.startsWith('/media/')) {
        const served = await serveStatic(req, res, pathname);
        if (served) return;
        return text(res, 404, 'Not found');
      }
    }

    if (pathname.length > 1 && pathname.endsWith('/')) {
      return redirect(res, pathname.replace(/\/+$/, '') + (url.search || ''), 301);
    }

    if (pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method)) {
        const requestedWith = req.headers['x-requested-with'];
        const origin = req.headers.origin;
        const sameOrigin = !origin || origin === baseUrl || (origin && req.headers.host && origin.endsWith(req.headers.host));
        if (requestedWith !== 'fetch' && !sameOrigin) {
          return json(res, 403, { ok: false, message: 'طلب غير مسموح' });
        }
      }
      const match = router.match(req.method, pathname);
      if (!match) return json(res, 404, { ok: false, message: 'المسار غير موجود' });
      ctx.params = match.params;
      try {
        const result = match.route.handler(ctx);
        if (result && typeof result.then === 'function') await result;
        return;
      } catch (err) {
        return handleError(ctx, err);
      }
    }

    if (!['GET', 'HEAD'].includes(req.method)) return text(res, 405, 'Method not allowed');

    const match = router.match('GET', pathname);
    if (!match) {
      const settings = getSettings(db);
      return html(res, 404, offlinePage({ settings, nonce, baseUrl }), { ...securityHeaders(nonce, secure, tracking) });
    }
    ctx.params = match.params;
    try {
      await match.route.handler(ctx);
    } catch (err) {
      handleError(ctx, err);
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  }

  function handleError(ctx, err) {
    const isApi = ctx.req.url.startsWith('/api/');
    if (!(err instanceof HttpError)) console.error('[error]', err);
    if (isApi) {
      return json(ctx.res, err.status || 500, {
        ok: false,
        message: err.status ? err.message : 'حدث خطأ غير متوقع. حاول لاحقًا.',
        ...(err.details ? { errors: err.details } : {}),
      });
    }
    const settings = getSettings(db);
    return html(ctx.res, err.status || 500, offlinePage({ settings, nonce: ctx.nonce, baseUrl }), { ...securityHeaders(ctx.nonce, ctx.secure, ctx.tracking) });
  }

  const server = http.createServer((req, res) => {
    res.on('finish', () => {
      if (process.env.LOG_REQUESTS === '1') console.log(`${req.method} ${req.url} ${res.statusCode}`);
    });
    handle(req, res).catch((err) => {
      console.error('[fatal]', err);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Internal error');
    });
  });

  return {
    server, db, baseUrl, limiter,
    listen(port = 3000, host = '127.0.0.1') {
      return new Promise((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolvePromise(server.address()));
      });
    },
    close() {
      return new Promise((resolvePromise) => {
        server.close(() => {
          try { db.close(); } catch { /* ignore */ }
          resolvePromise();
        });
      });
    },
  };
}

function adminShell(ctx) {
  const nonce = ctx.nonce;
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#0B2A43">
<title>لوحة إدارة لوريت</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/app.css?v=${ASSET_V}">
<link rel="icon" href="/art/haram.svg?v=0" type="image/svg+xml">
</head>
<body class="admin-body">
<main id="adminRoot" aria-live="polite">
  <div class="login-wrap"><div class="login-card"><h1>لوحة إدارة لوريت</h1><p class="muted">جارٍ التحميل…</p></div></div>
</main>
<noscript><p style="padding:24px">تحتاج إلى تفعيل JavaScript لاستخدام لوحة الإدارة.</p></noscript>
<script src="/assets/js/admin.js?v=${ASSET_V}" nonce="${nonce}" defer></script>
</body>
</html>`;
}

/* ---------------- CLI ---------------- */
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  const baseUrl = process.env.BASE_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://${host}:${port}`);
  const app = createApp({ baseUrl });
  app.listen(port, host).then((addr) => {
    console.log(`\n  لوريت — المنصة تعمل الآن`);
    console.log(`  http://${host}:${addr.port}`);
    console.log(`  لوحة الإدارة: http://${host}:${addr.port}/admin`);
    const credentialsFile = join(HERE, 'data', 'admin-credentials.txt');
    if (existsSync(credentialsFile)) {
      console.log('  بيانات الدخول: data/admin-credentials.txt');
    } else if (process.env.ADMIN_PASSWORD) {
      console.log('  كلمة مرور المدير مضبوطة عبر ADMIN_PASSWORD.');
    }
  }).catch((err) => {
    console.error('فشل تشغيل الخادم:', err.message);
    process.exit(1);
  });
}
