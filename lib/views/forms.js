import { esc, attr } from '../util.js';
import { icon } from './layout.js';

const input = ({ name, label, type = 'text', required = false, placeholder = '', hint = '', value = '', min, max, autocomplete = '', full = false, dir = '' }) => `
<div class="field${full ? ' field-full' : ''}" data-field-wrap="${attr(name)}">
  <label for="f-${attr(name)}">${esc(label)}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
  <input id="f-${attr(name)}" name="${attr(name)}" type="${attr(type)}" ${required ? 'required' : ''} ${min !== undefined ? `min="${attr(min)}"` : ''} ${max !== undefined ? `max="${attr(max)}"` : ''} ${autocomplete ? `autocomplete="${attr(autocomplete)}"` : ''} ${dir ? `dir="${attr(dir)}"` : ''} placeholder="${attr(placeholder)}" value="${attr(value)}">
  ${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}
  <span class="field-error" data-error-for="${attr(name)}" role="alert"></span>
</div>`;

const select = ({ name, label, options, value = '', required = false, full = false, hint = '' }) => `
<div class="field${full ? ' field-full' : ''}" data-field-wrap="${attr(name)}">
  <label for="f-${attr(name)}">${esc(label)}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
  <select id="f-${attr(name)}" name="${attr(name)}" ${required ? 'required' : ''}>
    ${options.map(([v, l]) => `<option value="${attr(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}
  </select>
  ${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}
  <span class="field-error" data-error-for="${attr(name)}" role="alert"></span>
</div>`;

const textarea = ({ name, label, placeholder = '', required = false, full = true, rows = 4, value = '', hint = '' }) => `
<div class="field${full ? ' field-full' : ''}" data-field-wrap="${attr(name)}">
  <label for="f-${attr(name)}">${esc(label)}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
  <textarea id="f-${attr(name)}" name="${attr(name)}" rows="${rows}" placeholder="${attr(placeholder)}" ${required ? 'required' : ''}>${esc(value)}</textarea>
  ${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}
  <span class="field-error" data-error-for="${attr(name)}" role="alert"></span>
</div>`;

const paxFields = (adults = 2) => `
<div class="form-grid-3">
  ${input({ name: 'adults', label: 'البالغون', type: 'number', value: adults, min: 1, max: 30, required: true })}
  ${input({ name: 'children', label: 'الأطفال (2–11)', type: 'number', value: 0, min: 0, max: 20 })}
  ${input({ name: 'infants', label: 'الرضّع (أقل من 2)', type: 'number', value: 0, min: 0, max: 10 })}
