import { randomBytes } from 'node:crypto';
import { q, one, exec, transaction } from './db.js';
import { can } from './auth.js';
import { HttpError, json, html, readJson, securityHeaders } from './http.js';
import { addEvent, cleanPhone } from './domain.js';
import { migrateWorkspace } from './workspace-db.js';

const now = () => new Date().toISOString();
const ref = (prefix) => `LRT-${prefix}-${randomBytes(6).toString('hex').toUpperCase()}`;
const parse = (v) => JSON.parse(v || '{}');
const moneyAllowed = (u) => can(u, 'reports:read');
function requireStaff(c, permission = 'requests:read') {
  if (!c.user) throw new HttpError(401, 'يلزم تسجيل الدخول');
  if (c.user.mustChange || !can(c.user, permission)) throw new HttpError(403, 'لا تملك صلاحية لهذا الإجراء أو يلزم تغيير كلمة المرور');
  return c.user;
}
export function workspaceScope(u, alias = 'r', mine = false) {
  // Legacy agents also receive assigned-only scope (legacy admin APIs remain unchanged).
  if (mine || u.dataScope === 'assigned' || (!u.roleKey && u.role === 'agent')) return { sql: `${alias}.assigned_to = ?`, args: [u.id] };
  if (u.dataScope === 'branch' || (!u.roleKey && u.role === 'manager')) return { sql: `${alias}.branch_id = ?`, args: [u.branchId || -1] };
  if (u.dataScope === 'department') return { sql: `${alias}.department_id = ?`, args: [u.departmentId || -1] };
  return { sql: '1=1', args: [] };
}
function request(c, id) {
  const s = workspaceScope(requireStaff(c));
  const r = one(c.db, `SELECT r.*, c.name AS customer_name,c.phone,u.name AS consultant,u.phone AS consultant_phone,b.name AS branch_name
    FROM requests r JOIN customers c ON c.id=r.customer_id LEFT JOIN users u ON u.id=r.assigned_to
    LEFT JOIN branches b ON b.id=r.branch_id WHERE r.id=? AND ${s.sql}`, [Number(id), ...s.args]);
  if (!r) throw new HttpError(404, 'الطلب غير موجود');
  return r;
}
function event(c, id, kind, message, meta) {
  addEvent(c.db, id, { kind, message, meta, actorId: c.user?.id, actorName: c.user?.name || 'العميل' });
}
function notify(c, id, kind, message) {
  exec(c.db, 'INSERT INTO workspace_notifications(request_id,kind,message,created_at) VALUES(?,?,?,?)', [id, kind, message, now()]);
}
function str(v, max = 200, required = false) {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) throw new HttpError(422, 'تحقق من الحقول المطلوبة وطول النص');
  return v.trim();
}
function number(v, max = 1e7, min = 0) {
  if (v === '' || v === null || typeof v === 'boolean' || !Number.isFinite(Number(v)) || Number(v) < min || Number(v) > max) throw new HttpError(422, 'قيمة رقمية غير صالحة');
  return Number(v);
}
function date(v, month = false) {
  if (!v) return '';
  const value = str(v, 10);
  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new HttpError(422, 'التاريخ غير صالح');
  return value;
}
const TYPES = { flight: 'تذكرة طيران', holiday: 'برنامج سياحي', honeymoon: 'شهر عسل', hotel: 'فندق', visa: 'تأشيرة', umrah: 'عمرة', hajj: 'حج', cruise: 'كروز', mice: 'MICE / لوجستيات', corporate: 'شركات / B2B', other: 'أخرى' };
const STAGES = ['new','contacted','requirements','preparing','sent','waiting','interested','modification','booking_pending','booked','lost'];
function intake(body) {
  const phone = cleanPhone(body.phone);
  if (!/^\+?\d{8,15}$/.test(phone)) throw new HttpError(422, 'رقم الهاتف غير صالح');
  if (!TYPES[body.requestType]) throw new HttpError(422, 'نوع الطلب غير صالح');
  return { name: str(body.name, 80, true), phone: /^07\d{8}$/.test(phone) ? `+962${phone.slice(1)}` : phone,
    requestType: body.requestType, destination: str(body.destination, 120, true), travelDate: date(body.travelDate, true),
    budget: number(body.budget ?? 0), adults: number(body.adults ?? 2, 1000, 1), notes: str(body.notes || '', 2000), source: str(body.source || 'whatsapp', 80), stage: 'new' };
}
const ITEM_FIELDS = ['name','city','stars','roomType','mealPlan','checkIn','checkOut','nights','airline','route','departure','returnDate','baggage','transferType','date','details','visaType','processing'];
function content(body) {
  const out = {};
  for (const key of ['title','destination','inclusions','exclusions','publicNotes']) out[key] = str(body[key] || '', key === 'title' ? 200 : 5000, key === 'title');
  out.travelDate = date(body.travelDate, true); out.returnDate = date(body.returnDate);
  out.nights = number(body.nights ?? 0, 365); out.adults = number(body.adults ?? 2, 1000, 1);
  out.image = str(body.image || '/media/hero/hero-poster.jpg', 300);
  if (!/^\/media\/[a-zA-Z0-9/_ .-]+\.(jpg|jpeg|png|webp)$/.test(out.image)) throw new HttpError(422, 'اختر صورة من مكتبة لوريت');
  if (!Array.isArray(body.items) || body.items.length > 60) throw new HttpError(422, 'خدمات العرض غير صالحة');
  out.items = body.items.map((item) => {
    if (!item || !['hotel','flight','transfer','tour','visa'].includes(item.type)) throw new HttpError(422, 'نوع الخدمة غير صالح');
    const i = { type: item.type };
    for (const k of ITEM_FIELDS) if (item[k] !== undefined) i[k] = str(String(item[k]), k === 'details' ? 2000 : 200);
    for (const k of ['checkIn','checkOut','departure','returnDate','date']) if (i[k]) date(i[k]);
    if (i.checkIn && i.checkOut && i.checkOut <= i.checkIn) throw new HttpError(422, 'راجع تواريخ الفندق');
    return i;
  });
  return out;
}
function offer(c, id) {
  const o = one(c.db, 'SELECT * FROM workspace_offers WHERE id=?', [Number(id)]);
  if (!o) throw new HttpError(404, 'العرض غير موجود');
  request(c, o.request_id); return o;
}
function safeOffer(o, user) {
  const { supplier_cost, ...rest } = o;
  return { ...rest, content: parse(o.content), ...(moneyAllowed(user) ? { supplier_cost, profit: supplier_cost === null ? null : o.selling_price - supplier_cost } : {}) };
}
function booking(c, id) {
  const b = one(c.db, `SELECT b.*,d.offer_id,d.snapshot,d.pnr,d.supplier_reference,d.hotel_confirmation,d.internal_notes
    FROM bookings b LEFT JOIN workspace_booking_details d ON d.booking_id=b.id WHERE b.id=?`, [Number(id)]);
  if (!b) throw new HttpError(404, 'الحجز غير موجود'); request(c, b.request_id); return b;
}
function safeBooking(b, user) { const { cost_amount, ...rest } = b; return { ...rest, ...(moneyAllowed(user) ? { cost_amount } : {}) }; }
function summary(c) {
  const u = requireStaff(c); const manager = c.query.team === '1' && can(u, 'reports:read');
  const s = workspaceScope(u, 'r', !manager); const conditions = [s.sql]; const args = [...s.args];
  for (const [key, col] of [['branch','branch_id'],['department','department_id'],['employee','assigned_to'],['source','lead_origin']]) {
    if (manager && c.query[key]) { conditions.push(`r.${col}=?`); args.push(c.query[key]); }
  }
  if (manager && c.query.from) { conditions.push('r.created_at>=?'); args.push(date(c.query.from)); }
  if (manager && c.query.to) { conditions.push('r.created_at<?'); args.push(date(c.query.to) + 'T23:59:59.999Z'); }
  if (manager && c.query.destination) { conditions.push("json_extract(r.payload,'$.destination') LIKE ?"); args.push(`%${str(c.query.destination,120)}%`); }
  const where = conditions.join(' AND ');
  const stats = one(c.db, `SELECT COUNT(*) AS inquiries,
    COUNT(DISTINCT r.customer_id) FILTER (WHERE date(r.created_at,'+3 hours')=date('now','+3 hours')) AS newCustomers,
    COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM bookings b WHERE b.request_id=r.id AND b.status='confirmed')) AS confirmedBookings,
    COUNT(*) FILTER (WHERE json_extract(r.payload,'$.stage')='interested') AS interested,
    COUNT(*) FILTER (WHERE json_extract(r.payload,'$.stage')='lost') AS lost,
    COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM workspace_offers o WHERE o.request_id=r.id)) AS offersCreated,
    COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM request_events e WHERE e.request_id=r.id AND e.kind='offer-sent')) AS offersSent,
    COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM request_events e WHERE e.request_id=r.id AND e.kind='offer-viewed')) AS viewed,
    COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM workspace_offers o WHERE o.request_id=r.id) AND r.status NOT IN ('confirmed','cancelled') AND COALESCE(json_extract(r.payload,'$.stage'),'') NOT IN ('interested','modification','lost','booking_pending')) AS waiting
    FROM requests r WHERE ${where}`, args);
  Object.assign(stats, one(c.db, `SELECT COUNT(*) FILTER(WHERE date(f.due_at,'+3 hours')=date('now','+3 hours')) AS todayFollowUps,
    COUNT(*) FILTER(WHERE f.due_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS overdue
    FROM request_follow_ups f JOIN requests r ON r.id=f.request_id WHERE f.status='open' AND ${where}`, args));
  if (manager) Object.assign(stats, one(c.db, `SELECT COALESCE(SUM(b.amount),0) sales, SUM(b.amount-b.cost_amount) profit
    FROM bookings b JOIN requests r ON r.id=b.request_id WHERE b.status='confirmed' AND ${where}`, args));
  const traveling = q(c.db, `SELECT r.id,r.reference,c.name,json_extract(COALESCE(d.snapshot,r.payload),'$.travelDate') AS travelDate,b.reference AS booking_reference
    FROM requests r JOIN customers c ON c.id=r.customer_id JOIN bookings b ON b.request_id=r.id
    LEFT JOIN workspace_booking_details d ON d.booking_id=b.id WHERE b.status='confirmed' AND ${where}
    AND date(json_extract(COALESCE(d.snapshot,r.payload),'$.travelDate')) BETWEEN date('now','+3 hours') AND date('now','+3 hours','+7 days') ORDER BY travelDate LIMIT 30`, args);
  return { stats, traveling, manager, conversion: stats.inquiries ? Math.round(stats.confirmedBookings / stats.inquiries * 100) : 0 };
}

