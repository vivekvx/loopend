'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ScanError, scanMessages } from '@/domain/scan';
import { requireWorkspace } from '../auth';
import { getDb } from '../db';
import { gmailRuntime } from '../integrations/gmail/runtime';
import { detachConnection } from '../integrations/gmail/connections';
import { googleTokens } from '../integrations/gmail/client';
import { scanStore } from './store';
import { scanSetup } from './config';
import { structuredDetector } from './detector';
import { loopScanService } from './service';

export type ScanActionState = { error?: string; message?: string };
const candidateIdentity = z.object({
  id: z.uuid(),
  version: z.coerce.number().int().positive(),
});
function failure(error: unknown): ScanActionState {
  return {
    error: scanMessages[error instanceof ScanError ? error.code : 'STORAGE'],
  };
}
export async function connectGmail(): Promise<ScanActionState> {
  const { user, session } = await requireWorkspace();
  let url: string;
  try {
    if ((await headers()).get('origin') !== scanSetup().origin)
      return {
        error:
          'Open this workspace at its configured APP_URL before connecting Gmail. The OAuth callback must return to the same address.',
      };
    const { client, vault } = gmailRuntime();
    const state = client.begin();
    url = state.url;
    (await cookies()).set(
      'loopend_gmail_oauth',
      vault.seal(
        {
          state: state.state,
          verifier: state.verifier,
          expiresAt: state.expiresAt,
          userId: user.id,
          sessionId: session.id,
        },
        'gmail:oauth',
      ),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600,
        path: '/api/gmail/callback',
      },
    );
  } catch (error) {
    return failure(error);
  }
  redirect(url);
}
export async function scanGmail(
  _state: ScanActionState,
  form: FormData,
): Promise<ScanActionState> {
  const { user } = await requireWorkspace();
  try {
    const setup = scanSetup();
    if (!setup.gmailReady || !setup.aiReady) throw new ScanError('SETUP');
    const id = z.uuid().parse(form.get('connectionId'));
    const { client } = gmailRuntime();
    const result = await loopScanService(getDb(), user.id, {
      source: client,
      detector: structuredDetector({
        apiKey: process.env.LOOP_SCAN_AI_API_KEY!,
        model: setup.model,
        baseUrl: setup.baseUrl,
      }),
      encryptionKey: process.env.SOURCE_TOKEN_ENCRYPTION_KEY!,
    }).scan(id);
    revalidatePath('/app/scan');
    return {
      message: `Scan finished. ${result.fetched} messages checked; ${result.added} new ${result.added === 1 ? 'suggestion' : 'suggestions'}.${result.skipped ? ` ${result.skipped} messages excluded before detection.` : ''}`,
    };
  } catch (error) {
    revalidatePath('/app/scan');
    return failure(error);
  }
}
export async function acceptCandidate(
  _state: ScanActionState,
  form: FormData,
): Promise<ScanActionState> {
  const { user } = await requireWorkspace();
  let loopId: string;
  try {
    const { id, version } = candidateIdentity.parse(Object.fromEntries(form));
    loopId = await scanStore(getDb(), user.id).accept(id, version);
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/app/scan');
  revalidatePath('/app');
  redirect(`/app/loops/${loopId}`);
}
export async function ignoreCandidate(
  _state: ScanActionState,
  form: FormData,
): Promise<ScanActionState> {
  const { user } = await requireWorkspace();
  try {
    const { id, version } = candidateIdentity.parse(Object.fromEntries(form));
    await scanStore(getDb(), user.id).dismiss(id, version);
    revalidatePath('/app/scan');
    return {
      message:
        'Suggestion ignored. This conversation will not be suggested again.',
    };
  } catch (error) {
    return failure(error);
  }
}
export async function disconnectGmail(
  _state: ScanActionState,
  form: FormData,
): Promise<ScanActionState> {
  const { user } = await requireWorkspace();
  let notice = 'disconnected';
  try {
    const id = z.uuid().parse(form.get('connectionId'));
    const connection = await detachConnection(getDb(), user.id, id);
    let revoked = true;
    if (connection?.tokenCiphertext) {
      try {
        const { client, vault } = gmailRuntime();
        const tokens = googleTokens.parse(
          vault.open(
            connection.tokenCiphertext,
            `gmail:${connection.accountId}`,
          ),
        );
        revoked = await client.revoke(tokens.refreshToken);
      } catch {
        revoked = false;
      }
    }
    revalidatePath('/app/scan');
    revalidatePath('/app/settings');
    if (!revoked) notice = 'revocation-unconfirmed';
  } catch (error) {
    return failure(error);
  }
  // The connection row unmounts on disconnect; feedback must survive that change.
  redirect(`/app/scan?notice=${notice}`);
}
