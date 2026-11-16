/* إضافة مفاتيح ترجمة صندوق الاستفسار إلى lib/i18n-en.json دون إعادة تنسيق الملف كاملاً.
   التشغيل: node tools/add-inquiry-i18n.mjs */
import { readFileSync, writeFileSync } from 'node:fs';

const PATH = 'lib/i18n-en.json';
const NEXT = {
  'اطلب فندق آخر / استفسر': 'Request another hotel / enquire',
  'عرض بديل': 'Alternative option',
  'تخصيص العرض أو السؤال عن فندق آخر': 'Tailor this offer or ask about another hotel',
  'تريد نفس البرنامج بفندق آخر، أو تاريخاً غير المنشور، أو عرض سعر لعائلة؟ اكتب طلبك هنا ويصلك رد الفريق على واتساب — بلا التزام.':
    'Want the same programme in a different hotel, unpublished dates, or a family quote? Tell us here and our team replies on WhatsApp — no commitment.',
  'ما الذي يمكنني طلبه؟': 'What can I ask for?',
  'نفس البرنامج والمدة بفندق مختلف (بنفس المستوى أو أعلى).': 'The same programme and duration in a different hotel (same class or higher).',
  'الاستفسار عن توافر غرف أو تواريخ سفر بديلة.': 'Room availability or alternative travel dates.',
  'عرض سعر خاص لعائلة أو مجموعة بعدد أشخاص وأطفال محدد.': 'A family or group quote for a specific number of adults and children.',
  'تخصيص البرنامج / طلب فندق آخر': 'Tailor this programme / request another hotel',
  'الطلب استفسار وليس حجزاً مؤكداً؛ السعر المعتمد هو الصادر في عرض رسمي من لوريت.':
    'This is an enquiry, not a confirmed booking; the binding price is the official Laurette quote.',
  'صندوق الفندق البديل': 'Alternative hotel box',
  'حدّد ما يناسبك، ويصلك رد فريق لوريت على واتساب خلال ساعات العمل.':
    'Pick what suits you and the Laurette team replies on WhatsApp during working hours.',
  'البرنامج المحدد': 'Selected programme',
  'الفندق الحالي': 'Current hotel',
  'السعر الأساسي': 'Base price',
  'نوع الطلب': 'Request type',
  'أريد نفس البرنامج بفندق آخر': 'Same programme, another hotel',
  'الاستفسار عن تواريخ أو توافر غرف': 'Dates or room availability',
  'طلب عرض سعر خاص لعائلة / مجموعة': 'Family / group quote',
  'الفندق المطلوب / ملاحظات': 'Requested hotel / notes',
  'اكتب اسم الفندق المطلوب (مثلاً: دار التوحيد، سويس أوتيل، فندق 5 نجوم مطـ...) أو عدد الأشخاص والأطفال':
    'Requested hotel (e.g. Dar Al Tawhid, Swissotel, a 5-star hotel overlooking…) or number of adults and children',
  'اختياري — لكنه يسرّع الرد كثيراً.': 'Optional — but it speeds up our reply.',
  'رقم الواتساب / الهاتف': 'WhatsApp / phone number',
  'الفرع الأقرب للتواصل': 'Nearest branch',
  '(اختياري)': '(optional)',
  'أوافق على حفظ بياناتي للتواصل معي بخصوص هذا الاستفسار، وعلى':
    'I agree to my details being stored so you can contact me about this enquiry, and to the',
  'إرسال الطلب والاستفسار': 'Send request & enquiry',
  'تم استلام استفسارك': 'Enquiry received',
  'احتفظ بالرقم المرجعي للمتابعة، أو أرسل التفاصيل الآن عبر واتساب ليصل الاستفسار فوراً لفريق المبيعات.':
    'Keep the reference to follow up, or send the details now on WhatsApp so the sales team sees it immediately.',
  'إرسال التفاصيل مباشرة عبر واتساب الآن 💬': 'Send details on WhatsApp now 💬',
  'فتح واتساب اختياري — استفسارك محفوظ لدى الفريق حتى لو لم ترسله.':
    'Opening WhatsApp is optional — your enquiry is saved with the team either way.',
  'تريد فندقاً آخر؟': 'Want a different hotel?',
  'نفس العرض بفندق مختلف، أو تواريخ أخرى، أو عرض سعر لعائلة/مجموعة — اكتب طلبك ويصلك رد الفريق على واتساب.':
    'The same offer with another hotel, other dates, or a family/group quote — write it here and the team replies on WhatsApp.',
  'عرض من لوريت': 'A Laurette offer',
  'أدخل الاسم الكامل (حرفان على الأقل).': 'Enter your full name (at least two characters).',
  'رقم الهاتف غير صالح (مثال: 0791234567).': 'Invalid phone number (e.g. 0791234567).',
  'يجب الموافقة على حفظ البيانات قبل الإرسال.': 'You must agree to data storage before sending.',
  'جارٍ إرسال الاستفسار…': 'Sending your enquiry…',
  'عدد المحاولات كبير. حاول بعد قليل أو راسلنا على واتساب مباشرة.':
    'Too many attempts. Try again shortly or message us on WhatsApp.',
  'تعذر إرسال الاستفسار الآن. حاول مرة أخرى أو راسلنا على واتساب.':
    'Could not send the enquiry now. Try again or message us on WhatsApp.',
  'تعذر الاتصال بالخادم. تحقق من الشبكة وحاول مرة أخرى.':
    'Could not reach the server. Check your connection and try again.',
  'نوع الاستفسار غير معروف': 'Unknown enquiry type',
  'الحد الأقصى 600 حرف': '600 characters maximum',
  'رقم أردني غير مكتمل: أدخله مثل 0791234567 أو 0771234567':
    'Incomplete Jordanian number: enter it as 0791234567 or 0771234567',
  'رقم هاتف غير صالح: تحقق من رمز الدولة وعدد الأرقام': 'Invalid phone number: check the country code and digits',
  'الفرع المحدد غير معروف': 'Unknown branch',
  'العرض المحدد غير متاح، اختر عرضاً آخر من الموقع': 'This offer is not available; pick another one from the site',
  'الاستفسار غير موجود': 'Enquiry not found',
  'رقم الاستفسار غير صالح': 'Invalid enquiry number',
  'تم تحديث حالة الاستفسار': 'Enquiry status updated',
};

const raw = readFileSync(PATH, 'utf8');
const current = JSON.parse(raw);
const additions = Object.entries(NEXT).filter(([key]) => !(key in current));
if (!additions.length) {
  console.log('nothing to add');
  process.exit(0);
}
const body = raw.replace(/\s*\}\s*$/, '');
const lines = additions.map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n');
const next = `${body},\n${lines}\n}\n`;
JSON.parse(next); // يفشل قبل الكتابة لو أفسدنا البنية
writeFileSync(PATH, next, 'utf8');
console.log(`added ${additions.length} keys`);
