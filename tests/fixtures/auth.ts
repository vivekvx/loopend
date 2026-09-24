import { testDatabaseUrl } from '../../src/server/db/test-safety';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { z } from 'zod';
import * as schema from '../../src/server/db/schema';
import { createAuth } from '../../src/server/auth/config';

export const TEST_AUTH_SECRET = 'local-fixture-7vMp92XaR0qs4HkT8JwLc6nZ-2026';
export const TEST_ORIGIN = 'http://127.0.0.1:3100';
export async function registerTestAccount() {
  const url = testDatabaseUrl();
  assert.ok(url);
  assert.notEqual(url, process.env.DATABASE_URL);
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: './drizzle' });
    const email = `${randomUUID()}@example.com`;
    const password = randomBytes(24).toString('base64url');
    const auth = createAuth(db, {
      secret: TEST_AUTH_SECRET,
      origin: TEST_ORIGIN,
      secure: true,
    });
    const response = await auth.api.signUpEmail({
      body: { name: 'Test reader', email, password },
      asResponse: true,
    });
    assert.equal(response.status, 200);
    const body = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await response.json());
    const cookies = response.headers
      .getSetCookie()
      .filter((cookie) => cookie.includes('session_token='))
      .map((cookie) => {
        const pair = cookie.split(';')[0];
        const separator = pair.indexOf('=');
        return {
          name: pair.slice(0, separator),
          value: pair.slice(separator + 1),
          domain: '127.0.0.1',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax' as const,
        };
      });
    assert.equal(cookies.length, 1);
    return { id: body.user.id, email, password, cookies };
  } finally {
    await client.end();
  }
}
