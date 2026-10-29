import fs from 'node:fs';

const p = 'docs/n8n-smtp-setup.md';
let t = fs.readFileSync(p, 'utf8');
if (t.includes('## 9. مزامنة الحالة')) {
  console.log('already documented');
  process.exit(0);
}

const add = `

---

## 9. مزامنة الحالة مع الشيت (إصلاح تصعيد 24 ساعة)

**المشكلة:** التصعيد يقرأ عمود \`Status\` في الشيت، فلو أُغلق الطلب في لوحة الإدارة ولم يُغلق في الشيت، سيصعّده n8n خطأً.

**الحل المنفّذ:** الموقع يرسل ثلاثة أحداث إلى نفس الويبهوك:

| الحدث | متى | أهم الحقول |
|---|---|---|
| \`booking.created\` | إنشاء طلب | \`reference, type, customer, details\` |
| \`booking.status_changed\` | كل تغيير حالة من اللوحة | \`from, to, toLabel, dealStatus, closed, quoteAmount, actor\` |
| \`booking.quoted\` | تسجيل أو تعديل عرض سعر | \`amount, currency, status\` |

**القاعدة في الشيت:**
- ابحث عن الصف بالمفتاح \`reference\` (ثابت لا يتغير).
- اكتب \`Status\` = \`toLabel\`، وعمود \`Closed\` = \`closed\`.
- شرط تصعيد الـ24 ساعة: \`Closed = FALSE\` **و** \`Status\` ليست «مكتمل» ولا «ملغى».
- عند \`closed = true\` (confirmed/cancelled) أوقف أي تصعيد لهذا الصف.

**المرجعية:** قاعدة الموقع هي المصدر الرسمي. إن تعارض الشيت مع اللوحة فالصحيح هو اللوحة، ويُعاد ضبط الشيت بأول حدث قادم.

### ترويسة X-API-Key (إن استخدمت وسيطًا)

إن كان لديك وسيط Proxy يتحقق من مفتاح ثابت، أضف \`N8N_API_KEY\` في Render — سيُرسل الموقع \`x-api-key\` تلقائيًا **مع** توقيع HMAC. التوقيع يبقى الأساس، والمفتاح للتوافق مع الوسيط فقط.

> ملاحظة معمارية: الموقع نفسه خادم Node، لذا **لا حاجة** لوسيط Express منفصل — الإرسال يتم من الخادم مباشرة، بلا CORS وبلا تعريض أي مفتاح للمتصفح. كود الوسيط الذي أُرسل يمكن الاستغناء عنه بالكامل.
`;

fs.writeFileSync(p, `${t.trimEnd()}${add}`, 'utf8');
console.log('doc updated', fs.statSync(p).size);
