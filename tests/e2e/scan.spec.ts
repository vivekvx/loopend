import { test, expect } from '@playwright/test';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/server/db/schema';
import {
  saveConnection,
  detachConnection,
} from '../../src/server/integrations/gmail/connections';
import { normalizeGmail } from '../../src/server/integrations/gmail/normalize';
import { tokenVault } from '../../src/server/integrations/crypto';
import { loopScanService } from '../../src/server/scan/service';
import { gmailFixture, candidateFixture } from '../fixtures/scan';

test.beforeEach(async ({ context }) => {
  // Auth is separately exercised through the real login UI in access.spec.ts.
  const expires = String(Date.now() + 60 * 60_000);
  const signature = createHmac(
    'sha256',
    'test-only-loopend-session-secret-not-for-deployment',
  )
    .update(`${expires}:test-only-loopend-password`)
    .digest('hex');
  await context.addCookies([
    {
      name: 'loopend_session',
      value: `${expires}.${signature}`,
      url: 'http://127.0.0.1:3100',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
});
async function seedSuggestion(title: string, keepConnected = false) {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url);
  assert.notEqual(url, process.env.DATABASE_URL);
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    const key = randomBytes(32).toString('base64');
    const id = await saveConnection(
      db,
      `${randomUUID()}@example.com`,
      {
        accessToken: 'fixture-only',
        refreshToken: 'fixture-only',
        expiresAt: Date.now() + 3600_000,
      },
      tokenVault(key),
    );
    await loopScanService(db, {
      encryptionKey: key,
      source: {
        recent: async () => ({
          events: [normalizeGmail(gmailFixture(), 'owner@example.com')!],
          fetched: 1,
          skipped: 0,
        }),
      },
      detector: {
        detect: async (events) => ({
          candidates: [{ ...candidateFixture([events[0].id]), title }],
        }),
      },
    }).scan(id);
    const [candidate] = await db
      .select()
      .from(schema.loopCandidates)
      .where(eq(schema.loopCandidates.connectionId, id));
    if (!keepConnected) await detachConnection(db, id);
    return candidate;
  } finally {
    await client.end();
  }
}

test('Loop Scan has a clear configuration state and does not break manual Loops', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/app');
  await page.getByRole('link', { name: 'Loop Scan', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Find what you’ve forgotten.' }),
  ).toBeVisible();
  await expect(
    page.getByText('The AI detector needs a configured API key.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('Gmail connection settings need to be configured', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/up to 50 recent messages from the last 30 days/),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/scan-setup-${testInfo.project.name}.png`,
  });
  await page.getByRole('link', { name: 'Your Loops', exact: true }).click();
  await expect(page.getByRole('link', { name: 'New Loop' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('disconnect erases local tokens and keeps revocation failure guidance visible', async ({
  page,
}) => {
  const candidate = await seedSuggestion(
    `Disconnect review ${Date.now()}`,
    true,
  );
  await page.goto('/app/scan');
  const connection = page
    .locator('.scan-connection')
    .filter({ has: page.locator(`input[value="${candidate.connectionId}"]`) });
  await connection.getByText('Disconnect Gmail', { exact: true }).click();
  await connection
    .getByRole('button', { name: 'Disconnect this account' })
    .click();
  await expect(page).toHaveURL(/notice=revocation-unconfirmed$/);
  await expect(page.getByRole('status')).toContainText('local tokens removed');
  await expect(page.getByRole('status')).toContainText(
    'Google Account permissions',
  );
  await expect(connection).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: candidate.title }),
  ).toBeVisible();
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url);
  assert.notEqual(url, process.env.DATABASE_URL);
  const client = postgres(url, { max: 1 });
  try {
    const db = drizzle(client, { schema });
    const [saved] = await db
      .select()
      .from(schema.sourceConnections)
      .where(eq(schema.sourceConnections.id, candidate.connectionId));
    expect(saved.tokenCiphertext).toBeNull();
    expect(saved.status).toBe('DISCONNECTED');
  } finally {
    await client.end();
  }
});

test('source evidence is inspectable and Track this creates a provenance-linked Loop', async ({
  page,
}, testInfo) => {
  const candidate = await seedSuggestion(
    `A refund to review ${testInfo.project.name} ${Date.now()}`,
  );
  await page.goto('/app/scan');
  const card = page
    .locator('article.candidate')
    .filter({ has: page.getByRole('heading', { name: candidate.title }) });
  await expect(card).toBeVisible();
  await card.locator('summary').click();
  await expect(
    card.getByText(/Your £128 refund will arrive within/),
  ).toBeVisible();
  await expect(card.getByText(/Private quoted history/)).toHaveCount(0);
  await expect(
    card.getByRole('link', { name: 'Open conversation in Gmail' }),
  ).toHaveAttribute('rel', 'noopener noreferrer');
  await card.screenshot({
    path: `test-results/scan-candidate-${testInfo.project.name}.png`,
  });
  await card.getByRole('button', { name: 'Track this' }).click();
  await expect(page).toHaveURL(/\/app\/loops\/[a-f0-9-]+$/);
  await expect(
    page.getByRole('heading', { name: candidate.title }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'You reviewed a Loop Scan suggestion from Gmail and chose to track it.',
    ),
  ).toBeVisible();
  await expect(page.locator('.detail-header .status')).toHaveText('Open');
  await page.goto('/app/scan');
  await expect(
    page.getByRole('heading', { name: candidate.title }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('Ignore persists across reload and forged callbacks do not connect an account', async ({
  page,
}) => {
  const candidate = await seedSuggestion(
    `Ignore this suggestion ${Date.now()}`,
  );
  await page.goto('/app/scan');
  const card = page
    .locator('article.candidate')
    .filter({ has: page.getByRole('heading', { name: candidate.title }) });
  await card.getByRole('button', { name: 'Ignore', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: candidate.title }),
  ).toHaveCount(0);
  await page.goto('/api/gmail/callback?state=forged&code=not-real');
  await expect(page).toHaveURL(/\/app\/scan\?notice=connection-failed$/);
  await expect(
    page.getByText('Gmail could not be connected.', { exact: false }),
  ).toBeVisible();
});
