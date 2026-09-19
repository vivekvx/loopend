import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '../src/server/db/schema';
import { createAuth } from '../src/server/auth/config';
import { loopService } from '../src/server/loops/service';
import { scanStore } from '../src/server/scan/store';
import { loopScanService } from '../src/server/scan/service';
import {
  saveConnection,
  detachConnection,
} from '../src/server/integrations/gmail/connections';
import { tokenVault } from '../src/server/integrations/crypto';
import { normalizeGmail } from '../src/server/integrations/gmail/normalize';
import { candidateFixture, gmailFixture } from './fixtures/scan';
import { LEGACY_OWNER_ID } from '../src/domain/ownership';
import { claimLegacy } from '../src/server/db/claim-legacy';

test('real accounts, sessions, ownership constraints, and tenant isolation', async (t) => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url);
  assert.notEqual(url, process.env.DATABASE_URL);
  const client = postgres(url, { max: 5, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const origin = 'https://loopend.test';
  const auth = createAuth(db, {
    secret: randomBytes(32).toString('base64'),
    origin,
    secure: true,
  });
  const request = (
    path: string,
    body?: unknown,
    cookie = '',
    requestOrigin = origin,
  ) =>
    auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: requestOrigin,
          Cookie: cookie,
          'x-forwarded-for': '192.0.2.32',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const cookieFrom = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
  const signup = async () => {
    const email = `${randomUUID()}@example.com`;
    const password = randomBytes(24).toString('base64url');
    const response = await request('/sign-up/email', {
      email,
      password,
      name: 'Isolation reader',
    });
    assert.equal(response.status, 200);
    const result = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await response.json());
    return {
      id: result.user.id,
      email,
      password,
      cookie: cookieFrom(response),
    };
  };
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    const a = await signup();
    const b = await signup();
    const input = {
      title: 'Private refund',
      summary: 'Waiting for the return.',
      desiredOutcome: 'Refund reaches my account.',
      waitingOn: 'Store',
      expectedBy: '',
      nextAction: 'Check bank.',
      verificationCondition: 'Credit appears on statement.',
      status: 'VERIFYING',
    };
    const loopsA = loopService(db, a.id);
    const loopsB = loopService(db, b.id);
    const loopB = await loopsB.create({ ...input, userId: a.id });
    const key = randomBytes(32).toString('base64');
    const tokens = {
      accessToken: 'fixture-access',
      refreshToken: 'fixture-refresh',
      expiresAt: Date.now() + 3600_000,
    };
    const mailbox = `${randomUUID()}@example.com`;
    const connectionB = await saveConnection(
      db,
      b.id,
      mailbox,
      tokens,
      tokenVault(key),
    );
    const dependencies = {
      encryptionKey: key,
      source: {
        recent: async () => ({
          events: [normalizeGmail(gmailFixture(), mailbox)!],
          fetched: 1,
          skipped: 0,
        }),
      },
      detector: {
        detect: async (events: { id: string }[]) => ({
          candidates: [candidateFixture([events[0].id])],
        }),
      },
    };
    await loopScanService(db, b.id, dependencies).scan(connectionB);
    const reviewB = await scanStore(db, b.id).review();
    const candidate = reviewB.candidates[0];

    await t.test(
      'A cannot list, read, update, annotate, or close B’s Loop and timeline',
      async () => {
        assert.equal(loopB.userId, b.id);
        assert.deepEqual(await loopsA.list(), []);
        assert.equal(await loopsA.get(loopB.id), null);
        await assert.rejects(
          () => loopsA.update(loopB.id, 1, input),
          /could not be found/,
        );
        await assert.rejects(
          () => loopsA.addActivity(loopB.id, 1, 'Intrusion'),
          /could not be found/,
        );
        await assert.rejects(
          () =>
            loopsA.complete(loopB.id, 1, {
              evidence: 'A forged credit confirmation.',
              confirmed: true,
            }),
          /could not be found/,
        );
        assert.equal((await loopsB.get(loopB.id))?.events.length, 1);
        assert.equal((await loopsB.get(loopB.id))?.loop.status, 'VERIFYING');
      },
    );
    await t.test(
      'A cannot view, accept, ignore, scan, or disconnect B’s source data',
      async () => {
        const storeA = scanStore(db, a.id);
        assert.deepEqual(await storeA.review(), {
          candidates: [],
          connections: [],
          evidence: [],
        });
        await assert.rejects(
          () => storeA.accept(candidate.id, candidate.version),
          /STALE/,
        );
        await assert.rejects(
          () => storeA.dismiss(candidate.id, candidate.version),
          /STALE/,
        );
        let called = false;
        await assert.rejects(
          () =>
            loopScanService(db, a.id, {
              ...dependencies,
              source: {
                recent: async () => {
                  called = true;
                  return dependencies.source.recent();
                },
              },
            }).scan(connectionB),
          /DISCONNECTED/,
        );
        assert.equal(called, false);
        await assert.rejects(
          () => storeA.prepare(connectionB, []),
          /DISCONNECTED/,
        );
        await assert.rejects(
          () => detachConnection(db, a.id, connectionB),
          /DISCONNECTED/,
        );
        await assert.rejects(
          () => saveConnection(db, a.id, mailbox, tokens, tokenVault(key)),
          /GMAIL_AUTH/,
        );
        const [unchanged] = await db
          .select()
          .from(schema.sourceConnections)
          .where(eq(schema.sourceConnections.id, connectionB));
        assert.equal(unchanged.userId, b.id);
        assert.equal(unchanged.status, 'CONNECTED');
        assert.ok(unchanged.tokenCiphertext);
      },
    );
    await t.test(
      'database rejects cross-owner relations, evidence, and owner reassignment',
      async () => {
        const loopA = await loopsA.create(input);
        await assert.rejects(() =>
          db
            .update(schema.loopCandidates)
            .set({ status: 'ACCEPTED', loopId: loopA.id })
            .where(eq(schema.loopCandidates.id, candidate.id)),
        );
        await assert.rejects(
          () =>
            client`UPDATE loops SET user_id = ${a.id} WHERE id = ${loopB.id}`,
          /ownership/,
        );
        await assert.rejects(() =>
          db.insert(schema.externalEvents).values({
            userId: a.id,
            connectionId: connectionB,
            provider: 'gmail',
            messageId: 'foreign',
            conversationId: 'foreign',
            sender: 'private',
            subject: 'private',
            content: 'private',
            occurredAt: new Date(),
            dedupeKey: randomUUID(),
            metadata: { direction: 'incoming', possibleDates: [] },
          }),
        );
        await assert.rejects(() =>
          db
            .update(schema.loopCandidates)
            .set({ sourceReferences: [randomUUID()] })
            .where(eq(schema.loopCandidates.id, candidate.id)),
        );
        await assert.rejects(
          () =>
            loopsA.create(input, {
              candidateId: candidate.id,
              sourceReferences: candidate.sourceReferences,
            }),
          /not available/,
        );
      },
    );
    await t.test(
      'concurrent promotion is exactly once and owned by B with immutable provenance',
      async () => {
        const results = await Promise.all(
          Array.from({ length: 4 }, () =>
            scanStore(db, b.id).accept(candidate.id, candidate.version),
          ),
        );
        assert.equal(new Set(results).size, 1);
        const promoted = await loopsB.get(results[0]);
        assert.equal(promoted?.loop.userId, b.id);
        assert.equal(promoted?.loop.status, 'OPEN');
        assert.equal(promoted?.events[1].payload.candidateId, candidate.id);
        assert.equal(await loopsA.get(results[0]), null);
        await assert.rejects(
          () => client`DELETE FROM loop_events WHERE loop_id = ${results[0]}`,
          /immutable/,
        );
        await detachConnection(db, b.id, connectionB);
        await assert.rejects(
          () => saveConnection(db, a.id, mailbox, tokens, tokenVault(key)),
          /GMAIL_AUTH/,
        );
      },
    );
    await t.test(
      'sessions are real, CSRF/redirect checks hold, and logout revokes a copied cookie',
      async () => {
        const session = await request('/get-session', undefined, a.cookie);
        assert.equal(
          z
            .object({ user: z.object({ id: z.string() }) })
            .parse(await session.json()).user.id,
          a.id,
        );
        const [account] = await db
          .select()
          .from(schema.account)
          .where(eq(schema.account.userId, a.id));
        assert.ok(account.password);
        assert.notEqual(account.password, a.password);
        assert.equal(
          (await request('/sign-out', {}, a.cookie, 'https://attacker.invalid'))
            .status,
          403,
        );
        assert.equal(
          (
            await request('/sign-in/email', {
              email: a.email,
              password: a.password,
              callbackURL: 'https://attacker.invalid',
            })
          ).status,
          403,
        );
        assert.equal((await request('/sign-out', {}, a.cookie)).status, 200);
        assert.equal(
          await (await request('/get-session', undefined, a.cookie)).json(),
          null,
        );
        const signIn = await request('/sign-in/email', {
          email: a.email,
          password: a.password,
        });
        assert.equal(signIn.status, 200);
        assert.match(signIn.headers.get('set-cookie') ?? '', /HttpOnly/i);
        assert.match(signIn.headers.get('set-cookie') ?? '', /Secure/i);
        assert.match(signIn.headers.get('set-cookie') ?? '', /SameSite=Lax/i);
      },
    );
    await t.test(
      'legacy records are invisible until an explicit transfer and history is preserved',
      async () => {
        const [legacy] = await db
          .insert(schema.loops)
          .values({
            ...input,
            status: 'OPEN',
            expectedBy: null,
            userId: LEGACY_OWNER_ID,
          })
          .returning();
        await db.insert(schema.loopEvents).values({
          loopId: legacy.id,
          type: 'loop.created',
          body: 'Preserved legacy history.',
        });
        assert.equal(await loopsA.get(legacy.id), null);
        assert.equal(await loopsB.get(legacy.id), null);
        await assert.rejects(
          () => claimLegacy(db, randomUUID()),
          /Create the intended account/,
        );
        await claimLegacy(db, a.id);
        assert.equal(
          (await loopsA.get(legacy.id))?.events[0].body,
          'Preserved legacy history.',
        );
        assert.equal(await loopsB.get(legacy.id), null);
        assert.deepEqual(await claimLegacy(db, a.id), {
          loops: 0,
          connections: 0,
          events: 0,
          candidates: 0,
        });
        await assert.rejects(() =>
          db.insert(schema.session).values({
            id: randomUUID(),
            token: randomUUID(),
            userId: LEGACY_OWNER_ID,
            expiresAt: new Date(Date.now() + 60000),
          }),
        );
      },
    );
  } finally {
    await client.end();
  }
});
