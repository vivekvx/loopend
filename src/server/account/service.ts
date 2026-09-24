import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { LoopDatabase } from '../loops/service';
import { assertUserId } from '../../domain/ownership';
import { operationalLog } from '../logging';

export const eraseConfirmation = z.object({
  confirmation: z.literal('DELETE'),
});
const erasedConnections = z.array(
  z.object({ account_id: z.string(), token_ciphertext: z.string().nullable() }),
);

export async function eraseAccount(
  db: LoopDatabase,
  identity: { userId: string; sessionToken: string },
  input: unknown,
  revoke: (connection: {
    accountId: string;
    tokenCiphertext: string;
  }) => Promise<boolean>,
) {
  assertUserId(identity.userId);
  eraseConfirmation.parse(input);
  // The database checks a live session belonging to this owner. Erasure commits
  // before any best-effort external revocation; tokens are never retained for retry.
  const result = await db.execute(
    sql`select * from public.erase_loopend_account(${identity.userId}, ${identity.sessionToken})`,
  );
  const connections = erasedConnections.parse(result);
  const results = await Promise.all(
    connections.map(async (connection) => {
      if (!connection.token_ciphertext) return true;
      try {
        return await revoke({
          accountId: connection.account_id,
          tokenCiphertext: connection.token_ciphertext,
        });
      } catch {
        return false;
      }
    }),
  );
  const revoked = results.every(Boolean);
  operationalLog({ event: 'account.erased' });
  if (!revoked) operationalLog({ event: 'account.revocation_unconfirmed' });
  return { revoked };
}