export function mountWorkspace(router, db) {
  migrateWorkspace(db);
  const get = (path, fn) => router.get('/api/workspace' + path, async (c) => { requireStaff(c); return json(c.res, 200, { ok: true, ...await fn(c) }); });
  const write = (method, path, fn) => router[method]('/api/workspace' + path, async (c) => {
    requireStaff(c, 'requests:write');
    const origin = c.req.headers.origin;
    if (origin && origin !== new URL(c.baseUrl).origin && origin !== `${c.secure ? 'https' : 'http'}://${c.req.headers.host}`) throw new HttpError(403, 'مصدر الطلب غير مسموح');
    return json(c.res, 200, { ok: true, ...await fn(c, await readJson(c.req, 128 * 1024)) });
  });
  router.get('/workspace', (c) => html(c.res, 200, shell(), { ...securityHeaders(c.nonce,c.secure), 'cache-control':'no-store','x-robots-tag':'noindex' }));
  router.get('/o/:token', (c) => {
    const o = one(db, 'SELECT token FROM workspace_offers WHERE token=? AND active=1',[c.params.token]);
    if (!o) throw new HttpError(404,'العرض غير متاح');
    html(c.res,200,shell(true),{...securityHeaders(c.nonce,c.secure),'cache-control':'no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'});
  });
  get('/summary', summary);
  get('/options', (c) => {
    const s = workspaceScope(c.user,'r');
    return { types:TYPES, branches:q(db,'SELECT id,name FROM branches WHERE active=1'), departments:q(db,'SELECT id,name,branch_id FROM departments WHERE active=1'),
      employees:q(db,`SELECT id,name,branch_id,department_id FROM users WHERE active=1 AND (id=? OR id IN(SELECT r.assigned_to FROM requests r WHERE ${s.sql}))`,[c.user.id,...s.args]),
      templates:q(db,'SELECT id,name,content FROM workspace_templates ORDER BY name').map(t=>({...t,content:parse(t.content)})) };
  });
  get('/requests', (c) => {
    const s=workspaceScope(c.user); const search=str(c.query.q||'',120); const page=Math.max(1,Math.min(100000,Number(c.query.page)||1));
    const where=`${s.sql} AND (?='' OR c.name LIKE ? OR c.phone LIKE ? OR r.reference LIKE ? OR r.payload LIKE ? OR EXISTS(SELECT 1 FROM workspace_offers o WHERE o.request_id=r.id AND o.reference LIKE ?) OR EXISTS(SELECT 1 FROM bookings b LEFT JOIN workspace_booking_details d ON d.booking_id=b.id WHERE b.request_id=r.id AND (b.reference LIKE ? OR d.pnr LIKE ?)))`;
    const args=[...s.args,search,...Array(7).fill(`%${search}%`)];
    return { requests:q(db,`SELECT r.id,r.reference,r.title,r.status,r.customer_id,r.assigned_to,r.branch_id,r.payload,c.name,c.phone,
      (SELECT COUNT(*) FROM request_events e WHERE e.request_id=r.id AND e.kind='offer-viewed') AS opens,
      (SELECT MAX(created_at) FROM request_events e WHERE e.request_id=r.id AND e.kind='offer-viewed') AS last_opened,
      (SELECT MIN(due_at) FROM request_follow_ups f WHERE f.request_id=r.id AND f.status='open') AS due_at
      FROM requests r JOIN customers c ON c.id=r.customer_id WHERE ${where}
      ORDER BY CASE json_extract(r.payload,'$.stage') WHEN 'interested' THEN 100 WHEN 'modification' THEN 90 WHEN 'booking_pending' THEN 80 ELSE 0 END + MIN(30,(SELECT COUNT(*)*5 FROM request_events e WHERE e.request_id=r.id AND e.kind='offer-viewed')) DESC,r.updated_at DESC LIMIT 30 OFFSET ?`,[...args,(page-1)*30]).map(r=>({...r,payload:parse(r.payload)})),page };
  });
  write('post','/customers', (c,b) => {
    if (!can(c.user,'customers:write')) throw new HttpError(403,'لا تملك صلاحية إضافة العملاء');
    const p=intake(b); const u=c.user; const s=workspaceScope(u); const limited=s.sql!=='1=1';
    const branchId=limited ? u.branchId : Number(b.branchId||u.branchId); const assigned=limited?u.id:Number(b.assignedTo||u.id);
    const branch=one(db,'SELECT id FROM branches WHERE id=? AND active=1',[branchId||-1]);
    const employee=one(db,'SELECT id,branch_id,department_id FROM users WHERE id=? AND active=1',[assigned]);
    if (!branch || !employee || (employee.branch_id && employee.branch_id!==branchId)) throw new HttpError(422,'تحقق من الفرع والموظف');
    const result=transaction(db,()=>{
      const existing=one(db,'SELECT id FROM customers WHERE phone=?',[p.phone]);
      // Do not overwrite an existing customer's details through an intake from another scope.
      const customerId=existing?.id||Number(exec(db,'INSERT INTO customers(name,phone,created_at,updated_at) VALUES(?,?,?,?)',[p.name,p.phone,now(),now()]).lastInsertRowid);
      const reference=ref('REQ'); const type=['flight','hotel','visa','umrah','cruise'].includes(p.requestType)?p.requestType:'consult';
      const id=Number(exec(db,`INSERT INTO requests(reference,type,customer_id,assigned_to,sales_owner_id,branch_id,received_branch_id,department_id,title,summary,payload,source,lead_origin,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [reference,type,customerId,assigned,assigned,branchId,branchId,employee.department_id,`${p.destination} · ${TYPES[p.requestType]}`,p.notes,JSON.stringify(p),p.source,p.source,now(),now()]).lastInsertRowid);
      event(c,id,'customer-request-created','تم تسجيل العميل وطلب السفر');
      exec(db,"INSERT INTO request_follow_ups(request_id,assigned_to,due_at,note,created_by,created_at) VALUES(?,?,?,?,?,?)",[id,assigned,now(),'التواصل وجمع متطلبات الرحلة',u.id,now()]);
      event(c,id,'follow-up-created','أُضيف الطلب إلى المتابعة'); return {id,customerId,reference};
    }); return result;
  });
  get('/requests/:id', (c) => {
    const r=request(c,c.params.id); const scope=workspaceScope(c.user);
    const customerRequests=q(db,`SELECT r.id,r.reference,r.title FROM requests r WHERE r.customer_id=? AND ${scope.sql} ORDER BY r.id DESC LIMIT 100`,[r.customer_id,...scope.args]);
    return { request:{...r,payload:parse(r.payload)}, customerRequests,
      offers:q(db,'SELECT * FROM workspace_offers WHERE request_id=? ORDER BY id DESC',[r.id]).map(o=>safeOffer(o,c.user)),
      bookings:q(db,'SELECT b.*,d.pnr,d.supplier_reference,d.hotel_confirmation,d.internal_notes FROM bookings b LEFT JOIN workspace_booking_details d ON d.booking_id=b.id WHERE b.request_id=?',[r.id]).map(b=>safeBooking(b,c.user)),
      payments:q(db,'SELECT p.* FROM booking_payments p JOIN bookings b ON b.id=p.booking_id WHERE b.request_id=? ORDER BY p.id DESC',[r.id]),
      vouchers:q(db,'SELECT v.* FROM workspace_vouchers v JOIN bookings b ON b.id=v.booking_id WHERE b.request_id=?',[r.id]).map(v=>({...v,snapshot:parse(v.snapshot)})),
      followUps:q(db,'SELECT * FROM request_follow_ups WHERE request_id=? ORDER BY due_at',[r.id]),
      events:q(db,'SELECT kind,message,actor_name,created_at FROM request_events WHERE request_id=? ORDER BY id DESC LIMIT 100',[r.id]) };
  });
  write('patch','/requests/:id', (c,b) => {
    const r=request(c,c.params.id); const p=parse(r.payload);
    if (b.stage!==undefined && !STAGES.includes(b.stage)) throw new HttpError(422,'الحالة غير صالحة');
    if (b.stage==='booked' || b.stage==='booking_pending') throw new HttpError(422,'استخدم إجراءات الحجز');
    transaction(db,()=>{
      if (b.customer) {
        if (!can(c.user,'customers:write')) throw new HttpError(403,'لا تملك صلاحية تعديل العميل');
        // Shared profiles may span multiple scopes; require access to every linked request.
        const s=workspaceScope(c.user); const outside=one(db,`SELECT id FROM requests r WHERE customer_id=? AND NOT (${s.sql}) LIMIT 1`,[r.customer_id,...s.args]);
        if (outside) throw new HttpError(403,'الملف مشترك؛ اطلب من المدير تعديل بيانات العميل');
        const name=str(b.customer.name,80,true); const phone=cleanPhone(b.customer.phone);
        if (!/^\+?\d{8,15}$/.test(phone)) throw new HttpError(422,'رقم الهاتف غير صالح');
        if (one(db,'SELECT id FROM customers WHERE phone=? AND id<>?',[phone,r.customer_id])) throw new HttpError(409,'رقم الهاتف مسجل لعميل آخر');
        exec(db,'UPDATE customers SET name=?,phone=?,updated_at=? WHERE id=?',[name,phone,now(),r.customer_id]);
      }
      for (const k of ['destination','notes','nextAction']) if (b[k]!==undefined) p[k]=str(b[k],2000);
      if (b.travelDate!==undefined) p.travelDate=date(b.travelDate,true);
      if (b.budget!==undefined) p.budget=number(b.budget);
      if (b.stage!==undefined) p.stage=b.stage;
      exec(db,'UPDATE requests SET payload=?,updated_at=? WHERE id=?',[JSON.stringify(p),now(),r.id]);
      event(c,r.id,'request-updated','تم تحديث بيانات العميل والطلب', {stage:p.stage});
    }); return {};
  });
  write('post','/templates', (c,b) => {
    const value=content(b.content); const name=str(b.name,100,true);
    if (one(db,'SELECT id FROM workspace_templates WHERE name=?',[name])) throw new HttpError(409,'اسم القالب مستخدم');
    const id=Number(exec(db,'INSERT INTO workspace_templates(name,content,created_by,created_at) VALUES(?,?,?,?)',[name,JSON.stringify(value),c.user.id,now()]).lastInsertRowid); return {id};
  });
  write('post','/requests/:id/offers', (c,b) => {
    const r=request(c,c.params.id); const data=content(b.content); const price=number(b.sellingPrice);
    if (!/^[A-Z]{3}$/.test(b.currency||'JOD')) throw new HttpError(422,'العملة غير صالحة');
    if (b.supplierCost!==undefined && !moneyAllowed(c.user)) throw new HttpError(403,'لا تملك صلاحية التكلفة');
    return transaction(db,()=>{
      const reference=ref('O'); const token=randomBytes(24).toString('base64url');
      const id=Number(exec(db,`INSERT INTO workspace_offers(request_id,token,reference,content,selling_price,supplier_cost,currency,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [r.id,token,reference,JSON.stringify(data),price,b.supplierCost===undefined?null:number(b.supplierCost),b.currency||'JOD',c.user.id,now(),now()]).lastInsertRowid);
      const p=parse(r.payload); p.stage='preparing';
      exec(db,'UPDATE requests SET quote_amount=?,quote_currency=?,payload=?,updated_at=? WHERE id=?',[price,b.currency||'JOD',JSON.stringify(p),now(),r.id]);
      event(c,r.id,'offer-created',`تم إنشاء العرض ${reference}`); event(c,r.id,'link-generated','تم إنشاء رابط العرض');
      return {id,reference,token,url:`${c.baseUrl}/o/${token}`};
    });
  });
  write('patch','/offers/:id', (c,b) => {
    const o=offer(c,c.params.id);
    if (one(db,'SELECT id FROM bookings WHERE request_id=?',[o.request_id])) throw new HttpError(409,'يوجد حجز مرتبط؛ بيانات العرض مثبتة');
    if (b.supplierCost!==undefined&&!moneyAllowed(c.user)) throw new HttpError(403,'لا تملك صلاحية التكلفة');
    const value=b.content?JSON.stringify(content(b.content)):o.content;
    if(b.active!==undefined&&typeof b.active!=='boolean') throw new HttpError(422,'حالة الرابط غير صالحة');
    exec(db,'UPDATE workspace_offers SET content=?,selling_price=?,supplier_cost=?,active=?,updated_at=? WHERE id=?',[value,b.sellingPrice===undefined?o.selling_price:number(b.sellingPrice),b.supplierCost===undefined?o.supplier_cost:number(b.supplierCost),b.active===undefined?o.active:Number(b.active),now(),o.id]);
    event(c,o.request_id,'offer-edited','تم تعديل العرض'); return {};
  });
  write('post','/offers/:id/shared',(c,b)=>{
    const o=offer(c,c.params.id); if (!o.active) throw new HttpError(409,'الرابط موقوف');
    // A deep link is not delivery confirmation. Record only the employee's explicit confirmation.
    if (b.confirmed!==true) throw new HttpError(422,'أكد إرسال الرسالة في واتساب');
    const r=request(c,o.request_id);const p=parse(r.payload);p.stage='sent';
    exec(db,'UPDATE requests SET status=?,payload=?,updated_at=? WHERE id=?',['quoted',JSON.stringify(p),now(),r.id]);
    event(c,r.id,'offer-sent','أكد الموظف إرسال العرض عبر واتساب');return {};
  });
  write('post','/requests/:id/follow-ups',(c,b)=>{
    const r=request(c,c.params.id);const due=new Date(b.dueAt);
    if(!b.dueAt||Number.isNaN(due.getTime()))throw new HttpError(422,'موعد المتابعة غير صالح');
    const note=str(b.note,2000,true);const id=Number(exec(db,'INSERT INTO request_follow_ups(request_id,assigned_to,due_at,note,created_by,created_at) VALUES(?,?,?,?,?,?)',[r.id,r.assigned_to,due.toISOString(),note,c.user.id,now()]).lastInsertRowid);
    event(c,r.id,'follow-up-created','تمت جدولة متابعة');return {id};
  });
  write('patch','/follow-ups/:id',(c,b)=>{
    const f=one(db,'SELECT * FROM request_follow_ups WHERE id=?',[Number(c.params.id)]); if(!f)throw new HttpError(404,'المتابعة غير موجودة');request(c,f.request_id);
    if(!['done','cancelled'].includes(b.status))throw new HttpError(422,'الحالة غير صالحة');
    if(f.status==='open'){exec(db,'UPDATE request_follow_ups SET status=?,completed_by=?,completed_at=? WHERE id=?',[b.status,c.user.id,now(),f.id]);event(c,f.request_id,'follow-up-completed',b.status==='done'?'اكتملت المتابعة':'أُلغيت المتابعة');}return {};
  });
  get('/follow-ups',(c)=>{const s=workspaceScope(c.user);return {followUps:q(db,`SELECT f.*,c.name,r.title FROM request_follow_ups f JOIN requests r ON r.id=f.request_id JOIN customers c ON c.id=r.customer_id WHERE f.status='open' AND ${s.sql} ORDER BY f.due_at LIMIT 100`,s.args)};});
  get('/notifications',(c)=>{const s=workspaceScope(c.user);return {notifications:q(db,`SELECT n.*,c.name,EXISTS(SELECT 1 FROM workspace_notification_reads x WHERE x.notification_id=n.id AND x.user_id=?) AS is_read FROM workspace_notifications n JOIN requests r ON r.id=n.request_id JOIN customers c ON c.id=r.customer_id WHERE ${s.sql} ORDER BY n.id DESC LIMIT 50`,[c.user.id,...s.args])};});
  write('post','/notifications/:id/read',(c)=>{const n=one(db,'SELECT * FROM workspace_notifications WHERE id=?',[Number(c.params.id)]);if(!n)throw new HttpError(404,'الإشعار غير موجود');request(c,n.request_id);exec(db,'INSERT OR IGNORE INTO workspace_notification_reads VALUES(?,?)',[n.id,c.user.id]);return {};});
  write('post','/offers/:id/booking',(c)=>{
    const o=offer(c,c.params.id);const r=request(c,o.request_id);
    return transaction(db,()=>{
      const existing=one(db,'SELECT * FROM bookings WHERE request_id=?',[r.id]);if(existing)return {booking:safeBooking(existing,c.user),existing:true};
      if(!o.active)throw new HttpError(409,'العرض موقوف');
      const reference=ref(`BKG-${new Date().getUTCFullYear()}`);
      const id=Number(exec(db,"INSERT INTO bookings(request_id,reference,status,amount,cost_amount,currency,confirmed_at,updated_at) VALUES(?,?,'pending',?,?,?,?,?)",[r.id,reference,o.selling_price,o.supplier_cost,o.currency,now(),now()]).lastInsertRowid);
      const snapshot={...parse(o.content),customerName:r.customer_name,phone:r.phone,assignedTo:r.assigned_to,branchId:r.branch_id,offerReference:o.reference,sellingPrice:o.selling_price,currency:o.currency};
      exec(db,'INSERT INTO workspace_booking_details(booking_id,offer_id,snapshot) VALUES(?,?,?)',[id,o.id,JSON.stringify(snapshot)]);
      const p=parse(r.payload);p.stage='booking_pending';exec(db,'UPDATE requests SET payload=?,updated_at=? WHERE id=?',[JSON.stringify(p),now(),r.id]);
      event(c,r.id,'booking-created',`تم تحويل العرض إلى الحجز ${reference}`);return {booking:safeBooking(one(db,'SELECT * FROM bookings WHERE id=?',[id]),c.user)};
    });
  });
  write('patch','/bookings/:id',(c,b)=>{
    const bk=booking(c,c.params.id);const r=request(c,bk.request_id);
    if(b.status!==undefined&&!['confirmed','cancelled'].includes(b.status))throw new HttpError(422,'الحالة غير صالحة');
    if(bk.status==='cancelled')throw new HttpError(409,'الحجز ملغى');
    transaction(db,()=>{
      if(b.status&&b.status!==bk.status){exec(db,'UPDATE bookings SET status=?,confirmed_by=?,confirmed_at=?,updated_at=? WHERE id=?',[b.status,c.user.id,now(),now(),bk.id]);const p=parse(r.payload);p.stage=b.status==='confirmed'?'booked':'lost';
        exec(db,'UPDATE requests SET status=?,deal_status=?,completed_at=?,payload=?,updated_at=? WHERE id=?',[b.status,b.status==='confirmed'?'won':'lost',now(),JSON.stringify(p),now(),r.id]);event(c,r.id,'booking-'+b.status,b.status==='confirmed'?'تم تأكيد الحجز':'تم إلغاء الحجز');notify(c,r.id,'booking-'+b.status,b.status==='confirmed'?'تم تأكيد الحجز':'تم إلغاء الحجز');
        if(b.status==='confirmed')exec(db,"UPDATE request_follow_ups SET status='done',completed_by=?,completed_at=? WHERE request_id=? AND status='open'",[c.user.id,now(),r.id]);
      }
      for(const [key,col] of [['pnr','pnr'],['supplierReference','supplier_reference'],['hotelConfirmation','hotel_confirmation'],['internalNotes','internal_notes']])if(b[key]!==undefined)exec(db,`UPDATE workspace_booking_details SET ${col}=? WHERE booking_id=?`,[str(b[key],2000),bk.id]);
      event(c,r.id,'booking-updated','تم تحديث بيانات الحجز');
    });return {};
  });
  write('post','/bookings/:id/payments',(c,b)=>{
    const bk=booking(c,c.params.id);if(bk.status==='cancelled')throw new HttpError(409,'الحجز ملغى');
    const amount=number(b.amount,1e7,0.01);const reference=str(b.reference,120,true);
    return transaction(db,()=>{if(one(db,'SELECT id FROM booking_payments WHERE booking_id=? AND reference=?',[bk.id,reference]))return {existing:true};
      const id=Number(exec(db,"INSERT INTO booking_payments(booking_id,kind,amount,currency,reference,note,recorded_by,created_at) VALUES(?,'receipt',?,?,?,?,?,?)",[bk.id,amount,bk.currency,reference,str(b.note||'',1000),c.user.id,now()]).lastInsertRowid);
      event(c,bk.request_id,'payment-recorded',`تم تسجيل دفعة ${amount} ${bk.currency}`);notify(c,bk.request_id,'payment-recorded','تم تسجيل دفعة للحجز');return {id};});
  });
  write('post','/bookings/:id/vouchers',(c,b)=>{
    const bk=booking(c,c.params.id);if(bk.status!=='confirmed')throw new HttpError(409,'أكد الحجز أولًا');
    if(!['flight','hotel','package'].includes(b.kind))throw new HttpError(422,'نوع القسيمة غير صالح');
    const r=request(c,bk.request_id);const p=bk.snapshot?parse(bk.snapshot):parse(r.payload);
    const snapshot={reference:bk.reference,status:'confirmed',statusLabel:'تم التأكيد',type:b.kind==='package'?'program':b.kind,typeLabel:b.kind==='package'?'برنامج سياحي':TYPES[b.kind],title:p.title||r.title,
      summary:(p.items||[]).filter(i=>b.kind==='package'||i.type===b.kind).map(i=>Object.entries(i).filter(([k])=>k!=='type').map(([,v])=>v).filter(Boolean).join(' · ')).join('\n'),
      createdAt:now(),quote:{amount:bk.amount,currency:bk.currency},payload:{name:p.customerName||r.customer_name,phone:p.phone||r.phone,adults:p.adults,travelDate:p.travelDate,returnDate:p.returnDate,programTitle:p.title,nights:p.nights,notes:p.publicNotes}};
    return transaction(db,()=>{exec(db,'INSERT OR IGNORE INTO workspace_vouchers(booking_id,kind,snapshot,created_by,created_at) VALUES(?,?,?,?,?)',[bk.id,b.kind,JSON.stringify(snapshot),c.user.id,now()]);
      const v=one(db,'SELECT * FROM workspace_vouchers WHERE booking_id=? AND kind=?',[bk.id,b.kind]);event(c,r.id,'voucher-generated','تم حفظ قسيمة الحجز');return {voucher:{...v,snapshot:parse(v.snapshot)}};});
  });
  const publicLimit=new Map();
  const publicOffer=(c)=>{const o=one(db,'SELECT * FROM workspace_offers WHERE token=? AND active=1',[c.params.token]);if(!o)throw new HttpError(404,'العرض غير متاح');return o;};
  router.get('/api/public/offers/:token',(c)=>{
    const o=publicOffer(c);const u=one(db,'SELECT u.phone,u.name FROM requests r LEFT JOIN users u ON u.id=r.assigned_to WHERE r.id=?',[o.request_id]);
    const settings=one(db,"SELECT value FROM settings WHERE key='whatsapp'");
    let fallback='';try{fallback=JSON.parse(settings?.value||'""');}catch{}
    json(c.res,200,{ok:true,offer:{reference:o.reference,content:parse(o.content),sellingPrice:o.selling_price,currency:o.currency,consultantName:u?.name||'فريق لوريت',consultantPhone:u?.phone||fallback}},{'referrer-policy':'no-referrer'});
  });
  router.post('/api/public/offers/:token/events',async(c)=>{
    const o=publicOffer(c);const origin=c.req.headers.origin;
    if(origin&&origin!==new URL(c.baseUrl).origin&&origin!==`${c.secure?'https':'http'}://${c.req.headers.host}`)throw new HttpError(403,'مصدر الطلب غير مسموح');
    const b=await readJson(c.req,4096);if(!['viewed','interested','modification','booking-requested'].includes(b.kind))throw new HttpError(422,'الإجراء غير صالح');
    const key=`${o.id}|${c.ip}`;const hit=publicLimit.get(key);if(hit&&Date.now()-hit.time<3600000&&hit.count>=30)throw new HttpError(429,'محاولات كثيرة؛ تواصل مع مستشارك');
    if(!hit||Date.now()-hit.time>=3600000)publicLimit.set(key,{time:Date.now(),count:1});else hit.count++;
    if(publicLimit.size>10000)for(const [k,v]of publicLimit)if(Date.now()-v.time>=3600000)publicLimit.delete(k);
    const kind='offer-'+b.kind;const message=str(b.message||'',1000);
    // Coalesce repeated clicks for five minutes; views are deduped by the browser per session.
    if(b.kind!=='viewed'&&one(db,"SELECT id FROM request_events WHERE request_id=? AND kind=? AND created_at>?",[o.request_id,kind,new Date(Date.now()-300000).toISOString()]))return json(c.res,200,{ok:true});
    transaction(db,()=>{const r=one(db,'SELECT payload,customer_id FROM requests WHERE id=?',[o.request_id]);const p=parse(r.payload);
      event(c,o.request_id,kind,({viewed:'فتح العميل العرض',interested:'العميل مهتم بالعرض',modification:'طلب العميل تعديل العرض','booking-requested':'طلب العميل متابعة الحجز'})[b.kind]+(message?`: ${message}`:''));
      if(b.kind!=='viewed'&&!['booked','lost','booking_pending'].includes(p.stage)){p.stage=b.kind==='booking-requested'?'interested':b.kind;exec(db,'UPDATE requests SET payload=?,updated_at=? WHERE id=?',[JSON.stringify(p),now(),o.request_id]);}
      if(b.kind!=='viewed')notify(c,o.request_id,kind,`${one(db,'SELECT name FROM customers WHERE id=?',[r.customer_id]).name} — ${b.kind==='interested'?'مهتم بالعرض':b.kind==='modification'?'يطلب تعديل العرض':'يطلب متابعة الحجز'}`);
    });json(c.res,200,{ok:true});
  });
}

function shell(publicPage=false) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Laurette Workspace</title><link rel="stylesheet" href="/assets/fonts/cairo.css"><link rel="stylesheet" href="/assets/css/workspace.css"><link rel="stylesheet" href="/assets/css/voucher.css"></head><body data-public="${publicPage}"><div id="workspace" aria-live="polite"><div class="loading">جارٍ تجهيز رحلتك مع لوريت…</div></div><div id="toast" role="status"></div><script src="/assets/js/voucher-generator.js" defer></script><script src="/assets/js/workspace.js" defer></script></body></html>`;
}
