import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { SCAN_DAYS, SCAN_MESSAGES, ScanError } from '../../../domain/scan';
import { boundedJson, type Fetcher } from '../http';
import { normalizeGmail, type NormalizedEmail } from './normalize';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const googleTokens = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().finite(),
});
export type GoogleTokens = z.infer<typeof googleTokens>;
export type GmailConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};
export type MailSource = {
  recent(
    tokens: GoogleTokens,
    account: string,
    onRefresh: (tokens: GoogleTokens) => Promise<void>,
    signal: AbortSignal,
  ): Promise<{ events: NormalizedEmail[]; fetched: number; skipped: number }>;
};

export function gmailClient(config: GmailConfig, fetcher: Fetcher = fetch) {
  async function request(
    url: string,
    options: RequestInit,
    signal?: AbortSignal,
  ) {
    try {
      return await fetcher(url, {
        ...options,
        cache: 'no-store',
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ScanError('GMAIL_API');
    }
  }
  async function tokenRequest(
    params: Record<string, string>,
    signal?: AbortSignal,
  ) {
    const response = await request(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          ...params,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
      },
      signal,
    );
    if (response.status === 400 || response.status === 401)
      throw new ScanError('GMAIL_AUTH');
    if (!response.ok) throw new ScanError('GMAIL_API');
    const result = z
      .object({
        access_token: z.string().min(1),
        refresh_token: z.string().optional(),
        expires_in: z.number().positive(),
        scope: z.string().optional(),
      })
      .safeParse(await boundedJson(response, 'GMAIL_API'));
    if (!result.success) throw new ScanError('GMAIL_AUTH');
    if (
      result.data.scope &&
      (!result.data.scope.split(' ').includes(GMAIL_SCOPE) ||
        result.data.scope
          .split(' ')
          .some((scope) => scope.includes('gmail.') && scope !== GMAIL_SCOPE))
    )
      throw new ScanError('GMAIL_AUTH');
    return result.data;
  }
  return {
    begin() {
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: GMAIL_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: createHash('sha256')
          .update(verifier)
          .digest('base64url'),
        code_challenge_method: 'S256',
      }).toString();
      return {
        url: url.toString(),
        state,
        verifier,
        expiresAt: Date.now() + 10 * 60_000,
      };
    },
    async exchange(code: string, verifier: string) {
      const result = await tokenRequest({
        code,
        code_verifier: verifier,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      });
      if (
        !result.refresh_token ||
        !result.scope?.split(' ').includes(GMAIL_SCOPE)
      )
        throw new ScanError('GMAIL_AUTH');
      return {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresAt: Date.now() + result.expires_in * 1000,
      };
    },
    async profile(accessToken: string) {
      const response = await request(`${API}/profile`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (response.status === 401) throw new ScanError('GMAIL_AUTH');
      if (!response.ok) throw new ScanError('GMAIL_API');
      const parsed = z
        .object({ emailAddress: z.email() })
        .safeParse(await boundedJson(response, 'GMAIL_API'));
      if (!parsed.success) throw new ScanError('GMAIL_API');
      return parsed.data.emailAddress.toLowerCase();
    },
    async recent(
      initial: GoogleTokens,
      account: string,
      onRefresh: (tokens: GoogleTokens) => Promise<void>,
      signal: AbortSignal,
    ) {
      let tokens = initial;
      async function refresh() {
        const next = await tokenRequest(
          { refresh_token: tokens.refreshToken, grant_type: 'refresh_token' },
          signal,
        );
        tokens = {
          accessToken: next.access_token,
          refreshToken: next.refresh_token ?? tokens.refreshToken,
          expiresAt: Date.now() + next.expires_in * 1000,
        };
        await onRefresh(tokens);
      }
      async function get(path: string) {
        if (tokens.expiresAt <= Date.now() + 60_000) await refresh();
        let response = await request(
          `${API}/${path}`,
          { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
          signal,
        );
        if (response.status === 401) {
          await refresh();
          response = await request(
            `${API}/${path}`,
            { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
            signal,
          );
        }
        if (response.status === 401) throw new ScanError('GMAIL_AUTH');
        if (response.status === 404 && path.startsWith('messages/'))
          return null;
        if (!response.ok) throw new ScanError('GMAIL_API');
        return boundedJson(response, 'GMAIL_API');
      }
      const ids = new Set<string>();
      const pages = new Set<string>();
      let pageToken: string | undefined;
      for (let page = 0; page < 10 && ids.size < SCAN_MESSAGES; page++) {
        const params = new URLSearchParams({
          q: `newer_than:${SCAN_DAYS}d -in:spam -in:trash -category:promotions -category:social`,
          maxResults: String(SCAN_MESSAGES - ids.size),
          fields: 'messages(id),nextPageToken',
        });
        if (pageToken) params.set('pageToken', pageToken);
        const result = z
          .object({
            messages: z
              .array(z.object({ id: z.string().regex(/^[\w-]+$/) }))
              .optional(),
            nextPageToken: z.string().optional(),
          })
          .safeParse(await get(`messages?${params}`));
        if (!result.success) throw new ScanError('GMAIL_API');
        for (const message of result.data.messages ?? []) {
          if (ids.size < SCAN_MESSAGES) ids.add(message.id);
        }
        pageToken = result.data.nextPageToken;
        if (!pageToken || pages.has(pageToken)) break;
        pages.add(pageToken);
      }
      const events: NormalizedEmail[] = [];
      let skipped = 0;
      // Deliberately bounded and sequential: predictable quota use and refresh-token rotation.
      for (const id of ids) {
        const raw = await get(`messages/${encodeURIComponent(id)}?format=full`);
        const event = normalizeGmail(raw, account);
        if (
          event &&
          event.occurredAt.getTime() >= Date.now() - SCAN_DAYS * 86_400_000
        )
          events.push(event);
        else skipped++;
      }
      return { events, fetched: ids.size, skipped };
    },
    async revoke(token: string) {
      const response = await request('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
      // An already invalid token is already revoked.
      return response.ok || response.status === 400;
    },
  };
}
