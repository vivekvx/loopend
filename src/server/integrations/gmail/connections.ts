import { and, eq } from 'drizzle-orm';
import { assertUserId } from '../../../domain/ownership';
import { ScanError } from '../../../domain/scan';
import type { LoopDatabase } from '../../loops/service';
import { sourceConnections } from '../../db/schema';
import { tokenVault } from '../crypto';
import { GMAIL_SCOPE, type GoogleTokens } from './client';

export async function saveConnection(
  db: LoopDatabase,
  userId: string,
  email: string,
  tokens: GoogleTokens,
  vault: ReturnType<typeof tokenVault>,
) {
  assertUserId(userId);
  const now = new Date();
  const encrypted = vault.seal(tokens, `gmail:${email}`);
  const [connection] = await db
    .insert(sourceConnections)
    .values({
      provider: 'gmail',
      userId,
      accountId: email,
      accountEmail: email,
      tokenCiphertext: encrypted,
      metadata: { scopes: [GMAIL_SCOPE] },
    })
    .onConflictDoUpdate({
      target: [sourceConnections.provider, sourceConnections.accountId],
      setWhere: eq(sourceConnections.userId, userId),
      set: {
        tokenCiphertext: encrypted,
        status: 'CONNECTED',
        connectedAt: now,
        updatedAt: now,
        disconnectedAt: null,
        scanLeaseId: null,
        scanLeaseUntil: null,
        lastScanError: null,
      },
    })
    .returning({ id: sourceConnections.id });
  if (!connection) throw new ScanError('GMAIL_AUTH');
  return connection.id;
}
export async function detachConnection(
  db: LoopDatabase,
  userId: string,
  id: string,
) {
  assertUserId(userId);
  return db.transaction(async (tx) => {
    const [connection] = await tx
      .select()
      .from(sourceConnections)
      .where(
        and(eq(sourceConnections.id, id), eq(sourceConnections.userId, userId)),
      )
      .for('update');
    if (!connection) throw new ScanError('DISCONNECTED');
    await tx
      .update(sourceConnections)
      .set({
        status: 'DISCONNECTED',
        tokenCiphertext: null,
        disconnectedAt: new Date(),
        updatedAt: new Date(),
        scanLeaseId: null,
        scanLeaseUntil: null,
        lastScanError: null,
      })
      .where(
        and(eq(sourceConnections.id, id), eq(sourceConnections.userId, userId)),
      );
    return connection;
  });
}
