// توليد PDF صالح بسيط للتجربة البصرية للعارض المدمج
import { writeFileSync } from 'node:fs';
const objs = [
  '<</Type/Catalog/Pages 2 0 R>>',
  '<</Type/Pages/Kids[3 0 R]/Count 1>>',
  '<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
  null, // stream يبنى لاحقاً
  '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
];
const stream = 'BT /F1 16 Tf 24 120 Td (Laurette Travel - QA Brochure) Tj ET\nBT /F1 11 Tf 24 90 Td (Istanbul 8 Days - demo catalog file) Tj ET';
objs[3] = `<</Length ${stream.length}>>stream\n${stream}\nendstream`;
let body = '%PDF-1.4\n';
const offsets = [];
objs.forEach((o, i) => {
  offsets.push(body.length);
  body += `${i + 1} 0 obj\n${o}\nendobj\n`;
});
const xrefStart = body.length;
body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
body += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;
writeFileSync('public/media/offers/qa-istanbul-brochure.pdf', body, 'latin1');
console.log('PDF written:', body.length, 'bytes');
