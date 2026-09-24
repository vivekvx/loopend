import { testDatabaseUrl } from '../src/server/db/test-safety';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../src/server/db/schema';
import { loopService } from '../src/server/loops/service';

test('PostgreSQL lifecycle, immutable events, stale edits, and concurrent completion', async () => {
  const url = testDatabaseUrl();
  assert.ok(url, 'TEST_DATABASE_URL must point to an isolated test database.');
  assert.notEqual(
    url,
    process.env.DATABASE_URL,
    'Tests must not use the development database.',
  );
  const client = postgres(url, { max: 3 });
  const db = drizzle(client, { schema });
  const userId = randomUUID();
  const service = loopService(db, userId);
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.user).values({
      id: userId,
      name: 'Lifecycle test',
      email: `${userId}@example.com`,
    });
    const input = {
      title: `Test refund ${Date.now()}`,
      summary: 'A returned order.',
      desiredOutcome: 'The refund arrives in my account.',
      status: 'WAITING',
      waitingOn: 'Retailer',
      expectedBy: '2027-01-10',
      nextAction: 'Check statement.',
      verificationCondition: 'A £128 credit on the statement.',
    };
    const loop = await service.create(input);
    await assert.rejects(
      () =>
        service.complete(loop.id, 1, {
          evidence: 'Sent a follow-up email.',
          confirmed: true,
        }),
      /Verifying/,
    );
    await service.addActivity(loop.id, 1, 'The retailer confirmed processing.');
    await assert.rejects(
      () => service.update(loop.id, 1, input),
      /another window/,
    );
    await assert.rejects(() =>
      service.update(loop.id, 2, { ...input, status: 'CLOSED' }),
    );
    const updated = await service.update(loop.id, 2, {
      ...input,
      status: 'VERIFYING',
      expectedBy: '',
    });
    assert.equal(updated.expectedBy, null);
    const attempts = await Promise.allSettled([
      service.complete(loop.id, 3, {
        evidence: '£128 is visible on the current bank statement.',
        confirmed: true,
      }),
      service.complete(loop.id, 3, {
        evidence: '£128 is visible on the current bank statement.',
        confirmed: true,
      }),
    ]);
    assert.equal(
      attempts.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    const record = await service.get(loop.id);
    assert.equal(record?.loop.status, 'CLOSED');
    assert.ok(record?.loop.closedAt);
    assert.deepEqual(
      record?.events.map((event) => event.type),
      [
        'loop.created',
        'activity.noted',
        'loop.state_changed',
        'outcome.verified',
        'loop.closed',
      ],
    );
    await assert.rejects(
      () => service.addActivity(loop.id, 4, 'Changed after completion.'),
      /cannot be changed/,
    );
    await assert.rejects(
      () =>
        client`UPDATE loop_events SET body = 'tampered' WHERE loop_id = ${loop.id}`,
      /immutable/,
    );
    await assert.rejects(
      () => client`DELETE FROM loop_events WHERE loop_id = ${loop.id}`,
      /immutable/,
    );
    await assert.rejects(
      () => client`UPDATE loops SET closed_at = NULL WHERE id = ${loop.id}`,
      /closed_timestamp_matches_state/,
    );
    assert.equal((await service.get(loop.id))?.events.length, 5);
  } finally {
    await client.end();
  }
});
