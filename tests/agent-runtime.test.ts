import { testDatabaseUrl } from '../src/server/db/test-safety';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
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
import { MonitoringConflictError } from '../src/domain/loops';
import {
  AGENT_CONTEXT_MESSAGES,
  type AgentEvaluator,
} from '../src/domain/agent';

test('durable monitoring claims safely, observes Gmail evidence, and preserves completion authority', async (t) => {
  const url = testDatabaseUrl();
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
    await loopService(db, userId).configureMonitoring(
      loopId,
      loop.monitoringGeneration,
      {
        enabled: 'true',
        cadenceHours: '24',
        nextCheckAt: new Date(Date.now() + 60_000).toISOString(),
      },
    );
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
    runtime: { leaseMs?: number; heartbeatMs?: number } = {},
  ) =>
    agentRuntimeService(db, {
      source: source(messages),
      evaluator,
      encryptionKey: key,
      ...runtime,
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
        const transientId = randomUUID();
        await db.insert(schema.externalEvents).values({
          id: transientId,
          userId,
          connectionId: disabled.connectionId,
          provider: 'gmail',
          messageId: `paused-${randomUUID()}`,
          conversationId: 'agent-thread',
          sender: 'Temporary sender',
          subject: 'Temporary subject',
          occurredAt: new Date(),
          content: 'Temporary uncited monitoring evidence.',
          metadata: { direction: 'incoming', possibleDates: [] },
          dedupeKey: sourceKey(disabled.connectionId, transientId),
        });
        const record = (await loopService(db, userId).get(disabled.loopId))!
          .loop;
        await loopService(db, userId).configureMonitoring(
          disabled.loopId,
          record.monitoringGeneration,
          {
            enabled: 'false',
            cadenceHours: '24',
          },
        );
        const [minimized] = await db
          .select({ content: schema.externalEvents.content })
          .from(schema.externalEvents)
          .where(eq(schema.externalEvents.id, transientId));
        assert.equal(minimized.content, '');
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
      'explicit first check can run before a future expected date',
      async () => {
        const tracked = await createTracked();
        let record = (await loopService(db, userId).get(tracked.loopId))!.loop;
        const futureExpected = '2099-10-02';
        await loopService(db, userId).update(tracked.loopId, record.version, {
          ...record,
          expectedBy: futureExpected,
        });
        record = (await loopService(db, userId).get(tracked.loopId))!.loop;
        const requested = new Date(Date.now() + 60_000);
        await loopService(db, userId).configureMonitoring(
          tracked.loopId,
          record.monitoringGeneration,
          {
            enabled: 'true',
            cadenceHours: '72',
            nextCheckAt: requested.toISOString(),
          },
        );
        const updated = (await loopService(db, userId).get(tracked.loopId))!
          .loop;
        const afterExpected = new Date(`${futureExpected}T12:00:00.000Z`);
        afterExpected.setUTCDate(afterExpected.getUTCDate() + 1);
        assert.ok(updated.monitoringNextCheckAt);
        assert.ok(updated.monitoringNextCheckAt < afterExpected);
      },
    );
    await t.test(
      'monitoring updates ignore worker versions but reject conflicting schedules',
      async () => {
        const tracked = await createTracked();
        await isolateDue(tracked.jobId);
        const beforeWorker = (await loopService(db, userId).get(
          tracked.loopId,
        ))!.loop;
        await run([], {
          evaluate: async () => assert.fail('no model call'),
        }).runOne();
        const afterWorker = (await loopService(db, userId).get(tracked.loopId))!
          .loop;
        assert.ok(afterWorker.version > beforeWorker.version);
        assert.equal(
          afterWorker.monitoringGeneration,
          beforeWorker.monitoringGeneration,
        );

        const scheduled = new Date(Date.now() + 5 * 60_000);
        const updated = await loopService(db, userId).configureMonitoring(
          tracked.loopId,
          beforeWorker.monitoringGeneration,
          {
            enabled: 'true',
            cadenceHours: '72',
            nextCheckAt: scheduled.toISOString(),
          },
        );
        assert.equal(
          updated.monitoringNextCheckAt?.getTime(),
          scheduled.getTime(),
        );

        await assert.rejects(
          () =>
            loopService(db, userId).configureMonitoring(
              tracked.loopId,
              beforeWorker.monitoringGeneration,
              {
                enabled: 'true',
                cadenceHours: '24',
                nextCheckAt: new Date(Date.now() + 10 * 60_000).toISOString(),
              },
            ),
          MonitoringConflictError,
        );

        const record = (await loopService(db, userId).get(tracked.loopId))!;
        const active = await db
          .select()
          .from(schema.agentJobs)
          .where(
            and(
              eq(schema.agentJobs.loopId, tracked.loopId),
              eq(schema.agentJobs.generation, record.loop.monitoringGeneration),
              eq(schema.agentJobs.status, 'PENDING'),
            ),
          );
        assert.equal(active.length, 1);
        assert.equal(
          record.events.filter(
            (event) => event.type === 'monitoring.rescheduled',
          ).length,
          1,
        );
      },
    );
    await t.test(
      'invalid, closed, and cross-user monitoring changes are rejected',
      async () => {
        const tracked = await createTracked();
        const record = (await loopService(db, userId).get(tracked.loopId))!
          .loop;
        await assert.rejects(
          () =>
            loopService(db, userId).configureMonitoring(
              tracked.loopId,
              record.monitoringGeneration,
              {
                enabled: 'true',
                cadenceHours: '24',
                nextCheckAt: new Date(Date.now() - 60_000).toISOString(),
              },
            ),
          /future time/,
        );
        const other = randomUUID();
        await db.insert(schema.user).values({
          id: other,
          name: 'Other monitoring user',
          email: `${other}@example.com`,
        });
        await assert.rejects(() =>
          loopService(db, other).configureMonitoring(
            tracked.loopId,
            record.monitoringGeneration,
            { enabled: 'false', cadenceHours: '24' },
          ),
        );
        await loopService(db, userId).update(tracked.loopId, record.version, {
          ...record,
          expectedBy: record.expectedBy ?? '',
          status: 'VERIFYING',
        });
        const verifying = (await loopService(db, userId).get(tracked.loopId))!
          .loop;
        assert.equal(verifying.monitoringEnabled, false);
        assert.equal(verifying.monitoringNextCheckAt, null);
        await loopService(db, userId).complete(
          tracked.loopId,
          verifying.version,
          {
            evidence: 'A person verified the refund in their account.',
            confirmed: true,
          },
        );
        const closed = (await loopService(db, userId).get(tracked.loopId))!
          .loop;
        await assert.rejects(() =>
          loopService(db, userId).configureMonitoring(
            tracked.loopId,
            closed.monitoringGeneration,
            { enabled: 'true', cadenceHours: '24' },
          ),
        );
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
              'The store says the refund was issued in the email from 2026-09-25T14:02:55.000Z. Please verify it in your account.',
          }),
        }).runOne();
        const record = await loopService(db, userId).get(tracked.loopId);
        assert.equal(record?.loop.status, 'VERIFYING');
        assert.equal(record?.loop.monitoringEnabled, false);
        assert.equal(record?.loop.monitoringNextCheckAt, null);
        assert.ok(
          record?.events.some(
            (event) =>
              event.type === 'agent.possible_outcome_detected' &&
              !event.body.includes('2026-09-25T14:02:55.000Z'),
          ),
        );
        const activeJobs = await db
          .select()
          .from(schema.agentJobs)
          .where(
            and(
              eq(schema.agentJobs.loopId, tracked.loopId),
              inArray(schema.agentJobs.status, ['PENDING', 'RUNNING']),
            ),
          );
        assert.equal(activeJobs.length, 0);
        const staleGeneration = record!.loop.monitoringGeneration - 1;
        const [staleJob] = await db
          .insert(schema.agentJobs)
          .values({
            userId,
            loopId: tracked.loopId,
            generation: staleGeneration,
            idempotencyKey: randomUUID(),
            runAt: new Date(Date.now() - 1_000),
          })
          .returning();
        const staleWorker = run([], {
          evaluate: async () => assert.fail('a stale job must not evaluate'),
        });
        assert.equal(await staleWorker.runOne(), true);
        const afterStale = await loopService(db, userId).get(tracked.loopId);
        assert.equal(afterStale?.loop.status, 'VERIFYING');
        const [finishedStaleJob] = await db
          .select()
          .from(schema.agentJobs)
          .where(eq(schema.agentJobs.id, staleJob.id));
        assert.ok(
          ['COMPLETED', 'CANCELLED'].includes(finishedStaleJob.status),
          'a stale job must never become active again',
        );
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
      'heartbeat protects long work from reclaim while a lost holder cannot apply stale results',
      async () => {
        const protectedJob = await createTracked();
        await isolateDue(protectedJob.jobId);
        const newMessage = normalizeGmail(
          gmailFixture(
            `agent-heartbeat-${randomUUID()}`,
            'agent-thread',
            'We have completed the refund.',
          ),
          'owner@example.com',
        )!;
        let entered!: () => void;
        const evaluating = new Promise<void>((resolve) => {
          entered = resolve;
        });
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const execution = run(
          [original, newMessage],
          {
            evaluate: async (input) => {
              entered();
              await held;
              return {
                decision: 'STILL_WAITING',
                rationale: 'The evidence still needs verification.',
                evidenceReferences: [input.evidence.at(-1)!.id],
                recommendedNextCheckAt: null,
                userSummary: 'Loopend will check again later.',
              };
            },
          },
          { leaseMs: 120, heartbeatMs: 25 },
        ).runOne();
        await evaluating;
        await new Promise((resolve) => setTimeout(resolve, 220));
        assert.equal(
          await agentStore(db, { leaseMs: 120 }).claimDue(),
          null,
          'a healthy long-running lease must not be reclaimed',
        );
        release();
        await execution;

        const staleJob = await createTracked();
        await isolateDue(staleJob.jobId);
        let staleEntered!: () => void;
        const staleEvaluating = new Promise<void>((resolve) => {
          staleEntered = resolve;
        });
        let staleRelease!: () => void;
        const staleHeld = new Promise<void>((resolve) => {
          staleRelease = resolve;
        });
        const staleExecution = run(
          [original, newMessage],
          {
            evaluate: async (input) => {
              staleEntered();
              await staleHeld;
              return {
                decision: 'POSSIBLE_SUCCESS',
                rationale: 'The refund appears to have completed.',
                evidenceReferences: [input.evidence.at(-1)!.id],
                recommendedNextCheckAt: null,
                userSummary: 'Review the apparent refund completion.',
              };
            },
          },
          { leaseMs: 120, heartbeatMs: 25 },
        ).runOne();
        await staleEvaluating;
        await db
          .update(schema.agentJobs)
          .set({ leaseId: randomUUID(), leaseUntil: new Date(Date.now() - 1) })
          .where(eq(schema.agentJobs.id, staleJob.jobId));
        const replacement = await agentStore(db, {
          leaseMs: 120,
        }).claimDue();
        assert.equal(replacement?.job.id, staleJob.jobId);
        await new Promise((resolve) => setTimeout(resolve, 50));
        staleRelease();
        await staleExecution;
        const staleRecord = await loopService(db, userId).get(staleJob.loopId);
        assert.equal(staleRecord?.loop.status, 'WAITING');
        assert.equal(
          staleRecord?.events.some(
            (event) => event.type === 'agent.possible_outcome_detected',
          ),
          false,
        );
        await agentStore(db, { leaseMs: 120 }).finishNoop(
          replacement!.job.id,
          userId,
          replacement!.leaseId,
        );
      },
    );
    await t.test(
      'persisted maxAttempts controls deterministic exhaustion and is bounded',
      async () => {
        const tracked = await createTracked();
        await isolateDue(tracked.jobId);
        await db
          .update(schema.agentJobs)
          .set({ maxAttempts: 2 })
          .where(eq(schema.agentJobs.id, tracked.jobId));
        const first = normalizeGmail(
          gmailFixture(
            `agent-attempt-one-${randomUUID()}`,
            'agent-thread',
            'We are reviewing the refund.',
          ),
          'owner@example.com',
        )!;
        await run([original, first], {
          evaluate: async () => ({ malformed: true }),
        }).runOne();
        let [job] = await db
          .select()
          .from(schema.agentJobs)
          .where(eq(schema.agentJobs.id, tracked.jobId));
        assert.equal(job.status, 'PENDING');
        assert.equal(job.attempts, 1);
        await db
          .update(schema.agentJobs)
          .set({ runAt: new Date(Date.now() - 1_000) })
          .where(eq(schema.agentJobs.id, tracked.jobId));
        const second = normalizeGmail(
          gmailFixture(
            `agent-attempt-two-${randomUUID()}`,
            'agent-thread',
            'The review is taking longer than expected.',
          ),
          'owner@example.com',
        )!;
        await run([original, first, second], {
          evaluate: async () => ({ malformed: true }),
        }).runOne();
        [job] = await db
          .select()
          .from(schema.agentJobs)
          .where(eq(schema.agentJobs.id, tracked.jobId));
        assert.equal(job.attempts, 2);
        assert.equal(job.status, 'COMPLETED');
        assert.equal(
          (await loopService(db, userId).get(tracked.loopId))?.loop.status,
          'NEEDS_USER',
        );
        for (const invalid of [0, 11])
          await assert.rejects(() =>
            db.insert(schema.agentJobs).values({
              userId,
              loopId: tracked.loopId,
              generation: 99,
              idempotencyKey: randomUUID(),
              runAt: new Date(),
              maxAttempts: invalid,
            }),
          );
      },
    );
    await t.test(
      'long conversations retain trace identity but only cited and provenance evidence text',
      async () => {
        const tracked = await createTracked();
        await isolateDue(tracked.jobId);
        const bulk = Array.from({ length: 25 }, (_, index) => {
          const raw = gmailFixture(
            `agent-bulk-${index}-${randomUUID()}`,
            'agent-thread',
            `Conversation update ${index}: refund review evidence.`,
          );
          raw.internalDate = String(Date.now() + (index + 1) * 1_000);
          return normalizeGmail(raw, 'owner@example.com')!;
        });
        let evaluatorCount = 0;
        let citedId = '';
        let evaluationStarted!: () => void;
        const activeEvaluation = new Promise<void>((resolve) => {
          evaluationStarted = resolve;
        });
        let finishEvaluation!: () => void;
        const evaluationHeld = new Promise<void>((resolve) => {
          finishEvaluation = resolve;
        });
        const execution = run([original, ...bulk], {
          evaluate: async (input) => {
            evaluatorCount = input.evidence.length;
            citedId = input.evidence.at(-1)!.id;
            evaluationStarted();
            await evaluationHeld;
            return {
              decision: 'POSSIBLE_SUCCESS',
              rationale: 'The latest message contains completion evidence.',
              evidenceReferences: [citedId],
              recommendedNextCheckAt: null,
              userSummary: 'Review the latest completion evidence.',
            };
          },
        }).runOne();
        await activeEvaluation;
        const scanning = scanStore(db, userId);
        const { lease } = await scanning.acquire(tracked.connectionId);
        const prepared = await scanning.prepare(tracked.connectionId, [
          original,
        ]);
        await scanning.persist(tracked.connectionId, lease, prepared, [], 1);
        const [activeExcerpt] = await db
          .select({ content: schema.externalEvents.content })
          .from(schema.externalEvents)
          .where(
            and(
              eq(schema.externalEvents.connectionId, tracked.connectionId),
              eq(schema.externalEvents.messageId, bulk.at(-1)!.messageId),
            ),
          );
        assert.ok(
          activeExcerpt.content,
          'scan cleanup must not erase an in-flight evaluation window',
        );
        finishEvaluation();
        await execution;
        assert.ok(evaluatorCount <= AGENT_CONTEXT_MESSAGES + 1);
        const stored = await db
          .select()
          .from(schema.externalEvents)
          .where(
            and(
              eq(schema.externalEvents.connectionId, tracked.connectionId),
              eq(schema.externalEvents.conversationId, 'agent-thread'),
            ),
          );
        assert.equal(stored.length, 26);
        assert.equal(
          stored.filter((event) => event.content.length > 0).length,
          2,
          'only accepted provenance and cited evidence retain excerpts',
        );
        const minimized = stored.find((event) =>
          event.messageId.startsWith('agent-bulk-0-'),
        );
        assert.equal(minimized?.content, '');
        assert.equal(minimized?.sender, '');
        assert.equal(minimized?.subject, '');
        assert.ok(minimized?.dedupeKey);
        const record = await loopService(db, userId).get(tracked.loopId);
        assert.equal(
          record?.evidence.some((item) => item.id === citedId),
          true,
        );
        assert.ok(
          record?.evidence.find((item) => item.id === citedId)?.content,
          'cited evidence remains inspectable',
        );
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
