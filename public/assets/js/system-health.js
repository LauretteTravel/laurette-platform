(() => {
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const at=s=>s?`<time datetime="${esc(s)}">${esc(new Date(s).toLocaleString('ar-JO',{timeZone:'Asia/Amman',dateStyle:'short',timeStyle:'medium'}))}</time>`:'لم يُسجل';
  const yes=b=>b?'مفعّل':'غير مفعّل';
  const states={pending:'بانتظار الإرسال',processing:'قيد المعالجة',sent:'مرسل',delivered:'تم التسليم',failed:'فشل',cancelled:'ملغى',extracted:'مستخرج',other:'حالة أخرى'};
  function queue(q){return `<p class="health-meta">آخر ${q.sampled} سجل، بحد ${q.limit}${q.truncated?' — عينة وليست الإجمالي':''}.</p><ul>${Object.entries(q.states).map(([k,v])=>`<li>${esc(states[k]||k)}: ${v}</li>`).join('')||'<li>لا توجد سجلات</li>'}</ul>`;}
  function worker(w){return `<p>المجدول: ${yes(w.scheduled)}${w.scheduled?`، كل ${w.intervalSeconds} ثانية`:''}؛ ${w.running?'دورة قيد التنفيذ':'لا دورة قيد التنفيذ'}.</p><p>آخر محاولة: ${at(w.lastAttemptAt)}</p><p>آخر دورة بلا خطأ: ${at(w.lastSuccessAt)}</p><p>آخر فشل دورة: ${at(w.lastFailureAt)}</p><p class="health-meta">دورة بلا خطأ لا تثبت وصول رسالة أو معالجة كل العناصر.</p>`;}
  async function mount(host,{api}){
    const d=await api('/api/admin/system-health');
    if(!host.isConnected)return;
    host.innerHTML=`<div class="toolbar"><p class="health-meta">توليد: ${at(d.generatedAt)} بتوقيت عمّان؛ تحديث القراءة كل ${d.cacheSeconds} ثوانٍ كحد أقصى.</p><button class="btn btn-primary" data-health-refresh>تحديث الحالة</button></div><p class="health-note">لوحة قراءة فقط للمؤسسة. إعداد خدمة أو وجود ملف لا يثبت سلامة الاتصال أو الاستعادة. لا ترسل هذه الشاشة رسائل ولا تعيد المحاولات ولا تفعّل الرفع.</p><div class="health-grid">
      <section class="health-card"><h2>قاعدة البيانات والنسخ</h2><p>إصدار المخطط: ${d.database.schemaVersion}؛ سجل الترحيلات: ${d.database.recordedMigrations}.</p><p>آخر ترحيل: ${at(d.database.lastMigrationAt)}</p><p>نسخ ما قبل الترحيلات: ${esc({present:'وُجدت ملفات',missing:'لم توجد ملفات مطابقة',unavailable:'تعذر الجرد أو قاعدة مؤقتة'}[d.backups.state])}.</p><p>فُحص ${d.backups.scannedEntries} مدخلًا؛ ${d.backups.matchedFiles} ملف مطابق${d.backups.truncated?' — الجرد محدود وغير شامل':''}.</p><p>أحدث ملف ضمن الجرد: ${at(d.backups.latestAt)}${d.backups.latestBytes===null?'':`؛ ${d.backups.latestBytes} بايت`}.</p><p class="health-warning">لا دليل هنا على نسخة دورية أو استعادة متحققة. فحص سلامة القاعدة الكامل والاستعادة يتمان خارج مسار الويب.</p></section>
      <section class="health-card"><h2>مواعيد المهام والمتابعات</h2><p class="${d.deadlines.policy.valid?'health-ok':'health-warning'}">السياسة: ${d.deadlines.policy.valid?yes(d.deadlines.policy.enabled):'غير صالحة؛ المعالجة متوقفة'}.</p>${worker(d.deadlines.worker)}<p>آخر دورة محفوظة: ${at(d.deadlines.lastRecordedCycle?.at)}</p>${d.deadlines.lastRecordedCycle?`<p>عناصر مفحوصة: ${d.deadlines.lastRecordedCycle.examined??'غير متاح'}؛ تعذر توجيه: ${d.deadlines.lastRecordedCycle.unroutable??'غير متاح'}.</p>`:''}</section>
      <section class="health-card"><h2>إرسال واتساب</h2><p>التهيئة عند تشغيل الخادم: ${yes(d.whatsapp.enabled)}.</p>${worker(d.whatsapp.worker)}${queue(d.whatsapp.queue)}</section>
      <section class="health-card"><h2>ربط n8n</h2><p>الإعداد: ${d.n8n.configured?'موجود':'غير مكتمل'}؛ الإرسال عند الحدث، وليس مجدول إعادة إرسال مستقل.</p><p class="health-warning">الاتصال الحي لم يُفحص من هذه الشاشة.</p>${queue(d.n8n.queue)}</section>
      <section class="health-card"><h2>الملفات والاستخراج</h2><p>رفع مرفقات المهام: ${yes(d.files.taskUploadsEnabled)}؛ رفع مصادر البرامج: ${yes(d.files.programUploadsEnabled)}.</p><p class="health-warning">الفاحص الحي غير متحقق هنا؛ أعلام التمكين لا تثبت جاهزيته.</p>${queue(d.files.imports)}<p class="health-meta">حالات مصادر البرامج المحفوظة فقط. لا يوجد سجل شامل لمحاولات رفع المهام المرفوضة قبل الحفظ.</p></section>
      <section class="health-card"><h2>حدود القراءة</h2><p>زمن تشغيل العملية: ${d.uptimeSeconds} ثانية.</p><p>الحالات أعداد فقط، دون بيانات عميل أو روابط تكامل أو أسماء ملفات خاصة. تحديث الحالة لا ينفّذ إصلاحًا تلقائيًا.</p><p class="health-meta">تحتاج المشكلات التشغيلية مراجعة سجلات الخادم الخاصة وخطة النسخ والاستعادة. لا تظهر هنا تفاصيل الأسرار أو مسارات التخزين.</p></section></div><p role="status" data-health-status></p>`;
    host.querySelector('[data-health-refresh]').onclick=async e=>{
      e.currentTarget.disabled=true;
      try{await mount(host,{api});host.querySelector('[data-health-refresh]')?.focus({preventScroll:true});}
      catch(error){host.querySelector('[data-health-status]').textContent=error.message;e.target.disabled=false;}
    };
  }
  window.SystemHealth={mount};
})();
