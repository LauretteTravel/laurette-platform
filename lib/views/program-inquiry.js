import { attr, esc } from '../util.js';

export function programInquiryLink(program, label = '🏨 اطلب فندق آخر / استفسر') {
  return `<a class="btn btn-sm pi-trigger" href="/programs/${attr(program.slug)}#program-inquiry" data-program-inquiry="${attr(program.slug)}">${esc(label)}</a>`;
}

export function programInquiryDialog() {
  return `<dialog class="pi-dialog" id="programInquiryDialog" dir="rtl" aria-labelledby="pi-title">
    <div class="pi-head"><h2 id="pi-title">تخصيص العرض أو السؤال عن فندق آخر</h2>
      <form method="dialog"><button class="btn btn-ghost btn-sm">إغلاق</button></form>
    </div>
    <div class="pi-content">
      <p id="pi-loading" role="status"></p>
      <div id="pi-context" class="pi-context" hidden></div>
      <div id="pi-details" hidden></div>
      <details id="pi-box" hidden>
        <summary>تخصيص العرض أو السؤال عن فندق آخر</summary>
        <form id="pi-form" method="post">
          <input type="hidden" name="program_id"><input type="hidden" name="category">
          <fieldset><legend>بماذا يمكننا مساعدتك؟</legend><div class="pi-pills">
            <label><input type="radio" name="inquiry_type" value="alternative_hotel" checked><span>🏨 أريد نفس البرنامج بفندق آخر</span></label>
            <label><input type="radio" name="inquiry_type" value="availability"><span>📅 الاستفسار عن تواريخ أو توافر غرف</span></label>
            <label><input type="radio" name="inquiry_type" value="group_quote"><span>👨‍👩‍👧‍👦 طلب عرض سعر خاص لعائلة / مجموعة</span></label>
          </div></fieldset>
          <label class="pi-field">الفندق المطلوب / ملاحظات <textarea name="requested_hotel_notes" rows="3" maxlength="1000" placeholder="اكتب اسم الفندق المطلوب (مثلاً: دار التوحيد، سويس أوتيل، فندق 5 نجوم مطل...) أو عدد الأشخاص والأطفال"></textarea></label>
          <div class="pi-contact">
            <label class="pi-field">الاسم الكامل <input name="customer_name" autocomplete="name" minlength="2" maxlength="100" required></label>
            <label class="pi-field">رقم الواتساب / الهاتف <input name="customer_phone" type="tel" autocomplete="tel" maxlength="40" placeholder="0791234567 أو +962791234567" dir="ltr" required></label>
          </div>
          <fieldset><legend>الفرع الأقرب للتواصل (اختياري)</legend><div class="pi-pills">
            <label><input type="radio" name="preferred_branch" value="" checked><span>أي فرع</span></label>
            <label><input type="radio" name="preferred_branch" value="amman"><span>عمّان <bdi>064600777</bdi></span></label>
            <label><input type="radio" name="preferred_branch" value="irbid"><span>إربد <bdi>027244112</bdi></span></label>
          </div></fieldset>
          <p class="muted">سنستخدم اسمك ورقمك للرد على هذا الاستفسار. <a href="/privacy">سياسة الخصوصية</a></p>
          <p id="pi-feedback" role="status"></p>
          <button class="btn btn-primary pi-send" type="submit">إرسال الطلب والاستفسار</button>
        </form>
      </details>
      <section id="pi-success" hidden aria-live="polite">
        <h3 tabindex="-1">تم استلام استفسارك</h3>
        <p></p><a class="btn btn-wa" target="_blank" rel="noopener noreferrer">إرسال التفاصيل مباشرة عبر واتساب الآن 💬</a>
      </section>
    </div>
  </dialog>`;
}
