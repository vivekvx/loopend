import { asc, desc, eq, ne } from 'drizzle-orm';
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

export function loopService(db: PostgresJsDatabase<typeof schema>) {
  const { loops, loopEvents } = schema;
  async function locked(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    id: string,
    version: number,
  ) {
    const [loop] = await tx
      .select()
      .from(loops)
      .where(eq(loops.id, id))
      .for('update');
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
        .orderBy(desc(loops.updatedAt), desc(loops.id));
    },
    async active() {
      return db
        .select()
        .from(loops)
        .where(ne(loops.status, 'CLOSED'))
        .orderBy(desc(loops.updatedAt));
    },
    async get(id: string) {
      const [loop] = await db.select().from(loops).where(eq(loops.id, id));
      if (!loop) return null;
      const events = await db
        .select()
        .from(loopEvents)
        .where(eq(loopEvents.loopId, id))
        .orderBy(asc(loopEvents.sequence));
      return { loop, events };
    },
    async create(raw: unknown) {
      const input = loopInput.parse(raw);
      return db.transaction(async (tx) => {
        const [loop] = await tx
          .insert(loops)
          .values({ ...input, expectedBy: input.expectedBy || null })
          .returning();
        await tx.insert(loopEvents).values({
          loopId: loop.id,
          type: 'loop.created',
          body: 'Loop opened. An outcome worth staying on.',
          payload: { snapshot: input },
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
          .where(eq(loops.id, id))
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
          .where(eq(loops.id, id));
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
          .where(eq(loops.id, id));
      });
    },
  };
}
