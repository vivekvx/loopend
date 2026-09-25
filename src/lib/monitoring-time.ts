const localDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function validDate(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date.');
  return date;
}

export function localDateTimeInputValue(
  value: Date | string,
  timezoneOffsetMinutes = validDate(value).getTimezoneOffset(),
) {
  const date = validDate(value);
  return new Date(date.getTime() - timezoneOffsetMinutes * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function localDateTimeToUtcIso(value: string) {
  if (!localDateTimePattern.test(value)) throw new RangeError('Invalid date.');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date.');
  return date.toISOString();
}

export function formatLocalDateTime(
  value: Date | string,
  locale?: string | string[],
  timeZone?: string,
) {
  const options = timeZone ? { timeZone } : {};
  const date = validDate(value);
  const day = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...options,
  }).format(date);
  const time = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...options,
  }).format(date);
  return `${day} at ${time}`;
}
