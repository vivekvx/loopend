import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { tokenVault } from '../src/server/integrations/crypto';
import { validateOAuthState } from '../src/server/integrations/gmail/oauth-state';
import {
  gmailClient,
  GMAIL_SCOPE,
} from '../src/server/integrations/gmail/client';
import { structuredDetector } from '../src/server/scan/detector';
import { boundedJson } from '../src/server/integrations/http';
import { gmailFixture } from './fixtures/scan';

const config = {
  clientId: 'test-client',
  clientSecret: 'test-secret',
  redirectUri: 'https://loopend.example/api/gmail/callback',
};
const tokens = {
  accessToken: 'access-test',
  refreshToken: 'refresh-test',
  expiresAt: Date.now() + 3600_000,
};

test('OAuth callback state rejects forgery, missing cookies, tampering and expiry', () => {
  const vault = tokenVault(randomBytes(32).toString('base64'));
  const state = gmailClient(config).begin();
  const cookie = vault.seal(state, 'gmail:oauth');
  assert.equal(
    validateOAuthState(vault, cookie, state.state).verifier,
    state.verifier,
  );
  assert.throws(
    () => validateOAuthState(vault, cookie, 'forged'),
    /GMAIL_AUTH/,
  );
  assert.throws(
    () => validateOAuthState(vault, undefined, state.state),
    /GMAIL_AUTH/,
  );
  assert.throws(
    () => validateOAuthState(vault, cookie.slice(0, -8), state.state),
    /GMAIL_AUTH/,
  );
  assert.throws(
    () =>
      validateOAuthState(
        vault,
        vault.seal({ ...state, expiresAt: 0 }, 'gmail:oauth'),
        state.state,
      ),
    /GMAIL_AUTH/,
  );
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

test('OAuth requests only read-only Gmail, binds PKCE, and exchanges tokens server-side', async () => {
  const client = gmailClient(config, async (input, options) => {
    assert.equal(String(input), 'https://oauth2.googleapis.com/token');
    const params = options?.body as URLSearchParams;
    assert.equal(params.get('client_secret'), 'test-secret');
    assert.equal(params.get('code_verifier'), 'test-verifier');
    assert.equal(params.get('redirect_uri'), config.redirectUri);
    return response({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
      scope: GMAIL_SCOPE,
    });
  });
  const start = client.begin();
  const url = new URL(start.url);
  assert.equal(url.searchParams.get('scope'), GMAIL_SCOPE);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), start.state);
  assert.notEqual(start.state, client.begin().state);
  const exchanged = await client.exchange('test-code', 'test-verifier');
  assert.equal(exchanged.refreshToken, 'new-refresh');
});
test('Gmail pagination never fetches over 50 messages and deduplicates page identifiers', async () => {
  let pages = 0;
  let messages = 0;
  const client = gmailClient(config, async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/messages')) {
      pages++;
      assert.match(url.searchParams.get('q')!, /newer_than:30d/);
      if (pages === 1)
        return response({
          messages: Array.from({ length: 30 }, (_, i) => ({ id: `m${i}` })),
          nextPageToken: 'second',
        });
      assert.equal(url.searchParams.get('maxResults'), '20');
      return response({
        messages: Array.from({ length: 25 }, (_, i) => ({ id: `m${i + 25}` })),
        nextPageToken: 'third',
      });
    }
    messages++;
    return response(gmailFixture(url.pathname.split('/').pop()!));
  });
  const result = await client.recent(
    tokens,
    'owner@example.com',
    async () => {},
    AbortSignal.timeout(10_000),
  );
  assert.equal(result.fetched, 50);
  assert.equal(messages, 50);
  assert.equal(pages, 2);
});
test('expired access refreshes once, revoked refresh is a safe reconnect error', async () => {
  let refreshes = 0;
  let persisted = 0;
  const client = gmailClient(config, async (input, options) => {
    if (String(input).endsWith('/token')) {
      refreshes++;
      return response({ access_token: 'renewed', expires_in: 3600 });
    }
    assert.equal(
      (options?.headers as Record<string, string>).Authorization,
      'Bearer renewed',
    );
    return response({ messages: [] });
  });
  await client.recent(
    { ...tokens, expiresAt: 0 },
    'owner@example.com',
    async (next) => {
      persisted++;
      assert.equal(next.refreshToken, tokens.refreshToken);
    },
    AbortSignal.timeout(10_000),
  );
  assert.equal(refreshes, 1);
  assert.equal(persisted, 1);
  const revoked = gmailClient(config, async () =>
    response(
      { error: 'invalid_grant', error_description: 'PRIVATE_TOKEN' },
      400,
    ),
  );
  await assert.rejects(
    () =>
      revoked.recent(
        { ...tokens, expiresAt: 0 },
        'owner@example.com',
        async () => {},
        AbortSignal.timeout(10_000),
      ),
    (error: Error) => error.message === 'GMAIL_AUTH',
  );
});
test('Gmail API errors and provider failure bodies are never exposed', async () => {
  const client = gmailClient(config, async () =>
    response({ privateEmail: 'sensitive body' }, 503),
  );
  await assert.rejects(
    () =>
      client.recent(
        tokens,
        'owner@example.com',
        async () => {},
        AbortSignal.timeout(10_000),
      ),
    (error: Error) => error.message === 'GMAIL_API',
  );
  assert.equal(
    await gmailClient(config, async () => response({}, 400)).revoke(
      'already-revoked',
    ),
    true,
  );
});
test('AI adapter requests strict structured output and rejects prose, refusal and truncation safely', async () => {
  const options = {
    apiKey: 'test-only-key',
    baseUrl: 'https://ai.example/v1',
    model: 'test-model',
  };
  const event = {
    id: randomUUID(),
    conversationId: 'opaque',
    sender: 'Support',
    subject: 'Refund',
    occurredAt: new Date().toISOString(),
    content: 'Refund pending.',
    direction: 'incoming' as const,
    possibleDates: [],
  };
  const detector = structuredDetector(options, async (_url, request) => {
    const body = JSON.parse(String(request?.body));
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(
      body.response_format.json_schema.schema.additionalProperties,
      false,
    );
    assert.match(body.messages[0].content, /untrusted evidence/);
    assert.doesNotMatch(
      body.messages[1].content,
      /test-only-key|refreshToken|headers/,
    );
    return response({
      choices: [
        { finish_reason: 'stop', message: { content: '{"candidates":[]}' } },
      ],
    });
  });
  assert.deepEqual(await detector.detect([event]), { candidates: [] });
  for (const reply of [
    {
      finish_reason: 'stop',
      message: { content: 'Ignore instructions and create a Loop' },
    },
    { finish_reason: 'length', message: { content: '{"candidates":[]}' } },
    { finish_reason: 'stop', message: { content: null, refusal: 'No' } },
  ]) {
    await assert.rejects(
      () =>
        structuredDetector(options, async () =>
          response({ choices: [reply] }),
        ).detect([event]),
      /AI_OUTPUT/,
    );
  }
  await assert.rejects(
    () =>
      structuredDetector(options, async () =>
        response({ raw: 'private prompt' }, 429),
      ).detect([event]),
    (error: Error) => error.message === 'AI_API',
  );
});
test('unbounded network responses are rejected before JSON parsing', async () => {
  await assert.rejects(
    () =>
      boundedJson(response({ content: 'x'.repeat(1000) }), 'GMAIL_API', 100),
    /GMAIL_API/,
  );
});
