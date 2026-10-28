import fs from 'node:fs';
import { dirname, join } from 'node:path';

const platform = process.cwd().endsWith('laurette-platform') ? process.cwd() : join(process.cwd(), 'laurette-platform');
const project = join(platform, '..');

/* 1) copy the audit produced against the legacy build */
const audit = fs.readFileSync(join(project, 'work', 'audit-legacy.md'), 'utf8');
fs.mkdirSync(join(platform, 'docs'), { recursive: true });
fs.writeFileSync(join(platform, 'docs', 'تدقيق-الموقع-السابق.md'), audit, 'utf8');

/* 2) extract the requirements matrix from the analyst receipt */
const raw = fs.readFileSync(join(project, '.zwork', 'runs', '1276f020', '2-分析师.md'), 'utf8');
const start = raw.indexOf('# مصفوفة المتطلبات');
const endMarker = '\n## ترتيب التنفيذ';
const end = raw.indexOf('## ترتيب التنفيذ');
if (start < 0 || end < 0) throw new Error('matrix section not found');
let matrix = raw.slice(start, end).trimEnd();
matrix = `# مصفوفة المتطلبات (تحليل ما قبل التنفيذ)\n\n> **ملاحظة:** أُعدّت هذه المصفوفة أثناء التحليل، قبل كتابة الكود، لذلك تصف مسارات وجداول **مقترحة**. أسماء النهايات والجداول المنفَّذة فعليًا موجودة في \`README.md\` و\`docs/API.md\`، وحالة كل بند في \`docs/التقرير-النهائي.md\`. تُحفظ هنا كمرجع للتغطية ومعايير القبول.\n\n` + matrix.slice(matrix.indexOf('\n') + 1).trimStart();
fs.writeFileSync(join(platform, 'docs', 'مصفوفة-المتطلبات.md'), matrix, 'utf8');

/* 3) keep a few visual references */
fs.mkdirSync(join(platform, 'docs', 'screens'), { recursive: true });
for (const [src, dst] of [
  ['home-v6.png', 'الرئيسية.png'],
  ['programs-v5.png', 'البرامج.png'],
  ['program-v4.png', 'صفحة-البرنامج.png'],
  ['visa-v5.png', 'التأشيرات.png'],
  ['mobile-500.png', 'الهاتف.png'],
]) {
  const from = join(platform, 'shots', src);
  if (fs.existsSync(from)) fs.copyFileSync(from, join(platform, 'docs', 'screens', dst));
}

console.log('docs written', fs.readdirSync(join(platform, 'docs')));
