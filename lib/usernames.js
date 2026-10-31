// Keep existing ASCII logins compatible; normalize Arabic consistently at creation and login.
export const normalizeUsername = (value) => String(value ?? '').normalize('NFC').trim().toLowerCase();
export function validUsername(value) {
  const chars = Array.from(value);
  return chars.length >= 3 && chars.length <= 32 && chars.every((char) =>
    /^[a-z0-9._-]$/.test(char) ||
    (/^[\p{L}\p{M}\p{Nd}]$/u.test(char) && /^\p{Script_Extensions=Arabic}$/u.test(char))
  ) && (/[a-z0-9._-]/.test(value) || /[\p{L}\p{Nd}]/u.test(value));
}
