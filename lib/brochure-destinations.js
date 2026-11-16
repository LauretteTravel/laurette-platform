import { HttpError } from './http.js';

export const brochureDestinations = [
  ['TR','تركيا',39,35], ['TR','إسطنبول',41.01,28.98], ['RU','روسيا',55.76,37.62], ['RU','موسكو',55.76,37.62], ['SA','مكة المكرمة',21.42,39.83], ['SA','المدينة المنورة',24.47,39.61], ['GE','جورجيا',42.15,43.5], ['AZ','أذربيجان',40.35,48],
  ['EG','مصر',26.82,30.8], ['EG','شرم الشيخ',27.92,34.33], ['SA','السعودية',23.89,45.08],
  ['SA','مكة والمدينة',22.69,39.75], ['JO','الأردن',31.24,36.51], ['AE','الإمارات',24.43,54.65],
  ['TH','تايلاند',15.87,100.99], ['MY','ماليزيا',4.21,101.98], ['VN','فيتنام',16.05,108.2],
  ['ID','بالي',-8.41,115.19], ['FR','فرنسا',46.6,2.55], ['IT','إيطاليا',42.8,12.5],
  ['ES','إسبانيا',40.42,-3.7], ['GR','اليونان',39.07,21.82], ['','أوروبا',49.8,14.4],
].map(([country_code,destination_name,latitude,longitude]) => ({country_code,destination_name,latitude,longitude}));

export const BROCHURE_GLOBE_SCHEMA = `
ALTER TABLE tour_brochures ADD COLUMN country_code TEXT CHECK(country_code IS NULL OR country_code GLOB '[A-Z][A-Z]');
ALTER TABLE tour_brochures ADD COLUMN destination_name TEXT;
ALTER TABLE tour_brochures ADD COLUMN latitude REAL CHECK(latitude BETWEEN -90 AND 90);
ALTER TABLE tour_brochures ADD COLUMN longitude REAL CHECK(longitude BETWEEN -180 AND 180);
CREATE INDEX idx_brochures_destination ON tour_brochures(destination,id DESC) WHERE is_active=1;
ALTER TABLE program_inquiries ADD COLUMN brochure_id INTEGER REFERENCES tour_brochures(id) ON DELETE SET NULL;
ALTER TABLE program_inquiries ADD COLUMN brochure_title TEXT;
CREATE INDEX idx_program_inquiries_brochure ON program_inquiries(brochure_id);
`;

export function locationValues(data, existing = {}) {
  const keys = ['country_code','destination_name','latitude','longitude'];
  const [rawCountry, rawName, rawLat, rawLng] = keys.map(key => data.has(key) ? data.get(key) : existing[key]);
  const country = typeof rawCountry === 'string' ? rawCountry.trim().toUpperCase() : rawCountry ?? '';
  const name = typeof rawName === 'string' ? rawName.trim() : rawName ?? '';
  const empty = value => value == null || value === '';
  if (typeof country !== 'string' || (country && !/^[A-Z]{2}$/.test(country))
      || typeof name !== 'string' || name.length > 100) {
    throw new HttpError(422, 'تحقق من اسم الوجهة ورمز الدولة المكوّن من حرفين');
  }
  if (empty(rawLat) && empty(rawLng)) return [country || null, name || null, null, null];
  const coordinate = value => typeof value === 'number' || (typeof value === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(value.trim())) ? Number(value) : NaN;
  const latitude = coordinate(rawLat);
  const longitude = coordinate(rawLng);
  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new HttpError(422, 'أدخل اسم الوجهة وخط عرض بين -90 و90 وخط طول بين -180 و180');
  }
  return [country || null, name, latitude, longitude];
}

export function parseJod(value) {
  const normalized = String(value ?? '').replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15))
    .replace(/٫/g, '.').replace(/٬/g, ',').trim();
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,3}))?\s*(?:JOD|JD|دينار(?:\s+أردني)?|د\s*\.\s*أ\.?)?$/iu.exec(normalized);
  if (!match) return null;
  const number = Number(match[1].replaceAll(',', '') + (match[2] ? '.' + match[2] : ''));
  return Number.isSafeInteger(Math.round(number * 1000)) ? number : null;
}

const normalize = value => String(value || '').normalize('NFKC').replace(/[أإآ]/g,'ا')
  .replace(/[\u064b-\u065f\u0640]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const presetsByName = new Map(brochureDestinations.map(preset => [normalize(preset.destination_name), preset]));
for (const [alias, name] of [
  ['istanbul','إسطنبول'], ['turkey','تركيا'], ['sharm el sheikh','شرم الشيخ'], ['شـرم الشيخ','شرم الشيخ'],
  ['azerbaijan','أذربيجان'], ['georgia','جورجيا'], ['russia','روسيا'],
  ['moscow','موسكو'], ['makkah','مكة المكرمة'], ['madinah','المدينة المنورة'],
  ['مكة المكرمة والمدينة المنورة','مكة والمدينة'], ['مكة المكرمة/المدينة المنورة','مكة والمدينة'],
]) presetsByName.set(normalize(alias), presetsByName.get(normalize(name)));

export function brochureLocation(row) {
  return row.latitude != null && row.longitude != null ? row
    : presetsByName.get(normalize(row.destination_name || row.destination));
}
