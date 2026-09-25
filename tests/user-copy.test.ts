import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedExcerpt, userFacingCopy } from '../src/lib/user-copy';

test('user-facing monitoring copy hides technical timestamps and bounds evidence excerpts', () => {
  assert.equal(
    userFacingCopy('The email from 2026-09-25T14:02:55.000Z confirms it.'),
    'The recent email confirms it.',
  );
  assert.equal(
    userFacingCopy('Additional confirmation from 14:16:54.000Z.'),
    'A recent follow-up.',
  );
  const excerpt = boundedExcerpt('word '.repeat(200), 40);
  assert.ok(excerpt.length <= 43);
  assert.match(excerpt, /\.\.\.$/);
});
