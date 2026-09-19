import { convert } from 'html-to-text';
import { z } from 'zod';
import { CONTENT_LIMIT } from '../../../domain/scan';
import { dateSchema } from '../../../domain/loops';

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
};
const partSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    body: z.object({ data: z.string().optional() }).optional(),
    parts: z.array(partSchema).optional(),
    headers: z
      .array(z.object({ name: z.string(), value: z.string() }))
      .optional(),
  }),
);
export const gmailMessageSchema = z.object({
  id: z.string().regex(/^[\w-]+$/),
  threadId: z.string().regex(/^[\w-]+$/),
  internalDate: z.string().regex(/^\d+$/),
  labelIds: z.array(z.string()).optional(),
  payload: partSchema,
});
export type GmailMessage = z.infer<typeof gmailMessageSchema>;
export type NormalizedEmail = {
  messageId: string;
  conversationId: string;
  sender: string;
  subject: string;
  occurredAt: Date;
  content: string;
  metadata: {
    direction: 'incoming' | 'outgoing';
    possibleDates: { date: string; text: string }[];
  };
};

export function usefulText(value: string, html = false): string {
  const plain = html
    ? convert(value, {
        wordwrap: false,
        selectors: [
          { selector: 'blockquote', format: 'skip' },
          { selector: '.gmail_quote', format: 'skip' },
          { selector: '.gmail_signature', format: 'skip' },
          { selector: '.yahoo_quoted', format: 'skip' },
          { selector: 'img', format: 'skip' },
          { selector: 'a', options: { ignoreHref: true } },
        ],
      })
    : value;
  const lines: string[] = [];
  for (const line of plain.replace(/\r\n?/g, '\n').split('\n')) {
    if (
      /^\s*(On .{1,250}wrote:|[-_]{2,}\s*(Original|Forwarded) message|Begin forwarded message:|From:\s|Sent from my |--\s*$)/i.test(
        line,
      )
    )
      break;
    if (/^\s*>/.test(line)) continue;
    if (
      /^\s*(Best regards|Kind regards|Regards|Sincerely|Best wishes)[,!]?\s*$/i.test(
        line,
      )
    )
      break;
    lines.push(line);
  }
  return lines
    .join('\n')
    .replace(/https?:\/\/[^\s<>]+/gi, '[link]')
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,
      '',
    )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, CONTENT_LIMIT);
}
function bodies(part: GmailPart, mime: string): string[] {
  if (part.filename) return [];
  const current =
    part.mimeType === mime && part.body?.data
      ? [Buffer.from(part.body.data, 'base64url').toString('utf8')]
      : [];
  return [
    ...current,
    ...(part.parts ?? []).flatMap((child) => bodies(child, mime)),
  ];
}
export function extractDates(text: string, occurredAt: Date) {
  const dates: { date: string; text: string }[] = [];
  for (const match of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g))
    if (dateSchema.safeParse(match[0]).success)
      dates.push({ date: match[0], text: match[0] });
  for (const match of text.matchAll(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/gi,
  )) {
    const months = [
      'january',
      'february',
      'march',
      'april',
      'may',
      'june',
      'july',
      'august',
      'september',
      'october',
      'november',
      'december',
    ];
    const month = String(months.indexOf(match[1].toLowerCase()) + 1).padStart(
      2,
      '0',
    );
    const date = `${match[3]}-${month}-${match[2].padStart(2, '0')}`;
    if (dateSchema.safeParse(date).success)
      dates.push({ date, text: match[0] });
  }
  for (const match of text.matchAll(
    /\b(?:within|in)\s+(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s+(business\s+|working\s+)?days?\b/gi,
  )) {
    let days = Number(match[2] || match[1]);
    if (days < 1 || days > 60) continue;
    const date = new Date(occurredAt);
    while (days > 0) {
      date.setUTCDate(date.getUTCDate() + 1);
      if (!match[3] || ![0, 6].includes(date.getUTCDay())) days--;
    }
    dates.push({ date: date.toISOString().slice(0, 10), text: match[0] });
  }
  return dates.slice(0, 8);
}
export function normalizeGmail(
  raw: unknown,
  accountEmail: string,
): NormalizedEmail | null {
  const parsed = gmailMessageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const message = parsed.data;
  const headers = new Map(
    (message.payload.headers ?? []).map((header) => [
      header.name.toLowerCase(),
      header.value,
    ]),
  );
  if (
    message.labelIds?.some((label) =>
      ['SPAM', 'TRASH', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL'].includes(
        label,
      ),
    ) ||
    headers.has('list-unsubscribe') ||
    headers.has('list-id') ||
    /^(bulk|list)$/i.test(headers.get('precedence') ?? '')
  )
    return null;
  const occurredAt = new Date(Number(message.internalDate));
  if (Number.isNaN(occurredAt.getTime())) return null;
  const plain = bodies(message.payload, 'text/plain');
  const content = plain.length
    ? usefulText(plain.join('\n'))
    : usefulText(bodies(message.payload, 'text/html').join('\n'), true);
  if (!content) return null;
  const sender = usefulText(headers.get('from') ?? 'Unknown sender').slice(
    0,
    300,
  );
  const mailbox = (sender.match(/<([^>]+)>/)?.[1] ?? sender)
    .trim()
    .toLowerCase();
  return {
    messageId: message.id,
    conversationId: message.threadId,
    sender,
    subject: usefulText(headers.get('subject') ?? '(No subject)').slice(0, 300),
    occurredAt,
    content,
    metadata: {
      direction:
        mailbox === accountEmail.toLowerCase() ? 'outgoing' : 'incoming',
      possibleDates: extractDates(content, occurredAt),
    },
  };
}
