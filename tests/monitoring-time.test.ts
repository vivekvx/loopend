import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatLocalDateTime,
  localDateTimeInputValue,
} from '../src/lib/monitoring-time';

test('monitoring timestamps round-trip as local India time and persisted UTC', () => {
  const persisted = new Date('2026-09-25T12:48:00.000Z');
  assert.equal(localDateTimeInputValue(persisted, -330), '2026-09-25T18:18');
  assert.equal(
    formatLocalDateTime(persisted, 'en-US', 'Asia/Kolkata'),
    'Sep 25 at 6:18 PM',
  );
});
