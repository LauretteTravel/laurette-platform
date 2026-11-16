// إدخال عرض تجريبي وموظف تجريبي في نسخة QA من قاعدة البيانات
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
const db = new DatabaseSync('audit-laurette/offer-feature/qa-offer.db');
const now = new Date().toISOString();
const tiers = [
  { hotel: 'أنجم مكة أو شيراتون مكة', stars: 5, room: 'غرفة مزدوجة', price: 665, notes: 'إفطار يومي — قريب من الحرم' },
  { hotel: 'سويس المقام / أبراج صفوه', stars: 5, room: 'ثلاثية', price: 750, notes: 'شامل الطيران والتنقلات' },
  { hotel: 'الفاتح إسطنبول', stars: 3, room: 'غرفة مزدوجة', price: 259, notes: 'إفطار — عرض الجوانب' },
];
const q = db.prepare(`INSERT INTO programs
  (slug, legacy_id, category, level, title, summary, description, destination, country, days, nights, price_from, currency, status, featured,
   art_key, image_url, hotels, itinerary, includes, excludes, terms, flights, options, badges, meals, airline, departure_dates, mode, route,
   sort, poster_image, pdf_brochure_url, department, pricing_tiers_json, views_count, created_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
q.run(
  'istanbul-8days', null, 'istanbul', 'deluxe', 'إسطنبول – 8 أيام (عرض تجريبي QA)',
  'عرض تجريبي لاختبار صفحة العرض المستقلة — لا يظهر في نسخة الإنتاج.',
  'وصف تجريبي للعرض على صفحة /p/:slug', 'إسطنبول', 'تركيا', 8, 7, 689, 'د.أ', 'published', 1,
  'haram', '/media/offers/poster-batumi.jpg', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', 'إفطار', 'Turkish Airlines', '[]', 'air', 'AMM-IST', 100,
  '/media/offers/poster-batumi.jpg', '/media/offers/qa-istanbul-brochure.pdf', 'قسم السياحة الخارجية',
  JSON.stringify(tiers), 0, now, now,
);
const id = db.prepare('SELECT id FROM programs WHERE slug = ?').get('istanbul-8days')?.id;
// موظف تجريبي مرتبط بفرع إربد مع رقم واتساب مباشر
const emp = db.prepare(`INSERT INTO users (username, name, role, department, phone, password_hash, password_salt, must_change, active, branch_id, created_at)
  VALUES (?,?,?,?,?,?,?,?,1,1,?)`).run(
  'qa-emp', 'سالم المستشار (تجريبي)', 'agent', 'قسم السياحة الخارجية', '0790123456',
  randomBytes(32).toString('hex'), randomBytes(16).toString('hex'), 0, now,
);
console.log('DEMO PROGRAM id=' + id + ' | DEMO EMPLOYEE id=' + Number(emp.lastInsertRowid));
db.close();
