import { exec, one, q, transaction } from './db.js';
import { audit } from './domain.js';
import { HttpError, html, json, readJson, securityHeaders } from './http.js';
import { esc, isoNow } from './util.js';
import { layout } from './views/layout.js';

const MB = 1024 * 1024;
const PDFs = 25 * MB;
const covers = 5 * MB;
const uploadLimit = PDFs + covers + 64 * 1024;
export const brochureCategories = {
  tourism: 'السياحة الخارجية', pilgrimage: 'الحج والعمرة',
  flights: 'عروض التذاكر', honeymoon: 'شهر عسل', seasonal: 'عروض الموسم',
};

function string(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new HttpError(422, 'تحقق من الحقول المطلوبة وطول النص');
  }
  return value.trim();
}

function metadata(data) {
  const category = data.get('category');
  if (!Object.hasOwn(brochureCategories, category)) throw new HttpError(422, 'اختر تصنيفًا صالحًا');
  return [
    string(data.get('title'), 160, true), category, string(data.get('destination'), 100, true),
    string(data.get('duration') ?? '', 80), string(data.get('starting_price') ?? '', 80),
  ];
}

async function multipart(req) {
  const type = req.headers['content-type'] || '';
  if (!/^multipart\/form-data\s*;/i.test(type)) throw new HttpError(415, 'استخدم نموذج رفع الملفات');
  if (Number(req.headers['content-length']) > uploadLimit) {
    req.resume();
    throw new HttpError(413, 'حجم الملفات أكبر من الحد المسموح');
  }
  const chunks = [];
  let size = 0;
  // Disable destruction on early exit so the HTTP response can still report a 413.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > uploadLimit) {
      req.resume();
      throw new HttpError(413, 'حجم الملفات أكبر من الحد المسموح');
    }
    chunks.push(chunk);
  }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { 'content-type': type } }).formData();
  } catch {
    throw new HttpError(400, 'بيانات نموذج الرفع غير صالحة');
  }
}

async function files(data) {
  const document = data.get('pdf');
  if (!(document instanceof Blob) || document.type !== 'application/pdf') throw new HttpError(415, 'اختر ملف PDF صالحًا');
  if (document.size > PDFs) throw new HttpError(413, 'الحد الأقصى لملف PDF هو 25 ميغابايت');
  const pdf = Buffer.from(await document.arrayBuffer());
  if (!/^%PDF-\d\.\d/.test(pdf.subarray(0, 8).toString('ascii')) || !/%%EOF\s*$/.test(pdf.subarray(-4096).toString('latin1'))) {
    throw new HttpError(415, 'ملف PDF تالف أو غير صالح');
  }
  const image = data.get('cover');
  if (image instanceof Blob && image.size === 0 && !image.name) return { pdf, cover: null, coverType: null };
  if (image == null) return { pdf, cover: null, coverType: null };
  if (!(image instanceof Blob)) throw new HttpError(415, 'صورة الغلاف غير صالحة');
  if (image.size > covers) throw new HttpError(413, 'الحد الأقصى لصورة الغلاف هو 5 ميغابايت');
  const cover = Buffer.from(await image.arrayBuffer());
  const coverType = cover.subarray(0, 3).equals(Buffer.from([255,216,255])) ? 'image/jpeg'
    : cover.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
    : cover.toString('ascii', 0, 4) === 'RIFF' && cover.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
  if (!coverType || coverType !== image.type) throw new HttpError(415, 'استخدم غلاف JPEG أو PNG أو WebP');
  return { pdf, cover, coverType };
}

function find(ctx, activeOnly = false) {
  const id = Number(ctx.params.id);
  const row = Number.isSafeInteger(id) && id > 0
    ? one(ctx.db, `SELECT * FROM tour_brochures WHERE id=? ${activeOnly ? 'AND is_active=1' : ''}`, [id])
    : null;
  if (!row) throw new HttpError(404, 'الكتيب غير متاح');
  return row;
}

function present(row, admin = false) {
  const { pdf_file_path, is_active, ...fields } = row;
  return { ...fields, download_url: pdf_file_path, preview_url: `${pdf_file_path}?inline=1`,
    ...(admin ? { is_active: Boolean(is_active) } : {}) };
}

