import { one, q, exec, transaction } from './db.js';
import { requestScope } from './api.js';
import { can } from './auth.js';
import { HttpError, readJson, json } from './http.js';
import { addEvent, audit } from './domain.js';
import { isoNow } from './util.js';

function scopedRequest(ctx, id) {
  const scope = requestScope(ctx.user);
  const row = one(ctx.db, `SELECT r.* FROM requests r WHERE r.id=?${scope.sql ? ' AND ' + scope.sql : ''}`, [Number(id), ...scope.params]);
  if (!row) throw new HttpError(404, 'الطلب غير موجود');
  return row;
}
function candidates(ctx, request) {
  if (!can(ctx.user, 'requests:assign')) return [{ id: ctx.user.id, name: ctx.user.name }];
  const users = q(ctx.db, `SELECT u.id,u.name,u.role,u.role_key,u.branch_id,u.department_id,d.data_scope,d.permissions
    FROM users u LEFT JOIN role_definitions d ON d.role_key=u.role_key AND d.active=1
    WHERE u.active=1 AND u.branch_id IS ? AND u.department_id IS ?`, [request.branch_id, request.department_id]);
  const allowed = users.filter((u) => {
    let permissions;
    try { permissions = u.permissions ? JSON.parse(u.permissions) : undefined; } catch { return false; }
    if (u.role_key && !u.data_scope) return false;
    const target = { id:u.id, role:u.role, roleKey:u.role_key, branchId:u.branch_id, departmentId:u.department_id, dataScope:u.data_scope, permissions };
    if (!can(target, 'requests:read')) return false;
    const scope = requestScope(target);
    return Boolean(one(ctx.db, `SELECT r.id FROM requests r WHERE r.id=?${scope.sql ? ' AND ' + scope.sql : ''}`, [request.id, ...scope.params]));
  }).map(({ id, name }) => ({ id, name }));
  // The active delegated context may differ from the user's primary branch.
  if (!allowed.some((u) => u.id === ctx.user.id)) allowed.unshift({ id:ctx.user.id, name:ctx.user.name });
  return allowed;
}
function followUp(ctx) {
  const row = one(ctx.db, 'SELECT * FROM request_follow_ups WHERE id=?', [Number(ctx.params.id)]);
  if (!row) throw new HttpError(404, 'المتابعة غير موجودة');
  scopedRequest(ctx, row.request_id);
  return row;
}
export function listFollowUps(ctx) {
  const scope = requestScope(ctx.user);
  const conditions = scope.sql ? [scope.sql] : [];
  const params = [...scope.params];
  if (ctx.params.id) { scopedRequest(ctx, ctx.params.id); conditions.push('f.request_id=?'); params.push(Number(ctx.params.id)); }
  else if (ctx.query.assigned !== 'team' || !can(ctx.user, 'requests:assign')) { conditions.push('f.assigned_to=?'); params.push(ctx.user.id); }
  const status = ctx.query.status || 'open';
  if (!['open','done','cancelled','all'].includes(status)) throw new HttpError(422, 'حالة المتابعة غير صالحة');
  if (status !== 'all') { conditions.push('f.status=?'); params.push(status); }
  if (ctx.query.due === 'overdue') conditions.push("julianday(f.due_at)<julianday('now')");
  else if (ctx.query.due === 'next24h') conditions.push("julianday(f.due_at)>=julianday('now') AND julianday(f.due_at)<julianday('now','+1 day')");
  else if (ctx.query.due) throw new HttpError(422, 'مرشح الموعد غير صالح');
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(ctx.query.page)) || 1));
  const from = ' FROM request_follow_ups f JOIN requests r ON r.id=f.request_id LEFT JOIN users u ON u.id=f.assigned_to';
  const total = one(ctx.db, 'SELECT COUNT(*) AS n' + from + where, params).n;
  const rows = q(ctx.db, `SELECT f.*,r.reference,u.name AS assignee_name,
    CASE WHEN f.status='open' AND julianday(f.due_at)<julianday('now') THEN 1 ELSE 0 END AS overdue` + from + where + ' ORDER BY julianday(f.due_at),f.id LIMIT 25 OFFSET ?', [...params, (page-1)*25]);
  return json(ctx.res, 200, { ok:true, followUps:rows, total, page, pages:Math.max(1,Math.ceil(total/25)), ...(ctx.params.id ? { assignees:candidates(ctx, scopedRequest(ctx,ctx.params.id)) } : {}) });
}
export async function createFollowUp(ctx) {
  const request = scopedRequest(ctx, ctx.params.id);
  const body = await readJson(ctx.req, 8192);
  const note = String(body.note || '').trim();
  if (note.length < 3 || note.length > 2000) throw new HttpError(422, 'وصف المتابعة مطلوب (3–2000 حرف)');
  const due = String(body.dueAt || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(due) || !Number.isFinite(Date.parse(due))) throw new HttpError(422, 'الموعد غير صالح؛ يجب أن يتضمن المنطقة الزمنية');
  const dueAt = new Date(due).toISOString();
  const datePart = due.slice(0,10);
  // Date.parse rolls an impossible calendar date into the next month.
  if (new Date(datePart).toISOString().slice(0,10) !== datePart) throw new HttpError(422, 'تاريخ غير موجود');
  const assignedTo = body.assignedTo === undefined ? ctx.user.id : Number(body.assignedTo);
  if (!Number.isInteger(assignedTo) || !candidates(ctx, request).some((u) => u.id === assignedTo)) throw new HttpError(422, 'اختر مسؤول متابعة مخولًا بالوصول إلى الطلب');
  const id = transaction(ctx.db, () => {
    const result = exec(ctx.db, 'INSERT INTO request_follow_ups(request_id,assigned_to,due_at,note,created_by,created_at) VALUES(?,?,?,?,?,?)', [request.id, assignedTo, dueAt, note, ctx.user.id, isoNow()]);
    const id = Number(result.lastInsertRowid);
    addEvent(ctx.db, request.id, { kind:'follow_up', message:'إضافة متابعة', actorId:ctx.user.id, actorName:ctx.user.name, meta:{ followUpId:id, assignedTo, dueAt } });
    audit(ctx.db, { user:ctx.user, action:'follow-up.create', entity:'request_follow_up', entityId:id, meta:{ requestId:request.id, assignedTo, dueAt }, ip:ctx.ip });
    return id;
  }, { immediate:true });
  return json(ctx.res, 201, { ok:true, id });
}
export async function finishFollowUp(ctx) {
  const row = followUp(ctx);
  const body = await readJson(ctx.req, 4096);
  if (!['done','cancelled'].includes(body.status)) throw new HttpError(422, 'اختر مكتملة أو ملغاة');
  if (row.assigned_to !== ctx.user.id && !can(ctx.user, 'requests:assign')) throw new HttpError(403, 'يمكن للمسؤول عن المتابعة أو مدير الإسناد إنهاؤها');
  const reason = String(body.reason || '').trim();
  if (reason.length < 3 || reason.length > 500) throw new HttpError(422, 'نتيجة المتابعة أو سبب الإلغاء مطلوب (3–500 حرف)');
  transaction(ctx.db, () => {
    const updated = exec(ctx.db, "UPDATE request_follow_ups SET status=?,completed_by=?,completed_at=? WHERE id=? AND status='open'", [body.status, ctx.user.id, isoNow(), row.id]);
    if (!updated.changes) throw new HttpError(409, 'تم إنهاء المتابعة مسبقًا؛ حدّث القائمة');
    addEvent(ctx.db, row.request_id, { kind:'follow_up', message:(body.status==='done'?'اكتملت المتابعة: ':'أُلغيت المتابعة: ')+reason, actorId:ctx.user.id, actorName:ctx.user.name, meta:{ followUpId:row.id, reason } });
    audit(ctx.db, { user:ctx.user, action:'follow-up.'+body.status, entity:'request_follow_up', entityId:row.id, meta:{ from:row.status, to:body.status, reason }, ip:ctx.ip });
  }, { immediate:true });
  return json(ctx.res, 200, { ok:true });
}
