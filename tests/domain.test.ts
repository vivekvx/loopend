import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCompletable,
  assertEditable,
  dateSchema,
  needsAttention,
  loopInput,
  completionInput,
} from '../src/domain/loops';
test('an action or waiting state is never completion', () => {
  for (const state of [
    'OPEN',
    'WAITING',
    'NEEDS_USER',
    'AGENT_WORKING',
    'CLOSED',
  ] as const)
    assert.throws(() => assertCompletable(state));
  assert.doesNotThrow(() => assertCompletable('VERIFYING'));
  assert.throws(() => assertEditable('CLOSED'));
});
test('completion requires substantive evidence and explicit confirmation', () => {
  assert.equal(
    completionInput.safeParse({ evidence: 'done', confirmed: true }).success,
    false,
  );
  assert.equal(
    completionInput.safeParse({
      evidence: 'The credit is in the bank.',
      confirmed: false,
    }).success,
    false,
  );
});
test('dates reject impossible days and preserve valid leap dates', () => {
  assert.equal(dateSchema.safeParse('2026-02-30').success, false);
  assert.equal(dateSchema.safeParse('2028-02-29').success, true);
  assert.equal(dateSchema.safeParse('').success, true);
});
test('attention includes due today and overdue, but never closed', () => {
  assert.equal(
    needsAttention(
      { status: 'WAITING', expectedBy: '2026-09-19' },
      '2026-09-19',
    ),
    true,
  );
  assert.equal(
    needsAttention(
      { status: 'WAITING', expectedBy: '2026-09-20' },
      '2026-09-19',
    ),
    false,
  );
  assert.equal(
    needsAttention({ status: 'CLOSED', expectedBy: '2020-01-01' }),
    false,
  );
  assert.equal(
    needsAttention({ status: 'NEEDS_USER', expectedBy: null }),
    true,
  );
});
test('the regular edit schema cannot close a loop', () => {
  assert.equal(loopInput.shape.status.safeParse('CLOSED').success, false);
});