function list(ctx, admin) {
  const conditions = [admin ? '1=1' : 'is_active=1'];
  const params = [];
  if (ctx.query.category) {
    if (!Object.hasOwn(brochureCategories, ctx.query.category)) throw new HttpError(422, 'التصنيف غير صالح');
    conditions.push('category=?');
    params.push(ctx.query.category);
  }
  if (ctx.query.q) {
    const term = string(ctx.query.q, 120).toLowerCase();
    conditions.push('(instr(lower(title), ?) > 0 OR instr(lower(destination), ?) > 0)');
    params.push(term, term);
  }
  const page = Number(ctx.query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new HttpError(422, 'رقم الصفحة غير صالح');
  const rows = q(ctx.db, `SELECT * FROM tour_brochures WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT 25 OFFSET ?`, [...params, (page - 1) * 24]);
  return json(ctx.res, 200, { ok: true, categories: brochureCategories,
    brochures: rows.slice(0, 24).map(row => present(row, admin)), page, hasMore: rows.length > 24 });
}

function disposition(title, inline) {
  const name = title.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '-');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
  return `${inline ? 'inline' : 'attachment'}; filename="laurette-program.pdf"; filename*=UTF-8''${encoded}.pdf`;
}

function download(ctx) {
  const row = find(ctx, true);
  const inline = ctx.query.inline === '1';
  const size = row.file_size;
  let start = 0;
  let end = size - 1;
  const range = ctx.req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end;
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || start >= size || start > end) {
      ctx.res.writeHead(416, { 'content-range': `bytes */${size}` });
      return ctx.res.end();
    }
  }
  const length = end - start + 1;
  const file = one(ctx.db, 'SELECT substr(pdf, ?, ?) AS data FROM tour_brochure_files WHERE brochure_id=?', [start + 1, length, row.id]);
  if (!file) throw new HttpError(404, 'ملف الكتيب غير متاح');
  if (!inline && start === 0) exec(ctx.db, 'UPDATE tour_brochures SET download_count=download_count+1 WHERE id=?', [row.id]);
  ctx.res.writeHead(range ? 206 : 200, {
    'content-type': 'application/pdf', 'content-length': length, 'accept-ranges': 'bytes',
    'content-disposition': disposition(row.title, inline),
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN',
    'content-security-policy': "frame-ancestors 'self'",
    ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
  });
  return ctx.res.end(Buffer.from(file.data));
}

