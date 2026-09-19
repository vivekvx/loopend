import { eq, sql } from 'drizzle-orm';
import { assertUserId, LEGACY_OWNER_ID } from '../../domain/ownership';
import type { LoopDatabase } from '../loops/service';
import {
  user,
  loops,
  sourceConnections,
  externalEvents,
  loopCandidates,
} from './schema';

// Operator-only migration utility. Never import this from an action or route.
export async function claimLegacy(db: LoopDatabase, userId: string) {
  assertUserId(userId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(73498210)`);
    const [target] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for('update');
    if (!target)
      throw new Error(
        'Create the intended account before transferring legacy data.',
      );
    await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
    const counts: Record<string, number> = {};
    for (const [name, table] of [
      ['loops', loops],
      ['connections', sourceConnections],
      ['events', externalEvents],
      ['candidates', loopCandidates],
    ] as const) {
      const changed = await tx
        .update(table)
        .set({ userId })
        .where(eq(table.userId, LEGACY_OWNER_ID))
        .returning({ id: table.id });
      counts[name] = changed.length;
    }
    // Timeline ownership follows its Loop. Immutable history is never rewritten.
    return counts;
  });
}
