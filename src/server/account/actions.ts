'use server';
import { redirect } from 'next/navigation';
import { requireWorkspace } from '../auth';
import { getDb } from '../db';
import { eraseAccount } from './service';
import { gmailRuntime } from '../integrations/gmail/runtime';
import { googleTokens } from '../integrations/gmail/client';
import { operationalLog } from '../logging';

export async function deleteAccount(
  _state: { error?: string },
  form: FormData,
): Promise<{ error?: string }> {
  const { user, session } = await requireWorkspace();
  let revoked: boolean;
  try {
    ({ revoked } = await eraseAccount(
      getDb(),
      { userId: user.id, sessionToken: session.token },
      { confirmation: form.get('confirmation') },
      async (connection) => {
        const { vault, client } = gmailRuntime();
        const tokens = googleTokens.parse(
          vault.open(
            connection.tokenCiphertext,
            `gmail:${connection.accountId}`,
          ),
        );
        return client.revoke(tokens.refreshToken);
      },
    ));
  } catch {
    operationalLog({ event: 'web.failed', code: 'STORAGE' });
    return {
      error:
        'Your account could not be deleted. Check the confirmation and try again.',
    };
  }
  redirect(`/account-deleted${revoked ? '' : '?revocation=unconfirmed'}`);
}