export function mountBrochures(router, db, api) {
  router.get('/brochures', ctx => {
    const title = 'البرامج السياحية والعروض';
    const body = `<div dir="rtl" class="brochures-hub">
      <section class="bh-hero"><div class="container"><span>LAURETTE TRAVEL &amp; TOURISM</span>
        <h1>${title}</h1><p>تصفّح برامج لوريت وحمّل تفاصيل رحلتك بصيغة PDF.</p></div></section>
      <section class="container bh-catalogue" aria-label="كتيبات السفر">
        <form id="brochure-filters">
          <label for="brochure-search">ابحث عن وجهة أو برنامج</label>
          <div class="bh-search"><input id="brochure-search" name="q" type="search" maxlength="120" placeholder="مثل تركيا أو عمرة"><button class="btn btn-primary">بحث</button></div>
        </form>
        <div id="brochure-categories" class="bh-tabs" aria-label="تصنيف البرامج">
          ${[['', 'الكل'], ...Object.entries(brochureCategories)].map(([key, label]) => `<button type="button" data-category="${key}" aria-pressed="${!key}">${esc(label)}</button>`).join('')}
        </div>
        <p id="brochure-status" role="status"></p><div id="brochure-grid" class="bh-grid"></div>
        <button id="brochure-more" type="button" class="btn btn-ghost" hidden>عرض المزيد</button>
        <noscript>فعّل JavaScript لتصفّح الكتيبات ومعاينتها.</noscript>
      </section>
      <dialog id="brochure-preview" class="bh-dialog" aria-labelledby="brochure-preview-title">
        <div class="bh-dialog-head"><h2 id="brochure-preview-title"></h2><form method="dialog"><button class="btn btn-ghost" aria-label="إغلاق المعاينة">إغلاق</button></form></div>
        <iframe title="معاينة كتيب البرنامج" referrerpolicy="no-referrer"></iframe>
        <div class="bh-dialog-actions"><a data-download class="btn btn-primary">تحميل البرنامج (PDF)</a><a data-open class="btn btn-ghost" target="_blank" rel="noopener">فتح PDF في المتصفح</a><a data-share class="btn btn-ghost" target="_blank" rel="noopener noreferrer">مشاركة عبر واتساب</a></div>
      </dialog></div>`;
    return html(ctx.res, 200, layout({ ...ctx, title, description: 'كتيبات برامج وعروض السفر من لوريت للسياحة والسفر.',
      path: '/brochures', canonical: `${ctx.baseUrl}/brochures`, body,
      extraHead: '<link rel="stylesheet" href="/assets/css/brochures.css"><script src="/assets/js/brochures.js" defer></script>' }),
    securityHeaders(ctx.nonce, ctx.secure, ctx.tracking));
  });
  router.get('/api/brochures', ctx => list(ctx, false));
  router.get('/api/admin/brochures', api(ctx => list(ctx, true), { action: 'programs:write' }));
  router.post('/api/brochures', api(async ctx => {
    const data = await multipart(ctx.req);
    const values = metadata(data);
    const { pdf, cover, coverType } = await files(data);
    const id = transaction(db, () => {
      const result = exec(db, `INSERT INTO tour_brochures(title,category,destination,duration,starting_price,pdf_file_path,file_size,created_at)
        VALUES(?,?,?,?,?,'',?,?)`, [...values, pdf.length, isoNow()]);
      const newId = Number(result.lastInsertRowid);
      exec(db, 'INSERT INTO tour_brochure_files VALUES(?,?,?,?)', [newId, pdf, cover, coverType]);
      exec(db, 'UPDATE tour_brochures SET pdf_file_path=?,cover_image_url=? WHERE id=?',
        [`/api/brochures/${newId}/download`, cover ? `/api/brochures/${newId}/cover` : null, newId]);
      audit(db, { user: ctx.user, action: 'create-brochure', entity: 'tour_brochures', entityId: newId, ip: ctx.ip });
      return newId;
    });
    return json(ctx.res, 201, { ok: true, brochure: present(one(db, 'SELECT * FROM tour_brochures WHERE id=?', [id]), true) });
  }, { action: 'programs:write' }));
  router.get('/api/brochures/:id/download', download);
  router.get('/api/brochures/:id/cover', ctx => {
    const row = find(ctx, true);
    const file = one(db, 'SELECT cover,cover_type FROM tour_brochure_files WHERE brochure_id=?', [row.id]);
    if (!file?.cover) throw new HttpError(404, 'الغلاف غير متاح');
    ctx.res.writeHead(200, { 'content-type': file.cover_type, 'content-length': file.cover.length,
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    return ctx.res.end(Buffer.from(file.cover));
  });
  router.patch('/api/brochures/:id', api(async ctx => {
    const body = await readJson(ctx.req, 8 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(422, 'بيانات الكتيب غير صالحة');
    const values = metadata(new Map(Object.entries(body)));
    const row = find(ctx);
    transaction(db, () => {
      exec(db, 'UPDATE tour_brochures SET title=?,category=?,destination=?,duration=?,starting_price=? WHERE id=?', [...values, row.id]);
      audit(db, { user: ctx.user, action: 'edit-brochure', entity: 'tour_brochures', entityId: row.id, ip: ctx.ip });
    });
    return json(ctx.res, 200, { ok: true, brochure: present(one(db, 'SELECT * FROM tour_brochures WHERE id=?', [row.id]), true) });
  }, { action: 'programs:write' }));
  router.patch('/api/brochures/:id/toggle', api(ctx => {
    const row = find(ctx);
    transaction(db, () => {
      exec(db, 'UPDATE tour_brochures SET is_active=1-is_active WHERE id=?', [row.id]);
      audit(db, { user: ctx.user, action: 'toggle-brochure', entity: 'tour_brochures', entityId: row.id, ip: ctx.ip });
    });
    return json(ctx.res, 200, { ok: true, is_active: !row.is_active });
  }, { action: 'programs:write' }));
  router.delete('/api/brochures/:id', api(ctx => {
    const row = find(ctx);
    transaction(db, () => {
      exec(db, 'DELETE FROM tour_brochures WHERE id=?', [row.id]);
      audit(db, { user: ctx.user, action: 'delete-brochure', entity: 'tour_brochures', entityId: row.id, ip: ctx.ip });
    });
    return json(ctx.res, 200, { ok: true });
  }, { action: 'programs:write' }));
}
