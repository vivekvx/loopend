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
export function gmailFixture(
  id = 'abc123',
  threadId = 'thread1',
  content = 'Your £128 refund will arrive within 3–5 business days.\n\nOn Tuesday, someone wrote:\nPrivate quoted history',
) {
  return {
    id,
    threadId,
    internalDate: String(Date.now()),
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'Store Support <support@example.com>' },
        { name: 'Subject', value: 'Your refund' },
      ],
      body: { data: Buffer.from(content).toString('base64url') },
    },
  };
}
