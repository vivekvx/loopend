import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../src/server/db/schema';
import { testDatabaseUrl } from '../src/server/db/test-safety';
import { eraseAccount } from '../src/server/account/service';
import { loopService } from '../src/server/loops/service';
import { scanStore } from '../src/server/scan/store';
import { requestScan, scanQueue } from '../src/server/scan/queue';
import {
  saveConnection,
  detachConnection,
} from '../src/server/integrations/gmail/connections';
import { tokenVault } from '../src/server/integrations/crypto';
import {
  rememberOAuthState,
  consumeOAuthState,
} from '../src/server/integrations/gmail/oauth-state';
import { agentStore } from '../src/server/agent/store';
import { checkDatabase } from '../src/server/health';
import { candidateFixture, gmailFixture } from './fixtures/scan';
import { normalizeGmail } from '../src/server/integrations/gmail/normalize';

test('scan queue recovers expired claims, fences old results and bounds crash retries', async () => {
  const client = postgres(testDatabaseUrl(), { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const owner = randomUUID();
  const key = randomBytes(32).toString('base64');
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.user).values({
      id: owner,
      name: 'Queue fixture',
      email: `${owner}@example.com`,
    });
    const id = await saveConnection(
      db,
      owner,
      `${randomUUID()}@example.com`,
      {
        accessToken: 'fixture',
        refreshToken: 'fixture',
        expiresAt: Date.now() + 3600000,
      },
      tokenVault(key),
    );
    const store = scanStore(db, owner);
    await requestScan(db, owner, id);
    const abandoned = await store.acquire(id);
    await db
      .update(schema.sourceConnections)
      .set({ scanLeaseUntil: new Date(Date.now() - 1), scanAttempts: 1 })
      .where(eq(schema.sourceConnections.id, id));
    let reads = 0;
    const worker = scanQueue(db, {
      encryptionKey: key,
      source: {
        recent: async () => {
          reads++;
          return { events: [], fetched: 0, skipped: 0 };
        },
      },
      detector: {
        detect: async () => assert.fail('empty scan must not call AI'),
      },
    });
    assert.equal(await worker.runOne(), true);
    assert.equal(reads, 1);
    await assert.rejects(() =>
      store.persist(
        id,
        abandoned.lease,
        { events: [], detectionEvents: [] },
        [],
        0,
      ),
    );
    await store.fail(id, abandoned.lease, 'GMAIL_API');
    assert.equal((await store.connections())[0].lastScanError, null);
    await db
      .update(schema.sourceConnections)
      .set({ lastScanAt: null })
      .where(eq(schema.sourceConnections.id, id));
    await requestScan(db, owner, id);
    await db
      .update(schema.sourceConnections)
      .set({ scanAttempts: 3 })
      .where(eq(schema.sourceConnections.id, id));
    assert.equal(await worker.runOne(), true);
    assert.equal(reads, 1, 'exhausted jobs cannot call Gmail');
    assert.equal((await store.connections())[0].lastScanError, 'STORAGE');
    assert.equal((await store.connections())[0].scanRequestedAt, null);
    await requestScan(db, owner, id);
    await detachConnection(db, owner, id);
    assert.equal(await worker.runOne(), false);
    assert.equal((await store.connections())[0].scanRequestedAt, null);
  } finally {
    await client.end();
  }
});

