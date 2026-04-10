/** UTC midnight timestamp for a Date (same logic as backend day keys). */
export function utcDayStartMs(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}

export function isSameUtcDay(a, b) {
  const ta = utcDayStartMs(a);
  const tb = utcDayStartMs(b);
  return ta != null && tb != null && ta === tb;
}
