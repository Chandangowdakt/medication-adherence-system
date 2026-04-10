/** Normalize API id from Mongo (_id or id). */
export function medId(m) {
  return String(m?._id ?? m?.id ?? '');
}
