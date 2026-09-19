import { and, eq } from 'drizzle-orm';
import {
  ScanError,
  validateDetections,
  type Detector,
} from '../../domain/scan';
import { sourceConnections } from '../db/schema';
import type { LoopDatabase } from '../loops/service';
import { tokenVault } from '../integrations/crypto';
import { googleTokens, type MailSource } from '../integrations/gmail/client';
import { scanStore } from './store';

export function loopScanService(
  db: LoopDatabase,
  dependencies: {
    source: MailSource;
    detector: Detector;
    encryptionKey: string;
  },
) {
  const store = scanStore(db);
  const vault = tokenVault(dependencies.encryptionKey);
  return {
    async scan(connectionId: string) {
      const { connection, lease } = await store.acquire(connectionId);
      const signal = AbortSignal.timeout(120_000);
      try {
        if (!connection.tokenCiphertext) throw new ScanError('GMAIL_AUTH');
        const tokenResult = googleTokens.safeParse(
          vault.open(
            connection.tokenCiphertext,
            `gmail:${connection.accountId}`,
          ),
        );
        if (!tokenResult.success) throw new ScanError('GMAIL_AUTH');
        const result = await dependencies.source.recent(
          tokenResult.data,
          connection.accountEmail,
          async (tokens) => {
            const updated = await db
              .update(sourceConnections)
              .set({
                tokenCiphertext: vault.seal(
                  tokens,
                  `gmail:${connection.accountId}`,
                ),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(sourceConnections.id, connectionId),
                  eq(sourceConnections.scanLeaseId, lease),
                  eq(sourceConnections.status, 'CONNECTED'),
                ),
              )
              .returning({ id: sourceConnections.id });
            if (!updated.length) throw new ScanError('DISCONNECTED');
          },
          signal,
        );
        const prepared = await store.prepare(connectionId, result.events);
        const raw = prepared.detectionEvents.length
          ? await dependencies.detector.detect(prepared.detectionEvents, signal)
          : { candidates: [] };
        const candidates = validateDetections(raw, prepared.detectionEvents);
        const added = await store.persist(
          connectionId,
          lease,
          prepared,
          candidates,
          result.fetched,
        );
        return { added, fetched: result.fetched, skipped: result.skipped };
      } catch (error) {
        const safe =
          error instanceof ScanError ? error : new ScanError('STORAGE');
        await store.fail(connectionId, lease, safe.code);
        throw safe;
      }
    },
  };
}
