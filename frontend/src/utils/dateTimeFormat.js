import { format, parseISO } from 'date-fns';

/**
 * API stores and returns UTC. Use these for labels (user's local timezone via JS Date).
 */
export function formatLocalDate(isoOrDate, pattern = 'PP') {
  const d = typeof isoOrDate === 'string' ? parseISO(isoOrDate) : isoOrDate;
  if (Number.isNaN(d?.getTime?.())) return '—';
  return format(d, pattern);
}

export function formatLocalDateTime(isoOrDate) {
  return formatLocalDate(isoOrDate, 'PPp');
}
