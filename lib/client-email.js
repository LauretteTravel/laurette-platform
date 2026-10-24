function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendClientOtp({ email, name, code }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error('Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.');

  const safeName = escapeHtml(name);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'رمز تأكيد بريدك الإلكتروني — لوريت',
      text: `مرحبًا ${name}، رمز تأكيد بريدك في لوريت هو ${code}. تنتهي صلاحيته خلال 10 دقائق. إذا لم تطلب هذا الرمز فتجاهل الرسالة.`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:520px;margin:24px auto;color:#14263a"><h2>مرحبًا ${safeName}</h2><p>أدخل الرمز التالي لتأكيد بريدك الإلكتروني:</p><p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#0b2a43">${code}</p><p>تنتهي صلاحية الرمز خلال 10 دقائق. إذا لم تطلب هذا الرمز فتجاهل الرسالة.</p></div>`,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Email provider rejected the verification message (${response.status}): ${detail.slice(0, 300)}`);
  }
}
