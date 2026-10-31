import { can } from "./auth.js";
import { json } from "./http.js";

/** Central employee API gate; public and customer APIs keep their own authentication. */
export function withApiAuthorization(
  handler,
  { auth = false, action = null } = {},
) {
  const guarded = (ctx) => {
    if ((auth || action) && !ctx.user) return json(ctx.res, 401, { ok: false, message: 'يلزم تسجيل الدخول' });
    if (action && ctx.user.mustChange) return json(ctx.res, 403, { ok: false, message: 'غيّر كلمة المرور المؤقتة للمتابعة' });
    if (action && ctx.user.mfaRequired && !ctx.user.mfaVerified)
      return json(ctx.res, 403, {
        ok: false,
        code: "MFA_REQUIRED",
        message: "أكمل المصادقة الثنائية للمتابعة",
      });
    if (action && !can(ctx.user, action)) return json(ctx.res, 403, { ok: false, message: 'لا تملك صلاحية لهذا الإجراء' });
    return handler(ctx);
  };
  guarded.requiredAction = action;
  return guarded;
}
