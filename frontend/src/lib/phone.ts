// Same rule as Go's services.PhoneDigits: the digits of an international number, or '' when the
// text can't be one (letters, too short, no country code).
export function phoneDigits(s: string): string {
  if (/[^\d\s\-().+/]/.test(s)) return '';
  const d = s.replace(/\D/g, '').replace(/^00/, '');
  if (d.length < 7 || d.length > 15 || d.startsWith('0')) return '';
  return d;
}
