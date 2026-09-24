import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { sourceConnections } from '../db/schema';
import type { LoopDatabase } from '../loops/service';
import { ScanError } from '../../domain/scan';
import { assertUserId } from '../../domain/ownership';
import { scanStore } from './store';
import { loopScanService } from './service';
import { operationalLog } from '../logging';

export async function requestScan(
  db: LoopDatabase,
  userId: string,
  connectionId: string,
) {
  assertUserId(userId);
  const [row] = await db
    .update(sourceConnections)
    .set({ scanRequestedAt: new Date(), scanAttempts: 0, lastScanError: null })
    .where(
      and(
        eq(sourceConnections.id, connectionId),
        eq(sourceConnections.userId, userId),
        eq(sourceConnections.status, 'CONNECTED'),
        isNull(sourceConnections.scanRequestedAt),
        or(
          isNull(sourceConnections.scanLeaseUntil),
          lt(sourceConnections.scanLeaseUntil, new Date()),
        ),
        or(
          isNull(sourceConnections.lastScanAt),
          lt(sourceConnections.lastScanAt, new Date(Date.now() - 30_000)),
        ),
      ),
    )
    .returning({ id: sourceConnections.id });
  if (!row) throw new ScanError('BUSY');
}

export function scanQueue(
  db: LoopDatabase,
  dependencies: Parameters<typeof loopScanService>[2],
) {
  return {
    async runOne() {
      const claimed = await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(sourceConnections)
          .where(
            and(
              isNotNull(sourceConnections.scanRequestedAt),
              eq(sourceConnections.status, 'CONNECTED'),
              or(
                isNull(sourceConnections.scanLeaseUntil),
                lt(sourceConnections.scanLeaseUntil, new Date()),
              ),
            ),
          )
          .orderBy(sourceConnections.scanRequestedAt)
          .limit(1)
          .for('update', { skipLocked: true });
        if (!row) return null;
        if (row.scanAttempts >= 3) {
          await tx
            .update(sourceConnections)
            .set({
              scanRequestedAt: null,
              scanLeaseId: null,
              scanLeaseUntil: null,
              lastScanError: 'STORAGE',
            })
            .where(eq(sourceConnections.id, row.id));
          return { exhausted: true } as const;
        }
        const acquired = await scanStore(tx, row.userId).acquire(row.id);
        await tx
          .update(sourceConnections)
          .set({ scanAttempts: sql`${sourceConnections.scanAttempts} + 1` })
          .where(eq(sourceConnections.id, row.id));
        return { exhausted: false, acquired } as const;
      });
      if (!claimed) return false;
      if (claimed.exhausted) return true;
      const { connection } = claimed.acquired;
      try {
        await loopScanService(db, connection.userId, dependencies).scan(
          connection.id,
          claimed.acquired,
        );
        operationalLog({ event: 'scan.completed' });
      } catch {
        operationalLog({ event: 'scan.failed', code: 'SCAN' });
      }
      return true;
    },
  };
}
