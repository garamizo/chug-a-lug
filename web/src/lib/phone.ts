/** US E.164 normalization; keep in sync with pocketbase/pb_hooks/phone.js. */
export function normalizePhone(input: string): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value || !/^[+\d\s().-]+$/.test(value)) return null;
  if (value.includes('+') && (!value.startsWith('+1') || value.lastIndexOf('+') !== 0)) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10 && !value.startsWith('+')) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}
