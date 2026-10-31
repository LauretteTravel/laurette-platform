import * as TASKS from './lib/tasks-api.js';
import * as FOLLOW_UPS from './lib/follow-ups.js';
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { openDb, seedDatabase, loadSeed, one, exec, q } from './lib/db.js';
import { hashPassword, sessionUser, purgeExpiredSessions } from './lib/auth.js';
import { CLIENT_COOKIE, clientSessionUser } from './lib/client-auth.js';
import { emailConfigured, sendClientOtp } from './lib/client-email.js';
import { HttpError, createRouter, json, html, text, redirect, parseCookies, securityHeaders, clientIp, RateLimiter, withCompression } from './lib/http.js';
import { artSvg, ART_KEYS } from "./lib/art.js";
import { ASSET_V, trackingFlags } from './lib/views/layout.js';
import { homePage, programsPage, programsPrintPage, programPage, umrahPage, hotelsPage, getSettings } from './lib/views/public.js';
import { flightsPage, visaPage, consultPage, destinationsPage, destinationPage, guidePage, articlePage, faqPage, trackPage, aboutPage, privacyPage, newsPage, offlinePage, offersPage, jordanPage } from './lib/views/public2.js';
import * as API from "./lib/api.js";
import * as CLIENT_API from "./lib/client-api.js";
import * as WHATSAPP from "./lib/whatsapp.js";
import { COOKIE } from "./lib/api.js";
import * as STAFF from "./lib/staff-api.js";
import * as STAFF_MFA from "./lib/staff-mfa.js";
import { auditContext } from "./lib/audit-context.js";
import { withApiAuthorization } from './lib/api-authorization.js';
import { customerAccountPage, customerProfilePage } from './lib/views/account.js';
import { localizeHtml, dictionary } from "./lib/i18n.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(HERE, "public");
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
  '.woff2': 'font/woff2',
};

function localAdminPassword() {
  const credentialsFile = join(HERE, 'data', 'admin-credentials.txt');
  if (!existsSync(credentialsFile)) return null;
  return readFileSync(credentialsFile, 'utf8').match(/كلمة المرور المؤقتة:\s*(\S+)/)?.[1] || null;
}

function ensureAdminPassword() {
  const file = join(HERE, 'data', 'admin-credentials.txt');
  const generated = randomBytes(9).toString('base64url');
  const body = `لوريت — بيانات دخول لوحة الإدارة\nاسم المستخدم: laurette\nكلمة المرور المؤقتة: ${generated}\nغيّرها بعد أول تسجيل دخول.\n`;
  try {
    mkdirSync(join(HERE, 'data'), { recursive: true });
    writeFileSync(file, body, 'utf8');
    console.warn('[laurette] No ADMIN_PASSWORD found — generated a temporary one in data/admin-credentials.txt');
  } catch {
    console.warn('[laurette] No ADMIN_PASSWORD found and could not write data/admin-credentials.txt');
  }
  return generated;
}

/* One-time, owner-initiated admin password recovery.
   Trigger: env ADMIN_RESET="<new password>" (optionally ADMIN_RESET_USER="<username>"),
   or a committed admin-reset.json {"username":"laurette","password":"..."} at the repo root.
   Each password value is applied at most once: its sha256 is stored in meta.admin_reset_token.
   The trigger also forces a password change on next login and clears existing sessions.
   Remove the trigger (or unset the env var) once the password has been rotated. */
