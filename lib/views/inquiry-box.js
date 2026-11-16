/* صندوق «طلب فندق بديل أو الاستفسار عن العرض» — الجزء المعروض فقط.
   لا يصدر هذا الملف أي قرار عمل: النص النهائي لواتساب والتحقق والكتابة في القاعدة
   كلها في lib/inquiries.js، والمتصفح يتحدث إلى POST /api/inquiries عبر
   public/assets/js/inquiry-box.js. الحقن: layout.js يضيف inquiryDialog() لكل صفحة عامة،
   و/p/:slug (offer-micro.js) يحقنها بنفسه لأنه لا يستخدم layout().

   ملاحظة معمارية: لا نستورد icon() من layout.js هنا تجنباً لدورة استيراد
   (layout.js يستورد هذا الملف). الأيقونة إيموجي بهوية الصندوق كما في المواصفة. */

import { attr, esc, money } from '../util.js';

export const INQUIRY_BRANCH_FALLBACK = {
  amman: { name: 'فرع عمّان', phone: '06-4600777' },
  irbid: { name: 'فرع إربد', phone: '02-7244112' },
};

const CONSENT_HTML = 'أوافق على حفظ بياناتي للتواصل معي بخصوص هذا الاستفسار، وعلى <a href="/privacy" target="_blank" rel="noopener">سياسة الخصوصية</a>.';

/* سياق البرنامج/العرض كما يظهر في رأس الصندوق وفي البيانات المرسلة.
   نفس الأسماء data-iq-* يقرأها public/assets/js/inquiry-box.js دون تغيير. */
function contextAttrs(item) {
  const hotels = Array.isArray(item?.hotels) ? item.hotels : [];
  const hotel = String(hotels[0]?.name || item?.currentHotel || item?.hotel || '').trim();
  const duration = item?.days
    ? `${item.days} أيام / ${item.nights || 0} ليالٍ`
    : String(item?.duration || '').trim();
  const amount = Number(item?.price_from ?? item?.price ?? 0);
  const price = Number.isFinite(amount) && amount > 0 ? money(amount, item?.currency || 'د.أ') : '';
  return {
    'data-inquiry-open': '',
    'data-iq-slug': item?.slug || '',
    'data-iq-id': item?.id || '',
    'data-iq-title': item?.title || '',
    'data-iq-hotel': hotel,
    'data-iq-duration': duration,
    'data-iq-price': price,
    'data-iq-category': item?.category || '',
  };
}

function renderAttrs(map) {
  return Object.entries(map).map(([key, value]) => `${key}="${attr(value)}"`).join(' ');
}

/* زر الفتح — variants: card (داخل البطاقة) · page (داخل لوحة) · block (بعرض كامل). */
export function inquiryButton(item, { variant = 'card', label = 'اطلب فندق آخر / استفسر' } = {}) {
  const classes = ['btn', 'btn-inquiry'];
  if (variant !== 'page') classes.push('btn-sm');
  if (variant === 'block') classes.push('btn-block');
  return `<button class="${classes.join(' ')}" type="button" ${renderAttrs(contextAttrs(item))}>
    <span aria-hidden="true">🏨</span> ${esc(label)}
  </button>`;
}

/* قسم قابل للطي داخل صفحة البرنامج — المواصفة تطلب «قسم قابل للتوسّع أسفل جدول الأسعار». */
export function inquiryPanel(item) {
  return `<div class="panel inquiry-panel">
    <span class="inquiry-kicker">🏨 عرض بديل</span>
    <h2 style="font-size:20px">تخصيص العرض أو السؤال عن فندق آخر</h2>
    <p class="muted" style="font-size:13.5px;margin:0">تريد نفس البرنامج بفندق آخر، أو تاريخاً غير المنشور، أو عرض سعر لعائلة؟ اكتب طلبك هنا ويصلك رد الفريق على واتساب — بلا التزام.</p>
    <details class="inquiry-more">
      <summary>ما الذي يمكنني طلبه؟</summary>
      <ul>
        <li>نفس البرنامج والمدة بفندق مختلف (بنفس المستوى أو أعلى).</li>
        <li>الاستفسار عن توافر غرف أو تواريخ سفر بديلة.</li>
        <li>عرض سعر خاص لعائلة أو مجموعة بعدد أشخاص وأطفال محدد.</li>
      </ul>
    </details>
    <div class="btn-row">${inquiryButton(item, { variant: 'page', label: 'تخصيص البرنامج / طلب فندق آخر' })}</div>
    <p class="field-hint" style="margin:0">الطلب استفسار وليس حجزاً مؤكداً؛ السعر المعتمد هو الصادر في عرض رسمي من لوريت.</p>
  </div>`;
}

/* أرقام الفروع الأرضية للعرض داخل الحبوب، مع بديل ثابت إن لم تُضبط الإعدادات. */
function branchChoices(settings) {
  const list = Array.isArray(settings?.branches) ? settings.branches : [];
  return ['amman', 'irbid'].map((code) => {
    const fallback = INQUIRY_BRANCH_FALLBACK[code];
    const needle = code === 'amman' ? 'عمّان' : 'إربد';
    const match = list.find((branch) => String(branch?.name || '').includes(needle));
    const name = String(match?.name || fallback.name);
    const phone = String(match?.phone || fallback.phone);
    return `<label class="choice inquiry-branch"><input type="radio" name="branch" value="${code}"><span>${esc(name)} <small dir="ltr">${esc(phone)}</small></span></label>`;
  }).join('');
}

