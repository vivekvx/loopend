import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireWorkspace } from '@/server/auth';
import { gmailRuntime } from '@/server/integrations/gmail/runtime';
import { saveConnection } from '@/server/integrations/gmail/connections';
import { getDb } from '@/server/db';
import { scanSetup } from '@/server/scan/config';
import { validateOAuthState } from '@/server/integrations/gmail/oauth-state';

export async function GET(request: Request) {
  await requireWorkspace();
  const jar = await cookies();
  const saved = jar.get('loopend_gmail_oauth')?.value;
  jar.delete({ name: 'loopend_gmail_oauth', path: '/api/gmail/callback' });
  const params = new URL(request.url).searchParams;
  let notice = 'connection-failed';
  try {
    const { client, vault } = gmailRuntime();
    const state = validateOAuthState(vault, saved, params.get('state'));
    if (params.has('error')) notice = 'connection-cancelled';
    else {
      const code = z.string().min(1).max(4096).parse(params.get('code'));
      const tokens = await client.exchange(code, state.verifier);
      const email = await client.profile(tokens.accessToken);
      await saveConnection(getDb(), email, tokens, vault);
      notice = 'connected';
    }
  } catch {
    /* OAuth codes, tokens, and provider errors must never reach application logs. */
  }
  const origin = scanSetup().origin ?? new URL(request.url).origin;
  return NextResponse.redirect(new URL(`/app/scan?notice=${notice}`, origin), {
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
