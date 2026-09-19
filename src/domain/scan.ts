import { z } from 'zod';
import { dateSchema } from './loops';

export const SCAN_DAYS = 30;
export const SCAN_MESSAGES = 50;
export const CONTENT_LIMIT = 2000;
export const candidateStatuses = [
  'PENDING',
  'ACCEPTED',
  'DISMISSED',
  'MERGED',
] as const;
export const detectionCandidate = z.strictObject({
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().min(5).max(1000),
  desiredOutcome: z.string().trim().min(5).max(1000),
  waitingOn: z.string().trim().min(1).max(300),
  expectedBy: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  nextAction: z.string().trim().max(1000).nullable(),
  verificationCondition: z.string().trim().min(5).max(1000),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  reason: z.string().trim().min(5).max(500),
  sourceReferences: z.array(z.uuid()).min(1).max(SCAN_MESSAGES),
});
export const detectorOutput = z.strictObject({
  candidates: z.array(detectionCandidate).max(20),
});
export type DetectionCandidate = z.infer<typeof detectionCandidate>;
export type DetectionEvent = {
  id: string;
  conversationId: string;
  sender: string;
  subject: string;
  occurredAt: string;
  content: string;
  direction: 'incoming' | 'outgoing';
  possibleDates: { date: string; text: string }[];
};
export interface Detector {
  detect(events: DetectionEvent[], signal?: AbortSignal): Promise<unknown>;
}
export class ScanError extends Error {
  constructor(
    public readonly code:
      | 'SETUP'
      | 'GMAIL_AUTH'
      | 'GMAIL_API'
      | 'AI_API'
      | 'AI_OUTPUT'
      | 'BUSY'
      | 'DISCONNECTED'
      | 'STALE'
      | 'STORAGE',
  ) {
    super(code);
  }
}
export const scanMessages: Record<ScanError['code'], string> = {
  SETUP:
    'Loop Scan needs its Gmail and AI configuration before scanning. Your existing Loops still work.',
  GMAIL_AUTH:
    'Gmail authorization has expired or been revoked. Reconnect to scan again.',
  GMAIL_API: 'Gmail could not finish this scan. Please try again in a moment.',
  AI_API:
    'The detector is unavailable right now. No suggestions were changed. Please try again.',
  AI_OUTPUT:
    'The detector returned a result we could not safely use. No suggestions were changed. Try again.',
  BUSY: 'A scan is already running, or just finished. Please wait a moment before scanning again.',
  DISCONNECTED: 'Connect Gmail before starting a scan.',
  STALE:
    'This suggestion changed or is no longer available. Refresh Loop Scan to review it.',
  STORAGE: 'The change could not be saved. Please try again.',
};
export function validateDetections(
  raw: unknown,
  events: DetectionEvent[],
): DetectionCandidate[] {
  const parsed = detectorOutput.safeParse(raw);
  if (!parsed.success) throw new ScanError('AI_OUTPUT');
  const byId = new Map(events.map((event) => [event.id, event]));
  const seen = new Set<string>();
  const candidates: DetectionCandidate[] = [];
  for (const candidate of parsed.data.candidates) {
    if (candidate.confidence === 'LOW') continue;
    const sources = candidate.sourceReferences.map((id) => byId.get(id));
    if (
      sources.some((source) => !source) ||
      new Set(sources.map((source) => source?.conversationId)).size !== 1
    )
      throw new ScanError('AI_OUTPUT');
    const conversation = sources[0]!.conversationId;
    if (seen.has(conversation)) continue;
    seen.add(conversation);
    const supportedDate =
      candidate.expectedBy &&
      dateSchema.safeParse(candidate.expectedBy).success &&
      sources.some((source) =>
        source!.possibleDates.some(
          (date) => date.date === candidate.expectedBy,
        ),
      );
    candidates.push({
      ...candidate,
      expectedBy: supportedDate ? candidate.expectedBy : null,
      sourceReferences: [...new Set(candidate.sourceReferences)],
    });
  }
  return candidates;
}