</div>`;

export function contactFields() {
  return `<div class="form-grid">
    ${input({ name: 'name', label: 'الاسم الكامل', required: true, autocomplete: 'name', placeholder: 'مثال: أحمد محمد' })}
    ${input({ name: 'phone', label: 'رقم الهاتف / واتساب', type: 'tel', required: true, autocomplete: 'tel', dir: 'ltr', placeholder: '0791234567', hint: 'نستخدمه للتواصل بشأن طلبك فقط.' })}
    ${input({ name: 'email', label: 'البريد الإلكتروني (اختياري)', type: 'email', autocomplete: 'email', dir: 'ltr', placeholder: 'name@example.com' })}
    ${input({ name: 'city', label: 'المدينة (اختياري)', placeholder: 'عمّان / إربد' })}
  </div>`;
}

export function consentField() {
  return `<div class="field field-full" data-field-wrap="consent">
    <label class="check" for="f-consent">
      <input id="f-consent" type="checkbox" name="consent" required>
      <span>أوافق على حفظ بياناتي للتواصل معي بخصوص هذا الطلب، وعلى <a href="/privacy" target="_blank">سياسة الخصوصية</a>. لا تُشارك بياناتي مع أي جهة خارجية إلا لإتمام الخدمة.</span>
    </label>
    <span class="field-error" data-error-for="consent" role="alert"></span>
  </div>`;
}

export function submitBar(label = 'إرسال الطلب', note = '') {
  return `<div class="field field-full">
    <button class="btn btn-primary btn-lg btn-block" type="submit">${esc(label)}</button>
    <p class="field-hint" style="text-align:center;margin:8px 0 0">${esc(note || 'بإرسال الطلب تحصل على رقم مرجعي فوري، ويصل الطلب إلى فريق لوريت. الطلب ليس حجزًا مؤكدًا.')}</p>
    <p class="form-status" data-form-status role="status" aria-live="polite"></p>
  </div>`;
}

export function flightForm(query = {}) {
  const trip = String(query.tripType || 'return');
  return `<form class="request-form" data-request-type="flight" novalidate>
    <div class="form-body">
      <fieldset>
        <legend><span class="step">1</span> تفاصيل الرحلة</legend>
        <div class="choice-row" role="radiogroup" aria-label="نوع الرحلة">
          ${[['return', 'ذهاب وعودة'], ['oneway', 'ذهاب فقط'], ['multi', 'وجهات متعددة']].map(([v, l]) => `
            <label class="choice"><input type="radio" name="tripType" value="${v}" ${trip === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        </div>
      </fieldset>

      <div data-trip-panel="simple">
        <div class="form-grid">
          ${input({ name: 'origin', label: 'مطار المغادرة', required: true, placeholder: 'عمّان (AMM)', value: query.origin || 'عمّان (AMM)', hint: 'اكتب المدينة أو رمز المطار.' })}
          ${input({ name: 'destination', label: 'مطار الوصول', required: true, placeholder: 'إسطنبول (IST)', value: query.destination || '' })}
          ${input({ name: 'departDate', label: 'تاريخ السفر', type: 'date', required: true, value: query.departDate || '' })}
          ${input({ name: 'returnDate', label: 'تاريخ العودة', type: 'date', value: query.returnDate || '' })}
        </div>
      </div>

      <div data-trip-panel="multi" hidden>
        <div class="stack" data-segments>
          ${[0, 1].map((i) => `<div class="form-grid-3" data-segment>
            ${input({ name: `segFrom${i}`, label: `من (المسار ${i + 1})`, placeholder: 'عمّان', value: i === 0 ? 'عمّان' : '' })}
            ${input({ name: `segTo${i}`, label: `إلى (المسار ${i + 1})`, placeholder: 'إسطنبول' })}
            ${input({ name: `segDate${i}`, label: `التاريخ (المسار ${i + 1})`, type: 'date' })}
          </div>`).join('')}
        </div>
        <button type="button" class="btn btn-ghost btn-sm mt-2" data-add-segment>+ إضافة مسار</button>
        <p class="field-hint">حتى 4 مسارات. تُراجع الأسعار حسب توافر الشركات.</p>
      </div>

      <fieldset>
        <legend><span class="step">2</span> المسافرون والدرجة</legend>
        ${paxFields(2)}
        <div class="form-grid mt-2">
          ${select({ name: 'cabin', label: 'درجة السفر', options: [['economy', 'الدرجة السياحية'], ['business', 'درجة رجال الأعمال'], ['first', 'الدرجة الأولى']] })}
          ${select({ name: 'baggage', label: 'الأمتعة', options: [['standard', 'الأمتعة القياسية'], ['extra', 'أمتعة إضافية'], ['none', 'بدون أمتعة']] })}
          ${input({ name: 'airline', label: 'شركة الطيران المفضلة (اختياري)', placeholder: 'الملكية الأردنية، التركية…' })}
        </div>
      </fieldset>

      <fieldset>
        <legend><span class="step">3</span> بيانات التواصل</legend>
        ${contactFields()}
        ${textarea({ name: 'notes', label: 'ملاحظات إضافية (اختياري)', placeholder: 'مثال: مقاعد متجاورة، وجبة خاصة، مرونة في التواريخ…', rows: 3 })}
        ${consentField()}
        ${submitBar('إرسال طلب حجز الطيران', 'يراجع مختص الطيران التوافر والأسعار ويعود إليك بعرض رسمي. لا يصدر أي تذكرة قبل موافقتك.')}
      </fieldset>
    </div>
  </form>`;
}

export function hotelForm(query = {}) {
  return `<form class="request-form" data-request-type="hotel" novalidate>
    <div class="form-body">
      <fieldset>
        <legend><span class="step">1</span> الوجهة والتواريخ</legend>
        <div class="form-grid">
          ${input({ name: 'country', label: 'الدولة', required: true, placeholder: 'تركيا', value: query.country || '' })}
          ${input({ name: 'city', label: 'المدينة', required: true, placeholder: 'إسطنبول', value: query.city || '' })}
          ${input({ name: 'checkIn', label: 'تاريخ الدخول', type: 'date', required: true, value: query.checkIn || '' })}
          ${input({ name: 'checkOut', label: 'تاريخ الخروج', type: 'date', required: true, value: query.checkOut || '' })}
          ${input({ name: 'hotelName', label: 'اسم الفندق (إن كان محددًا)', placeholder: 'اختياري — يمكننا اقتراح بدائل', full: true })}
        </div>
      </fieldset>

      <fieldset>
        <legend><span class="step">2</span> الغرف والضيوف</legend>
        <div class="form-grid-3">
          ${input({ name: 'rooms', label: 'عدد الغرف', type: 'number', min: 1, max: 10, value: 1, required: true })}
          ${input({ name: 'adults', label: 'البالغون', type: 'number', min: 1, max: 20, value: 2, required: true })}
          ${input({ name: 'children', label: 'الأطفال', type: 'number', min: 0, max: 10, value: 0 })}
        </div>
        <div class="form-grid mt-2">
          ${input({ name: 'childAges', label: 'أعمار الأطفال', placeholder: 'مثال: 4، 9', hint: 'اكتب العمر مفصولًا بفاصلة لكل طفل.' })}
          ${select({ name: 'stars', label: 'تصنيف الفندق', options: [['any', 'أي تصنيف'], ['3', '3 نجوم'], ['4', '4 نجوم'], ['5', '5 نجوم']] })}
          ${select({ name: 'mealPlan', label: 'نوع الوجبات', options: [['any', 'أي خيار'], ['breakfast', 'إفطار فقط'], ['half', 'نصف إقامة'], ['full', 'إقامة كاملة'], ['none', 'بدون وجبات']] })}
          ${input({ name: 'budget', label: 'الميزانية التقريبية (اختياري)', placeholder: 'مثال: 300–450 دينار' })}
        </div>
      </fieldset>

      <fieldset>
        <legend><span class="step">3</span> بيانات التواصل</legend>
        ${contactFields()}
        ${textarea({ name: 'specialRequests', label: 'طلبات خاصة (اختياري)', placeholder: 'سرير إضافي، غرفة عالية، إطلالة، إمكانية وصول…', rows: 3 })}
        ${consentField()}
        ${submitBar('إرسال طلب حجز الفندق', 'نراجع التوافر والأسعار مع الفندق أو المورد ونرسل لك عرضًا رسميًا قبل أي دفع.')}
      </fieldset>
    </div>
  </form>`;
}

export function visaForm(query = {}) {
  return `<form class="request-form" data-request-type="visa" novalidate>
    <div class="form-body">
      <fieldset>
        <legend><span class="step">1</span> بيانات مقدم الطلب</legend>
        <div class="form-grid">
          ${input({ name: 'nationality', label: 'الجنسية', required: true, placeholder: 'أردني', value: query.nationality || 'أردني' })}
          ${input({ name: 'residence', label: 'دولة الإقامة', required: true, placeholder: 'الأردن', value: query.residence || 'الأردن' })}
          ${input({ name: 'destination', label: 'الوجهة المطلوبة', required: true, placeholder: 'تركيا', value: query.destination || '' })}
          ${select({ name: 'visaType', label: 'نوع التأشيرة', options: [['tourist', 'سياحية'], ['umrah', 'عمرة'], ['business', 'أعمال'], ['transit', 'عبور'], ['study', 'دراسة'], ['family', 'زيارة عائلية'], ['other', 'أخرى']] })}
          ${select({ name: 'purpose', label: 'الغرض من السفر', options: [['tourism', 'سياحة'], ['umrah', 'عمرة'], ['business', 'عمل'], ['visit', 'زيارة'], ['study', 'دراسة'], ['other', 'أخرى']] })}
          ${input({ name: 'travelDate', label: 'تاريخ السفر المتوقع', type: 'date', value: query.travelDate || '' })}
          ${input({ name: 'applicants', label: 'عدد المتقدمين', type: 'number', min: 1, max: 30, value: query.applicants || 1, required: true })}
          ${input({ name: 'previousVisas', label: 'تأشيرات أو إقامات سابقة ذات صلة', placeholder: 'مثال: شنغن 2024، تأشيرة تركيا 2023' })}
        </div>
      </fieldset>

      <fieldset>
        <legend><span class="step">2</span> بيانات التواصل</legend>
        ${contactFields()}
        ${textarea({ name: 'notes', label: 'ملاحظات (اختياري)', placeholder: 'أي ظروف خاصة أو مستندات لديك بالفعل.', rows: 3 })}
        <div class="form-note warn"><b>تنبيه مهم:</b> لا نضمن إصدار التأشيرة، والقرار النهائي للجهة الرسمية. لا ترسل صور الجوازات عبر هذا النموذج أو عبر روابط عامة — تُسلَّم للفرع أو عبر قناة آمنة يحددها الموظف.</div>
        ${consentField()}
        ${submitBar('طلب مراجعة التأشيرة من فريق لوريت', 'يصلك رد بالقسم المختص مع قائمة المستندات المطلوبة وحالة المتابعة.')}
      </fieldset>
    </div>
  </form>`;
}

export function consultForm(db, query = {}) {
  const topics = [
    ['trip', 'تخطيط رحلة', icon('compass', 18)],
    ['visa', 'استشارة تأشيرة', icon('visa', 18)],
    ['flight', 'حجز طيران', icon('plane', 18)],
    ['hotel', 'اختيار فندق', icon('hotel', 18)],
    ['honeymoon', 'شهر عسل', icon('spark', 18)],
    ['family', 'رحلة عائلية', icon('users', 18)],
    ['umrah', 'حج وعمرة', icon('kaaba', 18)],
    ['general', 'استفسار عام', icon('chat', 18)],
  ];
  const selected = String(query.topic || 'trip');
  return `<form class="request-form" data-request-type="consult" novalidate>
    <div class="form-body">
      <fieldset>
        <legend><span class="step">1</span> نوع الاستشارة</legend>
        <div class="choice-row" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr))">
          ${topics.map(([v, l, ic]) => `<label class="choice"><input type="radio" name="topic" value="${v}" ${selected === v ? 'checked' : ''}><span>${ic} ${l}</span></label>`).join('')}
        </div>
      </fieldset>
      <fieldset>
        <legend><span class="step">2</span> استفسارك</legend>
        ${textarea({ name: 'message', label: 'اكتب استفسارك بالتفصيل', required: true, rows: 6, placeholder: 'مثال: عائلة من 4 أفراد، نرغب بالسفر في إجازة الشتاء، الميزانية حوالي 2000 دينار…' })}
        <div class="form-grid mt-2">
          ${select({ name: 'channel', label: 'طريقة التواصل المفضلة', options: [['whatsapp', 'واتساب'], ['phone', 'مكالمة هاتفية'], ['email', 'بريد إلكتروني']] })}
          ${input({ name: 'preferredTime', label: 'وقت مناسب للتواصل (اختياري)', placeholder: 'بعد الساعة 5 مساءً' })}
        </div>
      </fieldset>
      <fieldset>
        <legend><span class="step">3</span> بياناتك</legend>
        ${contactFields()}
        ${consentField()}
        ${submitBar('إرسال الاستشارة', 'تُسجَّل الاستشارة كتذكرة داخل النظام وتُسند إلى القسم المختص مع رقم مرجعي.')}
      </fieldset>
    </div>
  </form>`;
}

export function programRequestForm(program, type = 'program') {
  const options = (program.options || []).filter((o) => Number(o.price) > 0);
  const cheapest = options.length ? options.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
  return `<form class="request-form" data-request-type="${attr(type)}" novalidate>
    <div class="form-body">
      <input type="hidden" name="programSlug" value="${attr(program.slug)}">
      <input type="hidden" name="optionLabel" value="${attr(cheapest?.label || '')}">
      <fieldset>
        <legend><span class="step">1</span> تفاصيل الطلب</legend>
        <div class="form-grid">
          ${options.length ? select({
            name: 'optionLabelVisible',
            label: 'نوع الغرفة / الخيار',
            options: options.map((o) => [o.label, `${o.label} — ${Number(o.price).toLocaleString('en-US')} ${program.currency}`]),
            value: cheapest?.label || '',
          }) : ''}
          ${input({ name: 'preferredDate', label: 'تاريخ السفر المفضل', type: 'date' })}
        </div>
        ${paxFields(2)}
      </fieldset>
      <fieldset>
        <legend><span class="step">2</span> بيانات التواصل</legend>
        <div class="form-grid">
          ${input({ name: 'name', label: 'الاسم الكامل', required: true, autocomplete: 'name' })}
          ${input({ name: 'phone', label: 'رقم الهاتف / واتساب', type: 'tel', required: true, autocomplete: 'tel', dir: 'ltr', placeholder: '0791234567' })}
          ${input({ name: 'email', label: 'البريد الإلكتروني (اختياري)', type: 'email', dir: 'ltr' })}
        </div>
        ${textarea({ name: 'notes', label: 'ملاحظات (اختياري)', rows: 3, placeholder: 'عدد الغرف، طلبات خاصة، مرونة في التواريخ…' })}
        ${consentField()}
        ${submitBar('إرسال طلب الحجز', 'يصلك عرض رسمي بالسعر النهائي والتوافر. الحجز مؤكد فقط بعد موافقتك ودفع الدفعة الأولى.')}
      </fieldset>
    </div>
  </form>`;
}
