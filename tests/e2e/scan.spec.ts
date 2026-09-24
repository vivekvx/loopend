import { testDatabaseUrl } from '../../src/server/db/test-safety';
import { test, expect } from './fixtures';
import { randomBytes, randomUUID } from 'node:crypto';
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
import { registerTestAccount } from '../fixtures/auth';
import { loopService } from '../../src/server/loops/service';

async function seedSuggestion(
  userId: string,
  title: string,
  keepConnected = false,
) {
  const url = testDatabaseUrl();
  assert.ok(url);
  assert.notEqual(url, process.env.DATABASE_URL);
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    const key = randomBytes(32).toString('base64');
    const id = await saveConnection(
      db,
      userId,
      `${randomUUID()}@example.com`,
      {
        accessToken: 'fixture-only',
        refreshToken: 'fixture-only',
        expiresAt: Date.now() + 3600_000,
      },
      tokenVault(key),
    );
    await loopScanService(db, userId, {
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
    if (!keepConnected) await detachConnection(db, userId, id);
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

test('settings disconnect erases local tokens and keeps revocation failure guidance visible', async ({
  page,
  identity,
}) => {
  const candidate = await seedSuggestion(
    identity.id,
    `Disconnect review ${Date.now()}`,
    true,
  );
  await page.goto('/app/settings');
  const connection = page
    .locator('.settings-connection')
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
  const url = testDatabaseUrl();
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
  identity,
}, testInfo) => {
  const candidate = await seedSuggestion(
    identity.id,
    `A refund to review ${testInfo.project.name} ${Date.now()}`,
    true,
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
  await expect(
    page.getByRole('heading', { name: 'Quiet until you ask.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Enable monitoring' }).click();
  await expect(
    page.getByRole('heading', { name: 'Loopend is keeping watch.' }),
  ).toBeVisible();
  await expect(
    page.getByText('Gmail conversation', { exact: true }),
  ).toBeVisible();
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
  identity,
}) => {
  const candidate = await seedSuggestion(
    identity.id,
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

test('another account’s Loop and candidate stay private, including a tampered Server Action', async ({
  page,
  identity,
}) => {
  const other = await registerTestAccount();
  const candidate = await seedSuggestion(
    other.id,
    `Private candidate ${randomUUID()}`,
  );
  const url = testDatabaseUrl();
  assert.ok(url);
  assert.notEqual(url, process.env.DATABASE_URL);
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    const input = {
      title: 'A private application',
      summary: '',
      desiredOutcome: 'A decision arrives in writing.',
      status: 'OPEN',
      waitingOn: 'Admissions',
      expectedBy: '',
      nextAction: '',
      verificationCondition: 'The decision letter arrives.',
    };
    const mine = await loopService(db, identity.id).create(input);
    const theirs = await loopService(db, other.id).create({
      ...input,
      title: 'Someone else’s application',
    });
    await page.goto('/app/scan');
    await expect(
      page.getByRole('heading', { name: candidate.title }),
    ).toHaveCount(0);
    await page.goto(`/app/loops/${theirs.id}`);
    await expect(
      page.getByRole('heading', { name: 'This page isn’t here.' }),
    ).toBeVisible();
    await page.goto(`/app/loops/${mine.id}/edit`);
    // Tamper at the request boundary; hydration may restore controlled hidden inputs.
    let tampered = false;
    await page.route(`**/app/loops/${mine.id}/edit`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = route.request().postData() ?? '';
      expect(body).toContain(mine.id);
      tampered = true;
      await route.continue({ postData: body.replaceAll(mine.id, theirs.id) });
    });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.loop-form .form-error')).toContainText(
      'could not be found',
    );
    expect(tampered).toBe(true);
    expect((await loopService(db, other.id).get(theirs.id))?.loop.version).toBe(
      1,
    );
  } finally {
    await client.end();
  }
});
