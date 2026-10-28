import { gzipSync } from 'node:zlib';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || null;
  }
}

export function compressible(res) {
  const type = String(res.getHeader('content-type') || '');
  return /^text\/|json|javascript|svg|xml|manifest/i.test(type);
}

/** Wrap res so text-like responses are gzipped when the client accepts it. */
export function withCompression(req, res) {
  const accepts = /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
  if (!accepts || req.method === 'HEAD') return res;
  const originalWriteHead = res.writeHead.bind(res);
  let statusCode = 200;
  let headers = {};
  res.writeHead = (code, reasonOrHeaders, maybeHeaders) => {
    statusCode = code;
    if (typeof reasonOrHeaders === 'string') headers = maybeHeaders || {};
    else headers = reasonOrHeaders || {};
    return res;
  };
  const originalEnd = res.end.bind(res);
  res.end = (chunk = '', encoding) => {
    try {
      const body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8');
      const headerBag = { ...res.getHeaders(), ...headers };
      const alreadyEncoded = headerBag['content-encoding'];
      const isRange = statusCode === 206 || headerBag['content-range'];
      const type = String(headerBag['content-type'] || '');
      const compressibleType = /^text\/|json|javascript|svg|xml|manifest/i.test(type);
      if (!alreadyEncoded && !isRange && compressibleType && body.length >= 1024) {
        const gz = gzipSync(body, { level: 6 });
        if (gz.length < body.length) {
          originalWriteHead(statusCode, {
            ...headerBag,
            'content-encoding': 'gzip',
            'content-length': gz.length,
            vary: headerBag.vary ? `${headerBag.vary}, Accept-Encoding` : 'Accept-Encoding',
          });
          return originalEnd(gz);
        }
      }
      originalWriteHead(statusCode, headerBag);
      return originalEnd(body);
    } catch {
      originalWriteHead(statusCode, { ...res.getHeaders(), ...headers });
      return originalEnd(chunk, encoding);
    }
  };
  return res;
}

import { t } from './i18n.js';

function localizePayload(data, depth = 0) {
  if (depth > 4) return data;
  if (typeof data === 'string') return t(data);
  if (Array.isArray(data)) return data.map((item) => localizePayload(item, depth + 1));
  if (!data || typeof data !== 'object') return data;
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = localizePayload(value, depth + 1);
  }
  if (typeof out.message === 'string') out.message = t(out.message);
  return out;
}

export function json(res, status, data, extraHeaders = {}) {
  const localized = res.lang === 'en' ? localizePayload(data) : data;
  const body = JSON.stringify(localized);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

export function text(res, status, body, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

export function html(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

export function redirect(res, location, status = 303) {
  res.writeHead(status, { location, 'content-length': 0 });
  res.end();
}

export function securityHeaders(nonce, isHttps, tracking = {}) {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`];
  const connectSrc = ["'self'"];
  const frameSrc = ["'self'"];
  if (tracking && tracking.enabled) {
    if (tracking.gtm || tracking.ads) {
      scriptSrc.push('https://www.googletagmanager.com', 'https://www.google-analytics.com', 'https://googleads.g.doubleclick.net');
      frameSrc.push('https://www.googletagmanager.com', 'https://td.doubleclick.net');
    }
    if (tracking.pixel) {
      scriptSrc.push('https://connect.facebook.net');
    }
    connectSrc.push('https://www.google-analytics.com', 'https://analytics.google.com', 'https://stats.g.doubleclick.net',
      'https://www.facebook.com', 'https://connect.facebook.net', 'https://region1.google-analytics.com');
  }
  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: https:",
    `connect-src ${connectSrc.join(' ')}`,
    `frame-src ${frameSrc.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  const headers = {
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'permissions-policy': 'geolocation=(), microphone=(), camera=()',
    'cross-origin-opener-policy': 'same-origin',
  };
  if (isHttps) headers['strict-transport-security'] = 'max-age=15552000; includeSubDomains';
  return headers;
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function cookie(name, value, { maxAge, httpOnly = true, secure = false, sameSite = 'Lax', path = '/' } = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) bits.push('HttpOnly');
  if (secure) bits.push('Secure');
  if (maxAge !== undefined) bits.push(`Max-Age=${maxAge}`);
  return bits.join('; ');
}

export async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'حجم الطلب كبير جدًا');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit = 64 * 1024) {
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  const type = String(req.headers['content-type'] || '');
  if (!type.includes('application/json')) throw new HttpError(415, 'نوع المحتوى غير مدعوم');
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new HttpError(400, 'صيغة البيانات غير صحيحة');
  }
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export function compilePath(pattern) {
  const keys = [];
  const regex = new RegExp(`^${pattern
    .replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === '*' ? '.*' : `\\${m}`))
    .replace(/:(\w+)/g, (_, key) => { keys.push(key); return '([^/]+)'; })}$`);
  return { regex, keys };
}

export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler) => {
    const { regex, keys } = compilePath(pattern);
    routes.push({ method, regex, keys, handler, pattern });
  };
  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    patch: (p, h) => add('PATCH', p, h),
    put: (p, h) => add('PUT', p, h),
    delete: (p, h) => add('DELETE', p, h),
    match(method, pathname) {
      const norm = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
      for (const route of routes) {
        if (route.method !== method) continue;
        const m = route.regex.exec(norm);
        if (!m) continue;
        const params = {};
        route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { route, params };
      }
      return null;
    },
  };
}

export class RateLimiter {
  constructor() { this.hits = new Map(); }
  hit(key, max, windowMs) {
    const now = Date.now();
    const rec = this.hits.get(key);
    if (!rec || now - rec.start > windowMs) {
      this.hits.set(key, { count: 1, start: now });
      return { allowed: true, remaining: max - 1, retryAfter: 0 };
    }
    rec.count += 1;
    if (rec.count > max) {
      return { allowed: false, remaining: 0, retryAfter: Math.ceil((windowMs - (now - rec.start)) / 1000) };
    }
    return { allowed: true, remaining: max - rec.count, retryAfter: 0 };
  }
  reset() { this.hits.clear(); }
}

