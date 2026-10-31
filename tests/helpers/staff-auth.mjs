import assert from "node:assert/strict";
import { totp } from "../../lib/staff-mfa.js";
process.env.STAFF_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const recovery = new Map();
export async function staffLogin(base, username, password) {
  async function post(path, body, cookie) {
    const res = await fetch(base + path, {
      method: "POST",
      headers: {
        origin: base,
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    return {
      res,
      payload: await res.json(),
      cookie: (res.headers.get("set-cookie") || "").split(";")[0],
    };
  }
  let result = await post("/api/auth/login", { username, password });
  if (result.payload.user?.mustChange) {
    const old = result.cookie;
    assert.equal(
      (await fetch(base + "/api/admin/overview", { headers: { cookie: old } }))
        .status,
      403,
    );
    const next = password + "-Changed42";
    assert.equal(
      (
        await post(
          "/api/auth/change-password",
          { currentPassword: password, newPassword: next },
          old,
        )
      ).res.status,
      200,
    );
    assert.equal(
      (await fetch(base + "/api/admin/overview", { headers: { cookie: old } }))
        .status,
      401,
    );
    password = next;
    result = await post("/api/auth/login", { username, password });
  }
  if (result.payload.mfaChallenge) {
    const code = recovery.get(base + username)?.shift();
    assert.ok(code, "A test recovery code is required for a second MFA login");
    result = await post("/api/auth/mfa/verify", {
      challenge: result.payload.challenge,
      code,
    });
    if (result.res.status === 200) {
      const me = await fetch(base + "/api/auth/me", {
        headers: { cookie: result.cookie },
      });
      result.payload.user = (await me.json()).user;
    }
  }
  if (result.payload.user?.mfaRequired && !result.payload.user.mfaVerified) {
    const setup = await post(
      "/api/auth/mfa/setup",
      { password },
      result.cookie,
    );
    assert.equal(setup.res.status, 200);
    const confirm = await post(
      "/api/auth/mfa/confirm",
      { code: totp(setup.payload.secret) },
      result.cookie,
    );
    assert.equal(confirm.res.status, 200);
    recovery.set(base + username, confirm.payload.recoveryCodes);
    const me = await fetch(base + "/api/auth/me", {
      headers: { cookie: result.cookie },
    });
    result.payload.user = (await me.json()).user;
  }
  return { ...result, password };
}
