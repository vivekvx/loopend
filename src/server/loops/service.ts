import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { assertUserId } from '../../domain/ownership';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import {
  activityInput,
  assertCompletable,
  assertEditable,
  completionInput,
  DomainError,
  loopInput,
  statusLabels,
} from '../../domain/loops';

export type LoopDatabase = PostgresJsDatabase<typeof schema>;
export type LoopTransaction = Parameters<
  Parameters<LoopDatabase['transaction']>[0]
>[0];
export function loopService(
  db: LoopDatabase | LoopTransaction,
  userId: string,
) {
  assertUserId(userId);
  const { loops, loopEvents } = schema;
  const owned = (id: string) => and(eq(loops.id, id), eq(loops.userId, userId));
  async function locked(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    id: string,
    version: number,
  ) {
    const [loop] = await tx.select().from(loops).where(owned(id)).for('update');
    if (!loop) throw new DomainError('This Loop could not be found.');
    if (loop.version !== version)
      throw new DomainError(
        'This Loop changed in another window. Refresh the page and try again.',
      );
    return loop;
  }
  return {
    async list() {
      return db
        .select()
        .from(loops)
        .where(eq(loops.userId, userId))
        .orderBy(desc(loops.updatedAt), desc(loops.id));
    },
    async active() {
      return db
        .select()
        .from(loops)
        .where(and(eq(loops.userId, userId), ne(loops.status, 'CLOSED')))
        .orderBy(desc(loops.updatedAt));
    },
    async get(id: string) {
      const [loop] = await db.select().from(loops).where(owned(id));
      if (!loop) return null;
      const events = await db
        .select()
        .from(loopEvents)
        .where(eq(loopEvents.loopId, id))
        .orderBy(asc(loopEvents.sequence));
      return { loop, events };
    },
    async create(
      raw: unknown,
      provenance?: { candidateId: string; sourceReferences: string[] },
    ) {
      const input = loopInput.parse(raw);
      return db.transaction(async (tx) => {
        if (provenance) {
          const [candidate] = await tx
            .select()
            .from(schema.loopCandidates)
            .where(
              and(
                eq(schema.loopCandidates.id, provenance.candidateId),
                eq(schema.loopCandidates.userId, userId),
              ),
            );
          if (
            !candidate ||
            candidate.status !== 'PENDING' ||
            candidate.sourceReferences.length !==
              provenance.sourceReferences.length ||
            !candidate.sourceReferences.every((id) =>
              provenance.sourceReferences.includes(id),
            )
          )
            throw new DomainError('This source suggestion is not available.');
        }
        const [loop] = await tx
          .insert(loops)
          .values({ ...input, userId, expectedBy: input.expectedBy || null })
          .returning();
        await tx.insert(loopEvents).values({
          loopId: loop.id,
          type: 'loop.created',
          body: 'Loop opened. An outcome worth staying on.',
          payload: { snapshot: input },
        });
        if (provenance)
          await tx.insert(loopEvents).values({
            loopId: loop.id,
            type: 'source.accepted',
            source: 'gmail',
            body: 'You reviewed a Loop Scan suggestion from Gmail and chose to track it.',
            payload: provenance,
          });
        return loop;
      });
    },
    async update(id: string, version: number, raw: unknown) {
      const input = loopInput.parse(raw);
      return db.transaction(async (tx) => {
        const previous = await locked(tx, id, version);
        assertEditable(previous.status);
        const [loop] = await tx
          .update(loops)
          .set({
            ...input,
            expectedBy: input.expectedBy || null,
            version: version + 1,
            updatedAt: new Date(),
          })
          .where(owned(id))
          .returning();
        await tx.insert(loopEvents).values({
          loopId: id,
          type:
            previous.status === input.status
              ? 'loop.updated'
              : 'loop.state_changed',
          body:
            previous.status === input.status
              ? 'Loop details updated.'
              : `State changed from ${statusLabels[previous.status]} to ${statusLabels[input.status]}.`,
          payload: { before: previous, after: loop },
        });
        return loop;
      });
    },
    async addActivity(id: string, version: number, raw: unknown) {
      const body = activityInput.parse(raw);
      return db.transaction(async (tx) => {
        const loop = await locked(tx, id, version);
        assertEditable(loop.status);
        await tx
          .insert(loopEvents)
          .values({ loopId: id, type: 'activity.noted', body });
        await tx
          .update(loops)
          .set({ version: version + 1, updatedAt: new Date() })
          .where(owned(id));
      });
    },
    async complete(id: string, version: number, raw: unknown) {
      const input = completionInput.parse(raw);
      return db.transaction(async (tx) => {
        const loop = await locked(tx, id, version);
        assertCompletable(loop.status);
        const now = new Date();
        await tx.insert(loopEvents).values({
          loopId: id,
          type: 'outcome.verified',
          body: input.evidence,
          payload: {
            verificationCondition: loop.verificationCondition,
            confirmed: true,
          },
        });
        await tx.insert(loopEvents).values({
          loopId: id,
          type: 'loop.closed',
          body: 'Outcome verified. Loop closed.',
        });
        await tx
          .update(loops)
          .set({
            status: 'CLOSED',
            closedAt: now,
            updatedAt: now,
            version: version + 1,
          })
          .where(owned(id));
      });
    },
  };
}
