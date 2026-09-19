import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { registerTestAccount } from '../fixtures/auth';

test('production app requires a real session; sign in and logout revoke access', async ({
  page,
  context,
}, info) => {
  const identity = await registerTestAccount();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/app');
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel('Email address').fill(identity.email);
  await page.getByLabel('Password', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: 'Enter your space' }).click();
  await expect(page.locator('.auth-form [role="alert"]')).toContainText(
    'didn’t match',
  );
  await page.screenshot({
    path: `test-results/sign-in-${info.project.name}.png`,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel('Password', { exact: true }).fill(identity.password);
  await page.getByRole('button', { name: 'Enter your space' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Your open Loops' }),
  ).toBeVisible();
  const cookie = (await context.cookies()).find((cookie) =>
    cookie.name.includes('session_token'),
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.secure).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  await page.getByRole('link', { name: 'Account settings' }).click();
  await expect(page.getByText(identity.email, { exact: true })).toBeVisible();
  await expect(page.getByText('No Gmail account connected.')).toBeVisible();
  await page.screenshot({
    path: `test-results/settings-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  // Replay the old signed cookie: database revocation must still deny access.
  await context.addCookies([cookie!]);
  await page.goto('/app/closed');
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/app/scan');
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/app/settings');
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /Things start/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('public CTA, account creation, independent dashboard, and sign-up layout', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Find my open loops' }).first().click();
  await expect(page).toHaveURL(/\/sign-up$/);
  const email = `${randomUUID()}@example.com`;
  await page.getByLabel('Your name').fill('A new reader');
  await page.getByLabel('Email address').fill(email);
  await page
    .getByLabel('Password', { exact: true })
    .fill(randomBytes(24).toString('base64url'));
  await page.screenshot({
    path: `test-results/sign-up-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Create your account' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole('heading', { name: /Nothing urgent/ }),
  ).toBeVisible();
  await expect(page.locator('.loop-row')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('link', { name: 'Account settings' }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
});
