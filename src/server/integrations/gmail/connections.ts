import { eq } from 'drizzle-orm';
import type { LoopDatabase } from '../../loops/service';
import { sourceConnections } from '../../db/schema';
import { tokenVault } from '../crypto';
import { GMAIL_SCOPE, type GoogleTokens } from './client';

export async function saveConnection(
  db: LoopDatabase,
  email: string,
  tokens: GoogleTokens,
  vault: ReturnType<typeof tokenVault>,
) {
  const now = new Date();
  const encrypted = vault.seal(tokens, `gmail:${email}`);
  const [connection] = await db
    .insert(sourceConnections)
    .values({
      provider: 'gmail',
      accountId: email,
      accountEmail: email,
      tokenCiphertext: encrypted,
      metadata: { scopes: [GMAIL_SCOPE] },
    })
    .onConflictDoUpdate({
      target: [sourceConnections.provider, sourceConnections.accountId],
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
  return connection.id;
}
export async function detachConnection(db: LoopDatabase, id: string) {
  return db.transaction(async (tx) => {
    const [connection] = await tx
      .select()
      .from(sourceConnections)
      .where(eq(sourceConnections.id, id))
      .for('update');
    if (!connection) return null;
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
      .where(eq(sourceConnections.id, id));
    return connection;
  });
}
