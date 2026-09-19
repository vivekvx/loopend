import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  detectorOutput,
  validateDetections,
  type DetectionEvent,
} from '../src/domain/scan';
import { scanSetup } from '../src/server/scan/config';
import {
  usefulText,
  normalizeGmail,
  extractDates,
} from '../src/server/integrations/gmail/normalize';
import { tokenVault } from '../src/server/integrations/crypto';

const event: DetectionEvent = {
  id: randomUUID(),
  conversationId: 'thread1',
  sender: 'Store',
  subject: 'Refund',
  occurredAt: '2026-09-19T10:00:00Z',
  content: 'Your refund will arrive within 3–5 business days.',
  direction: 'incoming',
  possibleDates: [{ date: '2026-09-25', text: 'within 3–5 business days' }],
};
export const candidateFixture = (references: string[]) => ({
  title: 'A refund still on its way',
  summary: 'The store promised a refund, but receipt needs checking.',
  desiredOutcome: 'The £128 refund arrives in the bank account.',
  waitingOn: 'The store',
  expectedBy: null,
  nextAction: 'Check the bank statement.',
  verificationCondition: 'The £128 credit appears on the bank statement.',
  confidence: 'HIGH' as const,
  reason: 'The store explicitly promised a refund within five business days.',
  sourceReferences: references,
});

test('candidate schema rejects unknown fields, prose, missing evidence and invalid confidence', () => {
  assert.equal(
    detectorOutput.safeParse({ candidates: [candidateFixture([event.id])] })
      .success,
    true,
  );
  for (const raw of [
    'create a loop now',
    { candidates: [{ ...candidateFixture([event.id]), status: 'CLOSED' }] },
    { candidates: [{ ...candidateFixture([]) }] },
    { candidates: [{ ...candidateFixture([event.id]), confidence: 0.95 }] },
  ])
    assert.equal(detectorOutput.safeParse(raw).success, false);
});
test('detector validation discards low confidence, checks references, and grounds dates', () => {
  assert.equal(
    validateDetections(
      { candidates: [{ ...candidateFixture([event.id]), confidence: 'LOW' }] },
      [event],
    ).length,
    0,
  );
  assert.throws(
    () =>
      validateDetections({ candidates: [candidateFixture([randomUUID()])] }, [
        event,
      ]),
    /AI_OUTPUT/,
  );
  const second = { ...event, id: randomUUID(), conversationId: 'thread2' };
  assert.throws(
    () =>
      validateDetections(
        { candidates: [candidateFixture([event.id, second.id])] },
        [event, second],
      ),
    /AI_OUTPUT/,
  );
  assert.equal(
    validateDetections(
      {
        candidates: [
          { ...candidateFixture([event.id]), expectedBy: '2026-10-01' },
        ],
      },
      [event],
    )[0].expectedBy,
    null,
  );
  assert.equal(
    validateDetections(
      {
        candidates: [
          { ...candidateFixture([event.id]), expectedBy: '2026-09-25' },
        ],
      },
      [event],
    )[0].expectedBy,
    '2026-09-25',
  );
  assert.equal(
    validateDetections(
      {
        candidates: [
          candidateFixture([event.id]),
          candidateFixture([event.id]),
        ],
      },
      [event],
    ).length,
    1,
  );
});
test('Gmail normalization strips HTML, signatures, quoted history, tracking and attachments', () => {
  assert.equal(
    usefulText(
      'We will send it tomorrow.\n\nOn Tuesday, Alex wrote:\nOld thread',
    ),
    'We will send it tomorrow.',
  );
  assert.equal(
    usefulText('Your refund is pending.\n> Old quote\n-- \nPrivate signature'),
    'Your refund is pending.',
  );
  const text = usefulText(
    '<p>We will respond in 5 days.</p><script>secret()</script><div class="gmail_quote">Quoted history</div><blockquote>Older reply</blockquote><div class="gmail_signature">Phone 12345</div><a href="https://tracker.invalid/?secret=1">View case</a>',
    true,
  );
  assert.match(text, /respond in 5 days/);
  assert.doesNotMatch(text, /secret|Quoted|Older|12345|tracker/);
  const message = {
    id: '123abc',
    threadId: '456def',
    internalDate: String(Date.now()),
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'Support <support@example.com>' },
        { name: 'Subject', value: 'Your repair' },
      ],
      parts: [
        {
          mimeType: 'text/plain',
          body: {
            data: Buffer.from(
              'We will contact you in 3 days.\nRegards\nPrivate phone',
            ).toString('base64url'),
          },
        },
        {
          mimeType: 'text/plain',
          filename: 'secret.txt',
          body: {
            data: Buffer.from('sensitive attachment').toString('base64url'),
          },
        },
      ],
    },
  };
  const result = normalizeGmail(message, 'owner@example.com');
  assert.equal(result?.content, 'We will contact you in 3 days.');
  assert.equal(result?.sender, 'Support <support@example.com>');
  assert.equal(
    normalizeGmail(
      {
        ...message,
        payload: {
          ...message.payload,
          headers: [
            ...message.payload.headers,
            { name: 'List-Unsubscribe', value: '<https://example.com>' },
          ],
        },
      },
      'owner@example.com',
    ),
    null,
  );
  assert.equal(
    normalizeGmail(
      { ...message, labelIds: ['CATEGORY_PROMOTIONS'] },
      'owner@example.com',
    ),
    null,
  );
});
test('date windows use deterministic upper bounds; vague dates remain absent', () => {
  assert.deepEqual(
    extractDates(
      'Refund within 3–5 business days',
      new Date('2026-09-18T12:00:00Z'),
    ),
    [{ date: '2026-09-25', text: 'within 3–5 business days' }],
  );
  assert.deepEqual(extractDates('Sometime next month', new Date()), []);
});
test('missing and invalid configuration is a supported setup state', () => {
  assert.equal(scanSetup({}).gmailReady, false);
  assert.equal(scanSetup({}).aiReady, false);
  assert.equal(
    scanSetup({
      LOOP_SCAN_AI_API_KEY: 'test',
      LOOP_SCAN_AI_BASE_URL: 'http://untrusted.invalid',
    }).aiReady,
    false,
  );
  assert.equal(
    scanSetup({
      GOOGLE_CLIENT_ID: 'test',
      GOOGLE_CLIENT_SECRET: 'test',
      APP_URL: 'https://example.com',
      SOURCE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    }).gmailReady,
    true,
  );
});
test('tokens are encrypted and authenticated with account-specific associated data', () => {
  const vault = tokenVault(randomBytes(32).toString('base64'));
  const cipher = vault.seal({ refreshToken: 'private-token' }, 'gmail:owner');
  assert.doesNotMatch(cipher, /private-token/);
  assert.deepEqual(vault.open(cipher, 'gmail:owner'), {
    refreshToken: 'private-token',
  });
  assert.throws(() => vault.open(cipher, 'gmail:another'), /GMAIL_AUTH/);
  assert.throws(
    () =>
      tokenVault(randomBytes(32).toString('base64')).open(
        cipher,
        'gmail:owner',
      ),
    /GMAIL_AUTH/,
  );
});