function applyAdminPasswordRecovery(db) {
  let trigger = null;
  if (process.env.ADMIN_RESET) {
    trigger = { username: process.env.ADMIN_RESET_USER || null, password: process.env.ADMIN_RESET };
  } else if (existsSync(join(HERE, 'admin-reset.json'))) {
    try {
      trigger = JSON.parse(readFileSync(join(HERE, 'admin-reset.json'), 'utf8'));
    } catch {
      console.warn('[admin-recovery] admin-reset.json is not valid JSON — ignored.');
      return;
    }
  }
  if (!trigger || !trigger.password) return;
  const token = createHash('sha256').update(String(trigger.password)).digest('hex');
  const applied = one(db, "SELECT value FROM meta WHERE key = 'admin_reset_token'")?.value;
  if (applied === token) return;
  const user = trigger.username
    ? one(db, 'SELECT id, username FROM users WHERE username = ? AND active = 1', [String(trigger.username)])
    : one(db, "SELECT id, username FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1");
  if (!user) {
    console.warn('[admin-recovery] no active user matches the recovery trigger — ignored.');
    return;
  }
  const { hash, salt } = hashPassword(String(trigger.password));
  exec(db, 'UPDATE users SET password_hash = ?, password_salt = ?, must_change = 1 WHERE id = ?', [hash, salt, user.id]);
  exec(db, 'DELETE FROM sessions WHERE user_id = ?', [user.id]);
  exec(db, "INSERT INTO meta (key, value) VALUES ('admin_reset_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [token]);
  console.warn(`[admin-recovery] Admin password reset for "${user.username}" — it must be changed on first login. Remove the recovery trigger afterwards.`);
}

export function createApp(options = {}) {
  const dbFile = options.dbFile || process.env.DB_FILE || join(HERE, 'data', 'laurette.db');
  const baseUrl = (options.baseUrl || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const db = openDb(dbFile);
  const sendVerificationEmail = options.sendVerificationEmail || sendClientOtp;
  const clientEmailEnabled = Boolean(options.sendVerificationEmail || emailConfigured());
  const seed = options.seed || loadSeed(options.seedFile || join(HERE, 'data', 'seed.json'));
  const adminPassword = options.adminPassword || process.env.ADMIN_PASSWORD || localAdminPassword() || ensureAdminPassword();
  const seedResult = seedDatabase(db, seed, hashPassword, adminPassword);
  // Recovery only runs for real server boots (server.js CLI). Programmatic boots that pass
  // their own seed/adminPassword (tests, tools) are skipped so fixtures stay untouched.
  if (!options.seed && !options.adminPassword) applyAdminPasswordRecovery(db);
  purgeExpiredSessions(db);

  const limiter = new RateLimiter();
  const router = createRouter();
  const startedAt = Date.now();
  const whatsappWorker = WHATSAPP.whatsappNotificationsReady()
    ? setInterval(() => {
      WHATSAPP.processWhatsAppOutbox(db).catch((error) => {
        console.error('[whatsapp] outbox worker failed:', error.message);
      });
    }, 5_000)
    : null;
  whatsappWorker?.unref();

  /* ---------------- pages ---------------- */
  const sendHtml = (ctx, status, body, headers = {}) => html(
    ctx.res,
    status,
    ctx.lang === 'en' ? localizeHtml(body, { path: ctx.path, baseUrl, lang: 'en' }) : body,
    headers,
  );

  const page = (fn, opts = {}) => (ctx) => {
    const body = fn(ctx, ctx.params?.slug);
    if (body === null) {
      const settings = getSettings(db);
      return sendHtml(ctx, 404, offlinePage({ settings, nonce: ctx.nonce, baseUrl }), { ...securityHeaders(ctx.nonce, ctx.secure, ctx.tracking) });
    }
    return sendHtml(ctx, 200, body, { ...securityHeaders(ctx.nonce, ctx.secure, ctx.tracking) });
  };

  router.get("/", page(homePage));
  router.get("/programs/print", page(programsPrintPage));
  router.get("/programs", page(programsPage));
  router.get("/offers", page(offersPage));
  router.get("/jordan", page(jordanPage));
  router.get("/programs/:slug", page(programPage));
  router.get("/umrah", page(umrahPage));
  router.get("/flights", page(flightsPage));
  router.get("/hotels", page(hotelsPage));
  router.get("/visa", page(visaPage));
  router.get("/consult", page(consultPage));
  router.get("/destinations", page(destinationsPage));
  router.get("/destinations/:slug", page(destinationPage));
  router.get("/guide", page(guidePage));
  router.get("/guide/:slug", page(articlePage));
  router.get("/faq", page(faqPage));
  router.get("/track", page(trackPage));
  router.get("/account", page(customerAccountPage));
  router.get("/account/profile", page(customerProfilePage));
  router.get("/about", page(aboutPage));
  router.get("/privacy", page(privacyPage));
  router.get("/news", page(newsPage));

  /* ---------------- admin shell ---------------- */
  router.get('/admin', (ctx) => html(ctx.res, 200, adminShell(ctx), {
    ...securityHeaders(ctx.nonce, ctx.secure, ctx.tracking), 'cache-control': 'no-store',
  }));
  router.get('/admin/:rest*', (ctx) => html(ctx.res, 200, adminShell(ctx), {
    ...securityHeaders(ctx.nonce, ctx.secure, ctx.tracking), 'cache-control': 'no-store',
  }));

  /* ---------------- api ---------------- */
  const POST_LIMITS = {
    "/api/requests": { max: 20, window: 3600_000 },
    "/api/track": { max: 30, window: 3600_000 },
    "/api/assistant": { max: 80, window: 3600_000 },
    "/api/recommend": { max: 60, window: 3600_000 },
    "/api/auth/mfa": { max: 20, window: 600_000 },
    "/api/auth/login": { max: 12, window: 600_000 },
    "/api/track-event": { max: 300, window: 3600_000 },
    "/api/client/auth/register": { max: 8, window: 3600_000 },
    "/api/client/auth/verify": { max: 10, window: 600_000 },
    "/api/client/auth/resend": { max: 5, window: 3600_000 },
    "/api/client/auth/login": { max: 12, window: 600_000 },
  };

  const api = (handler, { auth = false, action = null, limit = null } = {}) => {
    const authorized = withApiAuthorization(handler, { auth, action });
    const limited = async (ctx) => {
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
      return auditContext.run(
        { user: ctx.user, ip: ctx.ip, reason: `${ctx.req.method} ${ctx.path}` },
        () => authorized(ctx),
      );
    };
    limited.requiredAction = action;
    return limited;
  };

  router.post('/api/auth/login', api(API.login, { limit: '/api/auth/login' }));
  router.post(
    "/api/auth/mfa/setup",
    api(STAFF_MFA.setupMfa, { auth: true, limit: "/api/auth/mfa" }),
  );
  router.post(
    "/api/auth/mfa/confirm",
    api(STAFF_MFA.confirmMfa, { auth: true, limit: "/api/auth/mfa" }),
  );
  router.post(
    "/api/auth/mfa/verify",
    api(STAFF_MFA.verifyMfa, { limit: "/api/auth/mfa" }),
  );
  router.get("/api/auth/memberships", api(STAFF.myMemberships, { auth: true }));
  router.post("/api/auth/context", api(STAFF.switchMembership, { auth: true }));
  router.post("/api/auth/logout", api(API.logout));
  router.get("/api/auth/me", API.me);
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

  router.get('/api/whatsapp/webhook', WHATSAPP.verifyWebhook);
  router.post('/api/whatsapp/webhook', api(WHATSAPP.receiveWebhook));
  router.post('/api/requests', api(API.createRequestApi, { limit: '/api/requests' }));
  router.post('/api/admin/requests', api(API.createInternalRequest, { action: 'requests:write', limit: '/api/requests' }));
  router.post('/api/track', api(API.trackRequest, { limit: '/api/track' }));
  router.get("/api/programs", API.listProgramsApi);
  router.get("/api/programs/:slug", API.getProgramApi);
  router.post('/api/recommend', api(API.recommendApi, { limit: '/api/recommend' }));
  router.post('/api/assistant', api(API.assistantApi, { limit: '/api/assistant' }));
  router.post('/api/track-event', api(API.trackEvent, { limit: '/api/track-event' }));

  router.get('/api/admin/tasks/options', api(TASKS.taskOptions,{action:'tasks:read'}));
  router.get('/api/admin/tasks', api(TASKS.listTasks,{action:'tasks:read'}));
  router.get('/api/admin/tasks/:id', api(TASKS.getTask,{action:'tasks:read'}));
  router.post('/api/admin/tasks', api(TASKS.createTask,{action:'tasks:write'}));
  router.patch('/api/admin/tasks/:id', api(TASKS.updateTask,{action:'tasks:write'}));
  router.post('/api/admin/tasks/:id/comments', api(TASKS.commentTask,{action:'tasks:write'}));
  router.post('/api/admin/tasks/:id/checklist', api(TASKS.addChecklist,{action:'tasks:write'}));
  router.patch('/api/admin/task-checklist/:id', api(TASKS.checkItem,{action:'tasks:write'}));
  router.get('/api/admin/notifications', api(TASKS.notifications,{action:'tasks:read'}));
  router.post('/api/admin/notifications/:id/read', api(TASKS.readNotification,{action:'tasks:read'}));
  router.get('/api/admin/overview', api(API.overview, { action: 'overview:read' }));
  router.get('/api/admin/follow-ups', api(FOLLOW_UPS.listFollowUps, { action: 'requests:read' }));
  router.get('/api/admin/requests/:id/follow-ups', api(FOLLOW_UPS.listFollowUps, { action: 'requests:read' }));
  router.post('/api/admin/requests/:id/follow-ups', api(FOLLOW_UPS.createFollowUp, { action: 'requests:write' }));
  router.post('/api/admin/follow-ups/:id/finish', api(FOLLOW_UPS.finishFollowUp, { action: 'requests:write' }));
  router.get('/api/admin/requests', api(API.listRequests, { action: 'requests:read' }));
  router.get('/api/admin/requests/:id', api(API.getRequest, { action: 'requests:read' }));
  router.patch('/api/admin/requests/:id', api(API.updateRequest, { action: 'requests:write' }));
  router.post(
    "/api/admin/requests/:id/transfers",
    api(API.createRequestTransfer, { action: "requests:transfer" }),
  );
  router.get('/api/admin/transfers', api(API.listRequestTransfers, { action: 'requests:read' }));
  router.post(
    "/api/admin/transfers/:id/respond",
    api(API.respondRequestTransfer, { action: "requests:transfer" }),
  );
  router.get('/api/admin/customers', api(API.listCustomers, { action: 'customers:read' }));
  router.get('/api/admin/customers/:id', api(API.getCustomer, { action: 'customers:read' }));
  router.patch('/api/admin/customers/:id', api(API.updateCustomer, { action: 'customers:write' }));

  for (const resource of ['programs', 'offers', 'news', 'articles', 'faq', 'visa', 'kb', 'destinations', 'reviews']) {
    const access = API.resourceAccess(resource);
    router.get(`/api/admin/${resource}`, api((ctx) => API.listResource(ctx, resource), { action: access.read }));
    router.post(`/api/admin/${resource}`, api((ctx) => API.createResource(ctx, resource), { action: access.write }));
    router.patch(`/api/admin/${resource}/:id`, api((ctx) => API.updateResource(ctx, resource), { action: access.write }));
    router.delete(
      `/api/admin/${resource}/:id`,
      api((ctx) => API.deleteResource(ctx, resource), {
        action: access.delete,
      }),
    );
  }

  router.get(
    "/api/admin/users/:id/profile",
    api(STAFF.employeeProfile, { action: "users:write" }),
  );
  router.patch(
    "/api/admin/users/:id/profile",
    api(STAFF.updateEmployeeProfile, { action: "users:write" }),
  );
  router.get(
    "/api/admin/users/:id/memberships",
    api(STAFF.listMemberships, { action: "users:write" }),
  );
  router.post(
    "/api/admin/users/:id/memberships",
    api(STAFF.createMembership, { action: "users:write" }),
  );
  router.patch(
    "/api/admin/users/:id/memberships/:membershipId",
    api(STAFF.updateMembership, { action: "users:write" }),
  );
  router.patch(
    "/api/admin/branches/:id",
    api(STAFF.updateOrganizationUnit, { action: "organization:write" }),
  );
  router.patch(
    "/api/admin/departments/:id",
    api(STAFF.updateOrganizationUnit, { action: "organization:write" }),
  );
  router.get(
    "/api/admin/audit/export",
    api(STAFF.exportAudit, { action: "audit:export" }),
  );
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
  router.get(
    "/api/admin/reports.csv",
    api(API.reportsCsv, { action: "reports:export" }),
  );
  router.get('/api/admin/tracking-events', api(API.trackingEvents, { action: 'overview:read' }));
  router.get('/api/admin/webhooks', api(API.webhookDeliveries, { action: 'settings:write' }));
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

  router.get('/i18n/en.json', (ctx) => {
    text(ctx.res, 200, JSON.stringify(dictionary()), 'application/json; charset=utf-8', { 'cache-control': 'public, max-age=300' });
  });

  /* Public branding used by client-side documents (voucher header/footer). */
  router.get('/api/settings', (ctx) => {
    const s = ctx.settings || {};
    const publicSettings = {
      brand: s.brand, brandShort: s.brandShort, currency: s.currency,
      whatsapp: s.whatsapp, branches: s.branches || [], email: s.email,
    };
    json(ctx.res, 200, { ok: true, settings: publicSettings }, { 'cache-control': 'public, max-age=600' });
  });

  router.get('/sitemap.xml', (ctx) => {
    const urls = ['/', '/programs', '/offers', '/jordan', '/umrah', '/flights', '/hotels', '/visa', '/consult', '/destinations', '/guide', '/faq', '/about', '/news'];
    const programs = q(db, "SELECT slug, updated_at FROM programs WHERE status IN ('published','sold_out')");
    const destinations = q(db, 'SELECT slug FROM destinations WHERE published = 1');
    const articles = q(db, "SELECT slug, updated_at FROM articles WHERE status = 'published'");
    const pages = [
      ...urls.map((u) => ({ path: u, priority: u === '/' ? '1.0' : '0.8' })),
      ...programs.map((p) => ({ path: `/programs/${p.slug}`, priority: '0.7', lastmod: String(p.updated_at || '').slice(0, 10) })),
      ...destinations.map((d) => ({ path: `/destinations/${d.slug}`, priority: '0.6' })),
      ...articles.map((a) => ({ path: `/guide/${a.slug}`, priority: '0.6', lastmod: String(a.updated_at || '').slice(0, 10) })),
    ];
    const alternates = (p) => {
      const ar = `${baseUrl}${p}`;
      const en = p === '/' ? `${baseUrl}/en` : `${baseUrl}/en${p}`;
      return `<xhtml:link rel="alternate" hreflang="ar" href="${ar}"/><xhtml:link rel="alternate" hreflang="en" href="${en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${ar}"/>`;
    };
    const entries = pages.flatMap((e) => {
      const ar = `${baseUrl}${e.path}`;
      const en = e.path === '/' ? `${baseUrl}/en` : `${baseUrl}/en${e.path}`;
      return [ar, en].map((loc) => `<url><loc>${loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}<priority>${e.priority}</priority>${alternates(e.path)}</url>`);
    });
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>`;
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
      icons: [
        { src: '/media/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/media/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/media/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
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
      const cacheControl = ext === '.woff2'
        ? 'public, max-age=31536000, immutable'
        : (revalidate ? 'no-cache' : 'public, max-age=604800');
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
          'cache-control': cacheControl,
          'x-content-type-options': 'nosniff',
        });
        return res.end(req.method === 'HEAD' ? undefined : chunk);
      }
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'content-length': data.length,
        'accept-ranges': 'bytes',
        'cache-control': cacheControl,
        'x-content-type-options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
      return true;
    } catch {
      return false;
    }
  }

  async function handle(req, res) {
    withCompression(req, res);
    const started = Date.now();
    const url = new URL(req.url, baseUrl);
    let pathname = url.pathname;
    let lang = 'ar';
    if (pathname === '/en' || pathname.startsWith('/en/')) {
      lang = 'en';
      pathname = pathname.slice(3) || '/';
    } else if (pathname === '/ar' || pathname.startsWith('/ar/')) {
      const rest = pathname.slice(3) || '/';
      return redirect(res, rest + (url.search || ''), 301);
    }
    const nonce = randomBytes(16).toString('base64');
    res.lang = lang;
    const secure = req.headers['x-forwarded-proto'] === 'https' || baseUrl.startsWith('https://');
    const cookies = parseCookies(req);
    const token = cookies[COOKIE] || null;
    const clientToken = cookies[CLIENT_COOKIE] || null;
    const user = sessionUser(db, token);
    const clientUser = clientSessionUser(db, clientToken);
    const settings = getSettings(db);
    const tracking = trackingFlags(settings);
    const ctx = {
      req, res, db, params: {}, query: Object.fromEntries(url.searchParams.entries()), lang, path: pathname,
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
      return redirect(res, (lang === 'en' ? '/en' + pathname.replace(/\/+$/, '') : pathname.replace(/\/+$/, '')) + (url.search || ''), 301);
    }

    if (pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method) && pathname !== '/api/whatsapp/webhook') {
        const origin = req.headers.origin;
        // A fetch header must never bypass origin validation.
        let sameOrigin = false;
        try {
          const supplied = new URL(origin);
          const requestOrigin = new URL(`${secure ? 'https' : 'http'}://${req.headers.host}`).origin;
          sameOrigin = supplied.origin === origin && (origin === new URL(baseUrl).origin || origin === requestOrigin);
        } catch { /* Reject missing, null and malformed origins. */ }
        if (!sameOrigin) {
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
      return sendHtml(ctx, 404, offlinePage({ settings, nonce, baseUrl }), { ...securityHeaders(nonce, secure, tracking) });
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
    return sendHtml(ctx, err.status || 500, offlinePage({ settings, nonce: ctx.nonce, baseUrl }), { ...securityHeaders(ctx.nonce, ctx.secure, ctx.tracking) });
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
    // In-process metadata only; no route manifest is exposed over HTTP.
    routeManifest: router.describe(),
    listen(port = 3000, host = '127.0.0.1') {
      return new Promise((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolvePromise(server.address()));
      });
    },
    close() {
      if (whatsappWorker) clearInterval(whatsappWorker);
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
<link rel="preload" href="/assets/fonts/cairo-arabic.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/fonts/cairo.css?v=1">
<link rel="stylesheet" href="/assets/css/app.css?v=${ASSET_V}">
<link rel="stylesheet" href="/assets/css/voucher.css?v=${ASSET_V}">
<link rel="stylesheet" href="/assets/css/voucher-studio.css?v=${ASSET_V}">
<link rel="icon" href="/art/haram.svg?v=0" type="image/svg+xml">
</head>
<body class="admin-body">
<main id="adminRoot" aria-live="polite">
  <div class="login-wrap"><div class="login-card"><h1>لوحة إدارة لوريت</h1><p class="muted">جارٍ التحميل…</p></div></div>
</main>
<noscript><p style="padding:24px">تحتاج إلى تفعيل JavaScript لاستخدام لوحة الإدارة.</p></noscript>
<script src="/assets/js/admin.js?v=${ASSET_V}" nonce="${nonce}" defer></script>
<script src="/assets/js/voucher-generator.js?v=${ASSET_V}" nonce="${nonce}" defer></script>
<script src="/assets/js/voucher-studio.js?v=${ASSET_V}" nonce="${nonce}" defer></script>
</body>
</html>`;
}

/* ---------------- CLI ---------------- */
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  const baseUrl = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL
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
