const DATE_LOCALE = 'en-GB';
const UTC_TIME_ZONE = 'UTC';

export function formatDate(
  value: string | null,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' },
): string {
  if (!value) return 'Date to be confirmed';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(DATE_LOCALE, { ...options, timeZone: UTC_TIME_ZONE }).format(date);
}

export function formatKickoff(value: string | null): string {
  if (!value) return 'Kick-off time not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
