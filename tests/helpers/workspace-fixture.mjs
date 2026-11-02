import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { createApp } from "../../server.js";
import { hashPassword, createSession } from "../../lib/auth.js";
import { ammanDay, dayStart } from "../../lib/report-time.js";

export async function workspaceFixture() {
  for (const key of [
    "N8N_BOOKING_WEBHOOK_URL",
    "N8N_WEBHOOK_URL",
    "N8N_BOOKING_WEBHOOK_SECRET",
    "N8N_API_KEY",
    "N8N_WEBHOOK_KEY",
    "TASK_ATTACHMENT_UPLOADS_ENABLED",
    "PROGRAM_SOURCE_UPLOADS_ENABLED",
  ])
    delete process.env[key];
  process.env.WHATSAPP_NOTIFICATIONS_ENABLED = "0";
  const seed = JSON.parse(readFileSync("data/seed.json", "utf8"));
  const app = createApp({
      dbFile: ":memory:",
      seed: {
        ...seed,
        settings: { ...seed.settings, whatsapp: "+962790000000" },
        users: [],
      },
      adminPassword: "Synthetic-Workspace-Browser42",
      baseUrl: "http://127.0.0.1:0",
    }),
    db = app.db;
  const now = new Date().toISOString(),
    today = ammanDay(now),
    start = Date.parse(dayStart(today));
  const [branch, otherBranch] = db
      .prepare("SELECT id FROM branches ORDER BY id LIMIT 2")
      .all()
      .map((r) => r.id),
    dept = db
      .prepare("SELECT id FROM departments WHERE branch_id IS NULL LIMIT 1")
      .get().id,
    pw = hashPassword("Synthetic-Workspace-Browser42");
  function actor(key, name, scope, permissions, unit = branch) {
    db.prepare(
      "INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ).run(key, key, "agent", scope, JSON.stringify(permissions), now, now);
    const id = Number(
      db
        .prepare(
          "INSERT INTO users(username,name,role,role_key,branch_id,department_id,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(key, name, "agent", key, unit, dept, pw.hash, pw.salt, now)
        .lastInsertRowid,
    );
    return {
      id,
      key,
      name,
      token: createSession(db, id, "127.0.0.1", "synthetic", {
        mfaVerified: true,
      }).token,
    };
  }
  const owner = actor(
    "workspace-reviewer",
    "إبراهيم — اختبار",
    "organization",
    ["*"],
  );
  const reader = actor(
    "workspace-reader",
    "موظف اختبار محدود",
    "assigned",
    ["overview:read", "requests:read", "customers:read", "tasks:read"],
    otherBranch,
  );
  const places = ["بالي", "إسطنبول", "القاهرة", "مكة", "شرم الشيخ", "العقبة"];
  const requests = [];
  for (let i = 0; i < 6; i++) {
    const customer = Number(
      db
        .prepare(
          "INSERT INTO customers(name,phone,created_at,updated_at) VALUES(?,?,?,?)",
        )
        .run(
          "عميل اختبار " + (i + 1),
          "+9627900000" + String(i + 1).padStart(2, "0"),
          now,
          now,
        ).lastInsertRowid,
    );
    const status = i === 4 ? "confirmed" : i < 2 ? "quoted" : "new",
      type = i === 3 ? "umrah" : i === 4 ? "flight" : "program";
    const id = Number(
      db
        .prepare(
          "INSERT INTO requests(reference,type,status,deal_status,customer_id,assigned_to,branch_id,department_id,payload,created_at,updated_at,quote_amount,quote_currency) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          "LRT-WORKSPACE-SYN-" + (i + 1),
          type,
          status,
          status === "confirmed" ? "won" : "new",
          customer,
          owner.id,
          branch,
          dept,
          JSON.stringify({
            destination: places[i],
            name: "عميل اختبار " + (i + 1),
          }),
          now,
          now,
          i < 2 ? 250 : null,
          "JOD",
        ).lastInsertRowid,
    );
    requests.push(id);
    db.prepare(
      "INSERT INTO request_events(request_id,actor_id,actor_name,kind,message,created_at) VALUES(?,?,?,?,?,?)",
    ).run(
      id,
      owner.id,
      "موظف اختبار",
      i < 2 ? "quote" : "created",
      i < 2
        ? "تسجيل عرض تجريبي لوجهة " + places[i]
        : "إنشاء طلب تجريبي إلى " + places[i],
      new Date(Date.now() - i * 60000).toISOString(),
    );
    if (i < 4)
      db.prepare(
        "INSERT INTO tasks(branch_id,department_id,request_id,title,priority,status,assigned_to,created_by,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        branch,
        dept,
        id,
        "متابعة ملف سفر تجريبي " + (i + 1),
        ["high", "normal", "normal", "low"][i],
        "new",
        owner.id,
        owner.id,
        new Date(start - (4 - i) * 3600000).toISOString(),
        now,
        now,
      );
    if (i < 4)
      db.prepare(
        "INSERT INTO request_follow_ups(request_id,assigned_to,due_at,note,status,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
      ).run(
        id,
        owner.id,
        new Date(start + (10 + i) * 3600000).toISOString(),
        "متابعة تجريبية موثقة",
        "open",
        owner.id,
        now,
      );
  }
  for (const kind of ["flight", "hotel"]) {
    const id = randomUUID(),
      date = new Date(Date.now() + 2 * 86400000),
      json = JSON.stringify({
        format: 1,
        kind,
        reference: "SYN-" + kind,
        data:
          kind === "flight"
            ? { flight: { segments: [{ departAt: date.toISOString() }] } }
            : { hotel: { checkIn: ammanDay(date) } },
      });
    db.prepare(
      "INSERT INTO voucher_bookings(id,request_id,kind,created_by,created_at) VALUES(?,?,?,?,?)",
    ).run(id, requests[4], kind, owner.id, now);
    db.prepare(
      "INSERT INTO employee_vouchers(id,reference,kind,booking_id,status,revision,current_version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,1,0,?,?,?)",
    ).run(id, "SYN-" + kind, kind, id, "issued", owner.id, now, now);
    db.prepare(
      "INSERT INTO voucher_versions(voucher_id,version,snapshot_json,sha256,issued_by,issued_at) VALUES(?,1,?,?,?,?)",
    ).run(
      id,
      json,
      createHash("sha256").update(json).digest("hex"),
      owner.id,
      now,
    );
    db.prepare("UPDATE employee_vouchers SET current_version=1 WHERE id=?").run(
      id,
    );
  }
  const addr = await app.listen(0, "127.0.0.1"),
    base = `http://127.0.0.1:${addr.port}`;
  const manual = {
    revision: 0,
    selected: ["USD", "EUR", "GBP", "SAR", "AED", "TRY"],
    overrides: [
      ["USD", 0.71],
      ["EUR", 0.78],
      ["GBP", 0.91],
      ["SAR", 0.189],
      ["AED", 0.193],
      ["TRY", 0.024],
    ].map(([code, value]) => ({
      code,
      value,
      source: "مصدر يدوي مصطنع لا يمثل سعر سوق",
      asOf: now,
      validUntil: new Date(Date.now() + 6 * 3600000).toISOString(),
    })),
    reason: "اعتماد يدوي مصطنع لاختبار الواجهة فقط",
  };
  const result = await fetch(base + "/api/admin/exchange-rates", {
    method: "PATCH",
    headers: {
      origin: base,
      "content-type": "application/json",
      cookie: "lt_session=" + owner.token,
    },
    body: JSON.stringify(manual),
  });
  if (result.status !== 200)
    throw Error("Synthetic currency setup failed: " + result.status);
  return {
    app,
    db,
    base,
    owner,
    reader,
    requests,
    password: "Synthetic-Workspace-Browser42",
  };
}
