import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../public/assets/data/phone-codes.json', import.meta.url));
export const PHONE_CODES = JSON.parse(readFileSync(file, 'utf8'));
const ALLOWED_CODES = new Set(PHONE_CODES.map((country) => country.callingCode));

export function normalizeInternationalPhone(countryCode, localNumber) {
  const code = String(countryCode || '');
  const digits = String(localNumber || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!ALLOWED_CODES.has(code) || digits.length < 5) return null;
  const phone = `${code}${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
