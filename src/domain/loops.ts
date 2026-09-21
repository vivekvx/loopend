import { z } from 'zod';

export const activeStatuses = [
  'OPEN',
  'WAITING',
  'NEEDS_USER',
  'AGENT_WORKING',
  'VERIFYING',
] as const;
export const statuses = [...activeStatuses, 'CLOSED'] as const;
export type LoopStatus = (typeof statuses)[number];
export const monitoringSources = ['MANUAL', 'GMAIL_CONVERSATION'] as const;
export type MonitoringSource = (typeof monitoringSources)[number];
export const monitoringModes = ['OBSERVE_ONLY'] as const;
export type MonitoringMode = (typeof monitoringModes)[number];
export const statusLabels: Record<LoopStatus, string> = {
  OPEN: 'Open',
  WAITING: 'Waiting',
  NEEDS_USER: 'Needs you',
  AGENT_WORKING: 'Being worked on',
  VERIFYING: 'Verifying',
  CLOSED: 'Closed',
};
export const dateSchema = z
  .string()
  .refine(
    (value) =>
      !value ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value),
    'Enter a valid date.',
  );
export const loopInput = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'Give this Loop a title of at least 3 characters.')
    .max(160),
  summary: z.string().trim().max(4000),
  desiredOutcome: z
    .string()
    .trim()
    .min(5, 'Describe the outcome you want.')
    .max(2000),
  waitingOn: z.string().trim().max(300),
  expectedBy: dateSchema,
  nextAction: z.string().trim().max(2000),
  verificationCondition: z
    .string()
    .trim()
    .min(5, 'Describe how you will know it is finished.')
    .max(2000),
  status: z.enum(activeStatuses),
});
export const activityInput = z
  .string()
  .trim()
  .min(1, 'Write an activity entry.')
  .max(4000);
export const completionInput = z.object({
  evidence: z
    .string()
    .trim()
    .min(10, 'Record at least 10 characters of evidence.')
    .max(4000),
  confirmed: z.literal(true, {
    error: 'Confirm that the verification condition has been met.',
  }),
});
export const monitoringInput = z.object({
  enabled: z.enum(['true', 'false']).transform((value) => value === 'true'),
  cadenceHours: z.coerce
    .number()
    .int()
    .min(12)
    .max(24 * 30),
  nextCheckAt: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => (value ? value : null))
    .refine(
      (value) => !value || !Number.isNaN(new Date(value).getTime()),
      'Choose a valid next check time.',
    ),
});
export class DomainError extends Error {}
export function assertEditable(status: LoopStatus) {
  if (status === 'CLOSED')
    throw new DomainError(
      'A closed Loop is a completed record and cannot be changed.',
    );
}
export function assertCompletable(status: LoopStatus) {
  if (status !== 'VERIFYING')
    throw new DomainError(
      'Move this Loop to Verifying before recording completion.',
    );
}
export function needsAttention(
  loop: { status: LoopStatus; expectedBy: string | null },
  today = new Date().toISOString().slice(0, 10),
) {
  return (
    loop.status !== 'CLOSED' &&
    (loop.status === 'NEEDS_USER' ||
      (loop.expectedBy !== null && loop.expectedBy <= today))
  );
}
export function formatDate(value: string | Date | null) {
  if (!value) return 'No date set';
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(typeof value === 'string' ? new Date(value) : value);
}
