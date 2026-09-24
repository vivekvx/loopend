import { createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { oauthStates } from '../../db/schema';
import type { LoopDatabase } from '../../loops/service';
import { z } from 'zod';
import type { tokenVault } from '../crypto';
import { ScanError } from '../../../domain/scan';

const stateHash = (state: string) =>
  createHash('sha256').update(state).digest('hex');
export async function rememberOAuthState(
  db: LoopDatabase,
  state: { state: string; expiresAt: number },
  identity: { userId: string; sessionId: string },
) {
  await db.transaction(async (tx) => {
    await tx.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
    await tx
      .delete(oauthStates)
      .where(
        and(
          eq(oauthStates.userId, identity.userId),
          eq(oauthStates.sessionId, identity.sessionId),
        ),
      );
    await tx.insert(oauthStates).values({
      hash: stateHash(state.state),
      ...identity,
      expiresAt: new Date(state.expiresAt),
    });
  });
}
export async function consumeOAuthState(
  db: LoopDatabase,
  state: string,
  identity: { userId: string; sessionId: string },
) {
  const rows = await db
    .delete(oauthStates)
    .where(
      and(
        eq(oauthStates.hash, stateHash(state)),
        eq(oauthStates.userId, identity.userId),
        eq(oauthStates.sessionId, identity.sessionId),
        gt(oauthStates.expiresAt, new Date()),
      ),
    )
    .returning({ hash: oauthStates.hash });
  if (rows.length !== 1) throw new ScanError('GMAIL_AUTH');
}

export function validateOAuthState(
  vault: ReturnType<typeof tokenVault>,
  cookie: string | undefined,
  suppliedState: string | null,
  identity: { userId: string; sessionId: string },
) {
  try {
    const state = z
      .object({
        state: z.string().min(32).max(100),
        verifier: z.string().min(43).max(128),
        expiresAt: z.number().finite(),
        userId: z.string().min(1),
        sessionId: z.string().min(1),
      })
      .parse(vault.open(cookie ?? '', 'gmail:oauth'));
    const supplied = Buffer.from(suppliedState ?? '');
    const expected = Buffer.from(state.state);
    if (
      Date.now() >= state.expiresAt ||
      state.userId !== identity.userId ||
      state.sessionId !== identity.sessionId ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new Error();
    return state;
  } catch {
    throw new ScanError('GMAIL_AUTH');
  }
}