/* النافذة: تُحقن مرة واحدة في كل صفحة. كل العناصر التي يحركها السكربت لها id ثابت. */
export function inquiryDialog(settings) {
  return `<div class="modal-backdrop inquiry-modal" id="inquiryModal" hidden>
  <div class="modal-card inquiry-card" role="dialog" aria-modal="true" aria-labelledby="inquiryTitle" aria-describedby="inquirySub">
    <button class="modal-close" type="button" data-inquiry-close aria-label="إغلاق">×</button>
    <span class="inquiry-kicker">🏨 صندوق الفندق البديل</span>
    <h3 id="inquiryTitle">تخصيص العرض أو السؤال عن فندق آخر</h3>
    <p class="modal-sub" id="inquirySub">حدّد ما يناسبك، ويصلك رد فريق لوريت على واتساب خلال ساعات العمل.</p>

    <div class="inquiry-context" aria-live="polite">
      <div class="inquiry-context-title"><span>البرنامج المحدد</span><b data-iq-view="title">—</b></div>
      <dl class="inquiry-context-grid">
        <div><dt>الفندق الحالي</dt><dd data-iq-view="hotel">—</dd></div>
        <div><dt>المدة</dt><dd data-iq-view="duration">—</dd></div>
        <div><dt>السعر الأساسي</dt><dd data-iq-view="price">—</dd></div>
      </dl>
    </div>

    <form id="inquiryForm" novalidate>
      <input type="hidden" name="slug" value="">
      <input type="hidden" name="programId" value="">
      <input type="hidden" name="category" value="">

      <fieldset class="inquiry-fieldset">
        <legend>نوع الطلب</legend>
        <div class="inquiry-pills">
          <label class="choice inquiry-pill"><input type="radio" name="inquiryType" value="alternative_hotel" checked><span>🏨 أريد نفس البرنامج بفندق آخر</span></label>
          <label class="choice inquiry-pill"><input type="radio" name="inquiryType" value="availability"><span>📅 الاستفسار عن تواريخ أو توافر غرف</span></label>
          <label class="choice inquiry-pill"><input type="radio" name="inquiryType" value="group_quote"><span>👨‍👩‍👧‍👦 طلب عرض سعر خاص لعائلة / مجموعة</span></label>
        </div>
      </fieldset>

      <div class="field">
        <label for="inquiryNotes">الفندق المطلوب / ملاحظات</label>
        <textarea id="inquiryNotes" name="notes" rows="3" maxlength="600" placeholder="اكتب اسم الفندق المطلوب (مثلاً: دار التوحيد، سويس أوتيل، فندق 5 نجوم مطـ...) أو عدد الأشخاص والأطفال"></textarea>
        <span class="field-hint">اختياري — لكنه يسرّع الرد كثيراً.</span>
      </div>

      <div class="form-grid">
        <div class="field">
          <label for="inquiryName">الاسم الكامل <b class="req">*</b></label>
          <input id="inquiryName" name="name" required maxlength="80" autocomplete="name" placeholder="مثال: أحمد محمد">
        </div>
        <div class="field">
          <label for="inquiryPhone">رقم الواتساب / الهاتف <b class="req">*</b></label>
          <input id="inquiryPhone" name="phone" type="tel" required dir="ltr" inputmode="tel" autocomplete="tel" placeholder="0791234567">
        </div>
      </div>

      <fieldset class="inquiry-fieldset">
        <legend>الفرع الأقرب للتواصل <small class="inquiry-optional">(اختياري)</small></legend>
        <div class="choice-row inquiry-branches">${branchChoices(settings)}</div>
      </fieldset>

      <label class="check inquiry-consent">
        <input type="checkbox" name="consent" required>
        <span>${CONSENT_HTML}</span>
      </label>

      <button class="btn btn-primary btn-block inquiry-submit" type="submit">إرسال الطلب والاستفسار</button>
      <p class="form-status" id="inquiryStatus" role="status" aria-live="polite"></p>
    </form>

    <div class="inquiry-success" id="inquirySuccess" hidden>
      <div class="inquiry-success-mark" aria-hidden="true">✓</div>
      <h4>تم استلام استفسارك</h4>
      <p class="muted">احتفظ بالرقم المرجعي للمتابعة، أو أرسل التفاصيل الآن عبر واتساب ليصل الاستفسار فوراً لفريق المبيعات.</p>
      <div class="inquiry-ref" id="inquiryRef" dir="ltr"></div>
      <a class="btn btn-wa btn-block" id="inquiryWa" href="#" target="_blank" rel="noopener">إرسال التفاصيل مباشرة عبر واتساب الآن 💬</a>
      <button class="btn btn-ghost btn-block" type="button" data-inquiry-close>إغلاق</button>
      <p class="field-hint" style="text-align:center;margin:0">فتح واتساب اختياري — استفسارك محفوظ لدى الفريق حتى لو لم ترسله.</p>
    </div>
  </div>
</div>`;
}
