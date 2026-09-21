import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { and, eq, ne, sql } from 'drizzle-orm';
import * as schema from '../src/server/db/schema';
import { tokenVault } from '../src/server/integrations/crypto';
import { saveConnection } from '../src/server/integrations/gmail/connections';
import { normalizeGmail } from '../src/server/integrations/gmail/normalize';
import { gmailFixture } from './fixtures/scan';
import { scanStore, sourceKey } from '../src/server/scan/store';
import { loopService } from '../src/server/loops/service';
import { agentRuntimeService } from '../src/server/agent/service';
import { agentStore } from '../src/server/agent/store';
import { ScanError } from '../src/domain/scan';
import type { AgentEvaluator } from '../src/domain/agent';

test('durable monitoring claims safely, observes Gmail evidence, and preserves completion authority', async (t) => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url);
  assert.notEqual(url, process.env.DATABASE_URL);
  const client = postgres(url, { max: 8, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const key = randomBytes(32).toString('base64');
  const vault = tokenVault(key);
  const userId = randomUUID();
  const tokens = {
    accessToken: 'agent-test-access',
    refreshToken: 'agent-test-refresh',
    expiresAt: Date.now() + 3_600_000,
  };
  const original = normalizeGmail(
    gmailFixture(
      'agent-initial',
      'agent-thread',
      'We will refund you shortly.',
    ),
    'owner@example.com',
  )!;
  const createTracked = async () => {
    const connectionId = await saveConnection(
      db,
      userId,
      `${randomUUID()}@example.com`,
      tokens,
      vault,
    );
    const eventId = randomUUID();
    await db.insert(schema.externalEvents).values({
      id: eventId,
      userId,
      connectionId,
      provider: 'gmail',
      messageId: original.messageId,
      conversationId: original.conversationId,
      sender: original.sender,
      subject: original.subject,
      occurredAt: original.occurredAt,
      content: original.content,
      metadata: original.metadata,
      dedupeKey: sourceKey(connectionId, original.messageId),
    });
    const [candidate] = await db
      .insert(schema.loopCandidates)
      .values({
        userId,
        connectionId,
        conversationId: original.conversationId,
        dedupeKey: sourceKey(connectionId, `candidate:${randomUUID()}`),
        title: 'Refund is still pending',
        summary: 'The store promised a refund.',
        desiredOutcome: 'The refund appears in the bank account.',
        waitingOn: 'Store support',
        nextAction: 'Wait for confirmation.',
        verificationCondition: 'A refund confirmation or bank credit appears.',
        confidence: 'HIGH',
        reason: 'The store made a concrete promise.',
        sourceReferences: [eventId],
      })
      .returning();
    const loopId = await scanStore(db, userId).accept(
      candidate.id,
      candidate.version,
    );
    const loop = (await loopService(db, userId).get(loopId))!.loop;
    await loopService(db, userId).configureMonitoring(loopId, loop.version, {
      enabled: 'true',
      cadenceHours: '24',
      nextCheckAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const [job] = await db
      .select()
      .from(schema.agentJobs)
      .where(eq(schema.agentJobs.loopId, loopId));
    await db
      .update(schema.agentJobs)
      .set({ runAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.agentJobs.id, job.id));
    return { loopId, connectionId, jobId: job.id };
  };
  const isolateDue = async (jobId: string) => {
    await db
      .update(schema.agentJobs)
      .set({
        status: 'PENDING',
        leaseId: null,
        leaseUntil: null,
        runAt: new Date(Date.now() + 365 * 24 * 3_600_000),
      })
      .where(ne(schema.agentJobs.id, jobId));
  };
  const source = (messages: ReturnType<typeof normalizeGmail>[]) => ({
    recent: async () => ({ events: [], fetched: 0, skipped: 0 }),
    conversation: async () =>
      messages.filter((item): item is NonNullable<typeof item> => !!item),
  });
  const run = (
    messages: ReturnType<typeof normalizeGmail>[],
    evaluator: AgentEvaluator,
  ) =>
    agentRuntimeService(db, {
      source: source(messages),
      evaluator,
      encryptionKey: key,
    });
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.user).values({
      id: userId,
      name: 'Agent test',
      email: `${userId}@example.com`,
    });
    await t.test(
      'a due job has one concurrent claimant and survives a worker restart',
      async () => {
        const tracked = await createTracked();
        await isolateDue(tracked.jobId);
        const store = agentStore(db);
        const claims = await Promise.all([store.claimDue(), store.claimDue()]);
        assert.equal(claims.filter(Boolean).length, 1);
        const claim = claims.find(Boolean)!;
        await db
          .update(schema.agentJobs)
          .set({ leaseUntil: new Date(Date.now() - 1_000) })
          .where(eq(schema.agentJobs.id, claim.job.id));
        const restarted = await store.claimDue();
        assert.equal(restarted?.job.id, tracked.jobId);
        await store.finishNoop(restarted!.job.id, userId, restarted!.leaseId);
      },
    );
    await t.test(
      'disabled and closed Loops make stale monitoring jobs harmless no-ops',
      async () => {
        const disabled = await createTracked();
        await isolateDue(disabled.jobId);
        const record = (await loopService(db, userId).get(disabled.loopId))!
          .loop;
        await loopService(db, userId).configureMonitoring(
          disabled.loopId,
          record.version,
          {
            enabled: 'false',
            cadenceHours: '24',
          },
        );
        let calls = 0;
        await run([], {
          evaluate: async () => {
            calls++;
            return {};
          },
        }).runOne();
        assert.equal(calls, 0);
        const closed = await createTracked();
        await isolateDue(closed.jobId);
        let current = (await loopService(db, userId).get(closed.loopId))!.loop;
        await loopService(db, userId).update(closed.loopId, current.version, {
          ...current,
          expectedBy: current.expectedBy ?? '',
          status: 'VERIFYING',
        });
        current = (await loopService(db, userId).get(closed.loopId))!.loop;
        await loopService(db, userId).complete(closed.loopId, current.version, {
          evidence: 'A person verified the refund in their account.',
          confirmed: true,
        });
        await run([], {
          evaluate: async () => {
            calls++;
            return {};
          },
        }).runOne();
        assert.equal(calls, 0);
      },
    );
    await t.test(
      'no new evidence reschedules conservatively and repeated delivery applies once',
      async () => {
        const tracked = await createTracked();
        await isolateDue(tracked.jobId);
        const worker = run([], {
          evaluate: async () => assert.fail('no model call'),
        });
        assert.equal(await worker.runOne(), true);
        const record = await loopService(db, userId).get(tracked.loopId);
        assert.equal(record?.loop.status, 'WAITING');
        assert.ok(record?.loop.monitoringNextCheckAt);
        const [job] = await db
          .select()
          .from(schema.agentJobs)
          .where(eq(schema.agentJobs.id, tracked.jobId));
        assert.equal(job.status, 'COMPLETED');
        assert.equal(await worker.runOne(), false);
      },
    );
    await t.test(
      'possible success moves to VERIFYING and still needs human confirmation to close',
      async () => {
        const tracked = await createTracked();
        await isolateDue(tracked.jobId);
        const resolution = normalizeGmail(
          gmailFixture(
            'agent-success',
            'agent-thread',
            'Your refund has been issued and is now complete.',
          ),
          'owner@example.com',
        )!;
        await run([original, resolution], {
          evaluate: async (input) => ({
            decision: 'POSSIBLE_SUCCESS',
            rationale: 'The store says the refund was issued.',
            evidenceReferences: [input.evidence.at(-1)!.id],
            recommendedNextCheckAt: null,
            userSummary:
              'The store says the refund was issued. Please verify it in your account.',
          }),
        }).runOne();
        const record = await loopService(db, userId).get(tracked.loopId);
        assert.equal(record?.loop.status, 'VERIFYING');
        await assert.rejects(
          () =>
            loopService(db, userId).complete(
              tracked.loopId,
              record!.loop.version,
              { evidence: 'short', confirmed: true },
            ),
          /at least 10/,
        );
        assert.equal(
          (await loopService(db, userId).get(tracked.loopId))?.loop.status,
          'VERIFYING',
        );
      },
    );
    await t.test(
      'invalid output retries without a VERIFYING transition; temporary failures back off',
      async () => {
        const tracked = await createTracked();
        await isolateDue(tracked.jobId);
        const newMessage = normalizeGmail(
          gmailFixture(
            'agent-invalid',
            'agent-thread',
            'We are still looking into this.',
          ),
          'owner@example.com',
        )!;
        await run([original, newMessage], {
          evaluate: async () => ({ malformed: true }),
        }).runOne();
        let [job] = await db
          .select()
          .from(schema.agentJobs)
          .where(eq(schema.agentJobs.id, tracked.jobId));
        assert.equal(job.status, 'PENDING');
        assert.equal(job.lastError, 'AI_OUTPUT');
        assert.equal(
          (await loopService(db, userId).get(tracked.loopId))?.loop.status,
          'WAITING',
        );
        await db
          .update(schema.agentJobs)
          .set({ runAt: new Date(Date.now() - 1_000) })
          .where(eq(schema.agentJobs.id, job.id));
        const laterMessage = normalizeGmail(
          gmailFixture(
            'agent-temporary',
            'agent-thread',
            'We are still reviewing your request.',
          ),
          'owner@example.com',
        )!;
        await run([original, newMessage, laterMessage], {
          evaluate: async () => {
            throw new Error('temporary');
          },
        }).runOne();
        [job] = await db
          .select()
          .from(schema.agentJobs)
          .where(eq(schema.agentJobs.id, tracked.jobId));
        assert.equal(job.status, 'PENDING');
        assert.ok(job.attempts >= 2);
      },
    );
    await t.test(
      'revoked Gmail needs the user and cannot retry forever',
      async () => {
        const tracked = await createTracked();
        await isolateDue(tracked.jobId);
        await run([], {
          evaluate: async () => assert.fail('model must not run'),
        }).runOne();
        // The first empty conversation is a normal wait. Re-run it with an auth failure.
        const [next] = await db
          .select()
          .from(schema.agentJobs)
          .where(
            and(
              eq(schema.agentJobs.loopId, tracked.loopId),
              eq(schema.agentJobs.status, 'PENDING'),
            ),
          );
        await db
          .update(schema.agentJobs)
          .set({ runAt: new Date(Date.now() - 1_000) })
          .where(eq(schema.agentJobs.id, next.id));
        await agentRuntimeService(db, {
          source: {
            recent: async () => ({ events: [], fetched: 0, skipped: 0 }),
            conversation: async () => {
              throw new ScanError('GMAIL_AUTH');
            },
          },
          evaluator: {
            evaluate: async () => assert.fail('model must not run'),
          },
          encryptionKey: key,
        }).runOne();
        const record = await loopService(db, userId).get(tracked.loopId);
        assert.equal(record?.loop.status, 'NEEDS_USER');
        const [connection] = await db
          .select()
          .from(schema.sourceConnections)
          .where(eq(schema.sourceConnections.id, tracked.connectionId));
        assert.equal(connection.status, 'NEEDS_REAUTH');
      },
    );
    await t.test('jobs and monitoring remain owner-scoped', async () => {
      const other = randomUUID();
      await db
        .insert(schema.user)
        .values({ id: other, name: 'Other', email: `${other}@example.com` });
      const tracked = await createTracked();
      await assert.rejects(() =>
        db.insert(schema.agentJobs).values({
          userId: other,
          loopId: tracked.loopId,
          generation: 1,
          idempotencyKey: randomUUID(),
          runAt: new Date(),
        }),
      );
      assert.equal(
        (
          await db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.agentJobs)
            .where(eq(schema.agentJobs.userId, other))
        )[0].count,
        0,
      );
    });
  } finally {
    await client.end();
  }
});
