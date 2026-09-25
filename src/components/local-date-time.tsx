'use client';

import { useSyncExternalStore } from 'react';
import { formatLocalDateTime } from '@/lib/monitoring-time';

const subscribe = () => () => {};

export function useBrowserLocalTime() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function LocalDateTime({
  value,
  empty = 'No date set',
}: {
  value: Date | string | null;
  empty?: string;
}) {
  const browserReady = useBrowserLocalTime();
  let text = value ? 'Local time' : empty;
  if (browserReady && value) {
    try {
      text = formatLocalDateTime(value);
    } catch {
      text = empty;
    }
  }

  return (
    <span
      className="local-date-time"
      aria-live="polite"
      suppressHydrationWarning
    >
      {text}
    </span>
  );
}
