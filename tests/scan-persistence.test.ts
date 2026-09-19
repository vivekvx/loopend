import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../src/server/db/schema';
import { gmailClient } from '../src/server/integrations/gmail/client';
import { tokenVault } from '../src/server/integrations/crypto';
import {
  saveConnection,
  detachConnection,
} from '../src/server/integrations/gmail/connections';
import { loopScanService } from '../src/server/scan/service';
import { structuredDetector } from '../src/server/scan/detector';
import { scanStore } from '../src/server/scan/store';
import { normalizeGmail } from '../src/server/integrations/gmail/normalize';
import type { Detector } from '../src/domain/scan';
import { candidateFixture, gmailFixture } from './fixtures/scan';

test('Loop Scan persists suggestions, dedupes evidence, honors decisions, and promotes exactly once', async (t) => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url);
  assert.notEqual(url, process.env.DATABASE_URL);
  const client = postgres(url, { max: 5, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const key = randomBytes(32).toString('base64');
  const vault = tokenVault(key);
  const tokens = {
    accessToken: 'test-access',
    refreshToken: 'test-refresh',
    expiresAt: Date.now() + 3600_000,
  };
  const newConnection = () =>
    saveConnection(db, `${randomUUID()}@example.com`, tokens, vault);
  const resetCooldown = (id: string) =>
    db
      .update(schema.sourceConnections)
      .set({ lastScanAt: null })
      .where(eq(schema.sourceConnections.id, id));
  const source = {
    recent: async () => ({
      events: [normalizeGmail(gmailFixture(), 'owner@example.com')!],
      fetched: 1,
      skipped: 0,
    }),
  };
  const detector: Detector = {
    detect: async (events) => ({
      candidates: events.length ? [candidateFixture([events[0].id])] : [],
    }),
  };
  const service = loopScanService(db, { source, detector, encryptionKey: key });
  const store = scanStore(db);
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    await t.test(
      'mocked Google and AI HTTP boundaries run the complete pipeline',
      async () => {
        const id = await newConnection();
        const google = gmailClient(
          {
            clientId: 'test',
            clientSecret: 'test',
            redirectUri: 'https://test.invalid/callback',
          },
          async (input) => {
            if (new URL(String(input)).pathname.endsWith('/messages'))
              return Response.json({
                messages: [{ id: 'abc123' }, { id: 'receipt' }],
              });
            return Response.json(
              String(input).includes('receipt')
                ? gmailFixture(
                    'receipt',
                    'thread2',
                    'Payment complete. Here is your receipt.',
                  )
                : gmailFixture(),
            );
          },
        );
        const ai = structuredDetector(
          { apiKey: 'test', baseUrl: 'https://ai.test/v1', model: 'fixture' },
          async (_input, options) => {
            const body = JSON.parse(String(options?.body));
            const context = JSON.parse(body.messages[1].content);
            assert.equal(context.events.length, 2);
            assert.doesNotMatch(
              body.messages[1].content,
              /Private quoted history|test-refresh|abc123/,
            );
            return Response.json({
              choices: [
                {
                  finish_reason: 'stop',
                  message: {
                    content: JSON.stringify({
                      candidates: [candidateFixture([context.events[0].id])],
                    }),
                  },
                },
              ],
            });
          },
        );
        const pipeline = loopScanService(db, {
          source: google,
          detector: ai,
          encryptionKey: key,
        });
        assert.equal((await pipeline.scan(id)).added, 1);
        const events = await db
          .select()
          .from(schema.externalEvents)
          .where(eq(schema.externalEvents.connectionId, id));
        assert.equal(events.length, 2);
        assert.equal(
          events.find((event) => event.messageId === 'receipt')?.content,
          '',
        );
        assert.ok(
          events.find((event) => event.messageId === 'abc123')?.content,
        );
        const [connection] = await db
          .select()
          .from(schema.sourceConnections)
          .where(eq(schema.sourceConnections.id, id));
        assert.doesNotMatch(connection.tokenCiphertext!, /test-refresh/);
        assert.equal(connection.lastScanCount, 2);
        await resetCooldown(id);
        assert.equal((await pipeline.scan(id)).added, 0);
        assert.equal(
          (
            await db
              .select()
              .from(schema.externalEvents)
              .where(eq(schema.externalEvents.connectionId, id))
          ).length,
          2,
        );
      },
    );
    await t.test(
      'refreshing a suggestion removes excerpts no longer cited by any candidate',
      async () => {
        const id = await newConnection();
        await service.scan(id);
        await resetCooldown(id);
        await loopScanService(db, {
          source: {
            recent: async () => ({
              events: [
                normalizeGmail(
                  gmailFixture('new-evidence'),
                  'owner@example.com',
                )!,
              ],
              fetched: 1,
              skipped: 0,
            }),
          },
          detector,
          encryptionKey: key,
        }).scan(id);
        const events = await db
          .select()
          .from(schema.externalEvents)
          .where(eq(schema.externalEvents.connectionId, id));
        const old = events.find((event) => event.messageId === 'abc123')!;
        assert.equal(old.content, '');
        assert.equal(old.sender, '');
        assert.equal(old.subject, '');
        assert.deepEqual(old.metadata.possibleDates, []);
        assert.ok(
          events.find((event) => event.messageId === 'new-evidence')?.content,
        );
      },
    );
    await t.test(
      'ignoring is sticky through repeated scans and reconnection',
      async () => {
        const id = await newConnection();
        await service.scan(id);
        const [candidate] = await db
          .select()
          .from(schema.loopCandidates)
          .where(eq(schema.loopCandidates.connectionId, id));
        await store.dismiss(candidate.id, candidate.version);
        await store.dismiss(candidate.id, candidate.version);
        const [connection] = await db
          .select()
          .from(schema.sourceConnections)
          .where(eq(schema.sourceConnections.id, id));
        await detachConnection(db, id);
        assert.equal(
          await saveConnection(db, connection.accountEmail, tokens, vault),
          id,
        );
        await resetCooldown(id);
        let called = false;
        await loopScanService(db, {
          source,
          detector: {
            detect: async () => {
              called = true;
              throw new Error();
            },
          },
          encryptionKey: key,
        }).scan(id);
        assert.equal(called, false);
        const results = await db
          .select()
          .from(schema.loopCandidates)
          .where(eq(schema.loopCandidates.connectionId, id));
        assert.equal(results.length, 1);
        assert.equal(results[0].status, 'DISMISSED');
        await assert.rejects(
          () => store.accept(candidate.id, candidate.version),
          /STALE/,
        );
      },
    );
    await t.test(
      'concurrent/repeated human acceptance creates exactly one real Loop with provenance',
      async () => {
        const id = await newConnection();
        await service.scan(id);
        const [candidate] = await db
          .select()
          .from(schema.loopCandidates)
          .where(eq(schema.loopCandidates.connectionId, id));
        const [{ count: before }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.loops);
        const ids = await Promise.all(
          Array.from({ length: 5 }, () =>
            store.accept(candidate.id, candidate.version),
          ),
        );
        assert.equal(new Set(ids).size, 1);
        assert.equal(
          await store.accept(candidate.id, candidate.version),
          ids[0],
        );
        const [{ count: after }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.loops);
        assert.equal(after - before, 1);
        const [loop] = await db
          .select()
          .from(schema.loops)
          .where(eq(schema.loops.id, ids[0]));
        assert.equal(loop.status, 'OPEN');
        assert.equal(loop.closedAt, null);
        const history = await db
          .select()
          .from(schema.loopEvents)
          .where(eq(schema.loopEvents.loopId, loop.id));
        assert.deepEqual(
          history.map((event) => event.type),
          ['loop.created', 'source.accepted'],
        );
        assert.equal(history[1].payload.candidateId, candidate.id);
        await assert.rejects(
          () => store.dismiss(candidate.id, candidate.version),
          /STALE/,
        );
      },
    );
    await t.test(
      'invalid AI output cannot persist suggestions or expose raw payload; low confidence is discarded',
      async () => {
        const id = await newConnection();
        await assert.rejects(
          () =>
            loopScanService(db, {
              source,
              detector: {
                detect: async () => ({
                  candidates: [{ title: 'private invalid content' }],
                }),
              },
              encryptionKey: key,
            }).scan(id),
          (error: Error) => error.message === 'AI_OUTPUT',
        );
        assert.equal(
          (
            await db
              .select()
              .from(schema.loopCandidates)
              .where(eq(schema.loopCandidates.connectionId, id))
          ).length,
          0,
        );
        assert.equal(
          (
            await db
              .select()
              .from(schema.externalEvents)
              .where(eq(schema.externalEvents.connectionId, id))
          ).length,
          0,
        );
        await loopScanService(db, {
          source,
          detector: {
            detect: async (events) => ({
              candidates: [
                { ...candidateFixture([events[0].id]), confidence: 'LOW' },
              ],
            }),
          },
          encryptionKey: key,
        }).scan(id);
        assert.equal(
          (
            await db
              .select()
              .from(schema.loopCandidates)
              .where(eq(schema.loopCandidates.connectionId, id))
          ).length,
          0,
        );
      },
    );
    await t.test(
      'later scans withdraw unsupported pending suggestions without changing real Loops',
      async () => {
        const id = await newConnection();
        await service.scan(id);
        const [before] = await db
          .select()
          .from(schema.loopCandidates)
          .where(eq(schema.loopCandidates.connectionId, id));
        await resetCooldown(id);
        const resolvedSource = {
          recent: async () => ({
            events: [
              normalizeGmail(gmailFixture(), 'owner@example.com')!,
              normalizeGmail(
                gmailFixture(
                  'reply',
                  'thread1',
                  'The refund has arrived in my bank account. Thank you.',
                ),
                'owner@example.com',
              )!,
            ],
            fetched: 2,
            skipped: 0,
          }),
        };
        await loopScanService(db, {
          source: resolvedSource,
          detector: { detect: async () => ({ candidates: [] }) },
          encryptionKey: key,
        }).scan(id);
        const [after] = await db
          .select()
          .from(schema.loopCandidates)
          .where(eq(schema.loopCandidates.id, before.id));
        assert.equal(after.status, 'DISMISSED');
        assert.equal(after.dismissalReason, 'SCAN');
        assert.equal(after.loopId, null);
        await assert.rejects(
          () => store.accept(before.id, before.version),
          /STALE/,
        );
      },
    );
    await t.test(
      'scan lease blocks overlap; disconnect fences in-flight results and erases tokens',
      async () => {
        const id = await newConnection();
        let start!: () => void;
        let release!: () => void;
        const started = new Promise<void>((resolve) => {
          start = resolve;
        });
        const paused = new Promise<void>((resolve) => {
          release = resolve;
        });
        const delayed = loopScanService(db, {
          source: {
            recent: async () => {
              start();
              await paused;
              return source.recent();
            },
          },
          detector,
          encryptionKey: key,
        });
        const running = delayed.scan(id);
        await started;
        await assert.rejects(() => delayed.scan(id), /BUSY/);
        await detachConnection(db, id);
        release();
        await assert.rejects(() => running, /DISCONNECTED/);
        const [connection] = await db
          .select()
          .from(schema.sourceConnections)
          .where(eq(schema.sourceConnections.id, id));
        assert.equal(connection.status, 'DISCONNECTED');
        assert.equal(connection.tokenCiphertext, null);
        assert.equal(
          (
            await db
              .select()
              .from(schema.loopCandidates)
              .where(eq(schema.loopCandidates.connectionId, id))
          ).length,
          0,
        );
      },
    );
  } finally {
    await client.end();
  }
});
