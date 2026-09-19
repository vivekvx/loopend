import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { tokenVault } from '../crypto';
import { ScanError } from '../../../domain/scan';

export function validateOAuthState(
  vault: ReturnType<typeof tokenVault>,
  cookie: string | undefined,
  suppliedState: string | null,
) {
  try {
    const state = z
      .object({
        state: z.string().min(32).max(100),
        verifier: z.string().min(43).max(128),
        expiresAt: z.number().finite(),
      })
      .parse(vault.open(cookie ?? '', 'gmail:oauth'));
    const supplied = Buffer.from(suppliedState ?? '');
    const expected = Buffer.from(state.state);
    if (
      Date.now() >= state.expiresAt ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new Error();
    return state;
  } catch {
    throw new ScanError('GMAIL_AUTH');
  }
}
