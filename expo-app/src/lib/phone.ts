const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function toEnglishDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)));
}

export function normalizePhone(raw: string): string {
  const converted = toEnglishDigits(String(raw ?? "").trim());
  const digits = converted.replace(/\D/g, "");
  if (digits.startsWith("00964")) return "+964" + digits.slice(5);
  if (digits.startsWith("964")) return "+" + digits;
  if (digits.startsWith("0")) return "+964" + digits.slice(1);
  if (digits.startsWith("7") && digits.length === 10) return "+964" + digits;
  return "+" + digits;
}

export function isValidPhone(raw: string): boolean {
  return /^\+9647\d{9}$/.test(normalizePhone(raw));
}

export function phoneToEmail(rawPhone: string): string {
  const digits = normalizePhone(rawPhone).replace(/\D/g, "");
  return `phone${digits}@mamnoon.app`;
}
