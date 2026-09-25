'use client';

import { LocalDateTime } from './local-date-time';

const scheduledTypes = new Set([
  'monitoring.enabled',
  'monitoring.rescheduled',
  'agent.monitoring_enabled',
  'agent.check_scheduled',
  'agent.rescheduled',
]);

function scheduledAt(payload: Record<string, unknown>) {
  const value = payload.nextCheckAt;
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime()))
    return null;
  return value;
}

export function MonitoringTimelineEvent({
  type,
  body,
  payload,
}: {
  type: string;
  body: string;
  payload: Record<string, unknown>;
}) {
  const nextCheckAt = scheduledTypes.has(type) ? scheduledAt(payload) : null;
  if (!nextCheckAt) return body;

  const prefix =
    type === 'monitoring.enabled' || type === 'agent.monitoring_enabled'
      ? 'Monitoring started. Next check '
      : type === 'agent.rescheduled'
        ? 'No new evidence yet. Next check '
        : type === 'monitoring.rescheduled'
          ? 'You changed the monitoring schedule. Next check '
          : 'Next check ';

  return (
    <>
      {prefix}
      <LocalDateTime value={nextCheckAt} />.
    </>
  );
}