test('production persistence: durable scans, OAuth replay protection and authenticated private-data erasure', async () => {
  const client = postgres(testDatabaseUrl(), { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const owner = randomUUID(),
    other = randomUUID();
  const secret = randomBytes(32).toString('base64');
  const sessionToken = randomBytes(32).toString('base64url');
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    await checkDatabase(db);
    await db.insert(schema.user).values(
      [owner, other].map((id) => ({
        id,
        name: 'Fixture',
        email: `${id}@example.com`,
      })),
    );
    const [session] = await db
      .insert(schema.session)
      .values({
        userId: owner,
        token: sessionToken,
        expiresAt: new Date(Date.now() + 3600000),
      })
      .returning();
    const connectionId = await saveConnection(
      db,
      owner,
      `${randomUUID()}@example.com`,
      {
        accessToken: 'private-access',
        refreshToken: 'private-refresh',
        expiresAt: Date.now() + 3600000,
      },
      tokenVault(secret),
    );
    const state = {
      state: randomBytes(32).toString('base64url'),
      expiresAt: Date.now() + 600000,
    };
    const identity = { userId: owner, sessionId: session.id };
    await rememberOAuthState(db, state, identity);
    await assert.rejects(() =>
      consumeOAuthState(db, state.state, { ...identity, userId: other }),
    );
    await assert.rejects(() =>
      consumeOAuthState(db, state.state, {
        ...identity,
        sessionId: randomUUID(),
      }),
    );
    const consumed = await Promise.allSettled([
      consumeOAuthState(db, state.state, identity),
      consumeOAuthState(db, state.state, identity),
    ]);
    assert.equal(consumed.filter((r) => r.status === 'fulfilled').length, 1);
    await rememberOAuthState(
      db,
      { ...state, expiresAt: Date.now() - 1 },
      identity,
    );
    await assert.rejects(() => consumeOAuthState(db, state.state, identity));

    await assert.rejects(() => requestScan(db, other, connectionId));
    await requestScan(db, owner, connectionId);
    await assert.rejects(() => requestScan(db, owner, connectionId));
    let calls = 0;
    const queue = scanQueue(db, {
      encryptionKey: secret,
      source: {
        recent: async () => {
          calls++;
          return {
            events: [normalizeGmail(gmailFixture(), 'fixture@example.com')!],
            fetched: 1,
            skipped: 0,
          };
        },
      },
      detector: {
        detect: async (events) => ({
          candidates: [candidateFixture([events[0].id])],
        }),
      },
    });
    assert.equal(calls, 0, 'request only enqueues');
    await Promise.all([queue.runOne(), queue.runOne()]);
    assert.equal(calls, 1);
    const review = await scanStore(db, owner).review();
    assert.equal(review.candidates.length, 1);
    assert.equal(review.connections[0].scanRequestedAt, null);
    const candidate = review.candidates[0];
    const loopId = await scanStore(db, owner).accept(
      candidate.id,
      candidate.version,
    );
    const loop = (await loopService(db, owner).get(loopId))!.loop;
    await loopService(db, owner).configureMonitoring(loopId, loop.version, {
      enabled: 'true',
      cadenceHours: '24',
      nextCheckAt: new Date(Date.now() - 60000).toISOString(),
    });
    const [job] = await db
      .select()
      .from(schema.agentJobs)
      .where(eq(schema.agentJobs.loopId, loopId));
    const leaseId = randomUUID();
    await db
      .update(schema.agentJobs)
      .set({
        status: 'RUNNING',
        leaseId,
        leaseUntil: new Date(Date.now() + 90000),
      })
      .where(eq(schema.agentJobs.id, job.id));
    const otherLoop = await loopService(db, other).create({
      title: 'Keep this situation',
      summary: 'Private other account',
      desiredOutcome: 'A confirmed repair',
      status: 'OPEN',
      waitingOn: '',
      expectedBy: '',
      nextAction: '',
      verificationCondition: 'Repair is inspected',
    });
    await assert.rejects(() =>
      eraseAccount(
        db,
        { userId: other, sessionToken },
        { confirmation: 'DELETE' },
        async () => true,
      ),
    );
    await assert.rejects(() =>
      eraseAccount(
        db,
        { userId: owner, sessionToken },
        { confirmation: 'no' },
        async () => true,
      ),
    );
    await assert.rejects(() =>
      db.delete(schema.loopEvents).where(eq(schema.loopEvents.loopId, loopId)),
    );
    const erased = await eraseAccount(
      db,
      { userId: owner, sessionToken },
      { confirmation: 'DELETE' },
      async () => {
        assert.equal(
          (
            await db
              .select()
              .from(schema.sourceConnections)
              .where(eq(schema.sourceConnections.userId, owner))
          ).length,
          0,
          'tokens removed before revocation',
        );
        throw new Error('provider unavailable with private body');
      },
    );
    assert.equal(erased.revoked, false);
    for (const table of [
      schema.loops,
      schema.sourceConnections,
      schema.externalEvents,
      schema.loopCandidates,
      schema.agentJobs,
      schema.session,
      schema.account,
      schema.oauthStates,
    ]) {
      assert.equal(
        (
          await db
            .select({ id: table.userId })
            .from(table)
            .where(eq(table.userId, owner))
        ).length,
        0,
      );
    }
    assert.equal(
      (
        await db
          .select()
          .from(schema.loopEvents)
          .where(eq(schema.loopEvents.loopId, loopId))
      ).length,
      0,
    );
    assert.equal(
      (await db.select().from(schema.user).where(eq(schema.user.id, owner)))
        .length,
      0,
    );
    assert.equal(
      await agentStore(db).renewLease(job.id, owner, leaseId),
      false,
    );
    assert.equal(
      await agentStore(db).updateConnectionTokens(
        job,
        leaseId,
        connectionId,
        'stale-private-token',
      ),
      false,
    );
    assert.ok(await loopService(db, other).get(otherLoop.id));
    await assert.rejects(() =>
      db
        .delete(schema.loopEvents)
        .where(eq(schema.loopEvents.loopId, otherLoop.id)),
    );
    assert.ok(
      !(
        await db.execute(
          sql`select current_setting('loopend.erasing_owner', true) as owner`,
        )
      )[0].owner,
    );
    assert.equal(
      (
        await db
          .select()
          .from(schema.loops)
          .where(
            and(
              eq(schema.loops.id, otherLoop.id),
              eq(schema.loops.userId, other),
            ),
          )
      ).length,
      1,
    );
  } finally {
    await client.end();
  }
});
