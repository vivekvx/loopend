import { test, expect } from '@playwright/test';

test('production workspace requires a valid private session', async ({
  page,
  context,
}) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/access$/);
  await expect(
    page.getByRole('heading', { name: 'Your open Loops' }),
  ).toHaveCount(0);
  await page.getByLabel('Workspace password').fill('incorrect-password');
  await page.getByRole('button', { name: 'Enter your space' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'didn’t match' }),
  ).toBeVisible();
  await page
    .getByLabel('Workspace password')
    .fill('test-only-loopend-password');
  await page.getByRole('button', { name: 'Enter your space' }).click();
  await expect(page).toHaveURL(/\/app$/);
  const session = (await context.cookies()).find(
    (cookie) => cookie.name === 'loopend_session',
  );
  expect(session?.httpOnly).toBe(true);
  expect(session?.secure).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  await context.clearCookies();
  await page.goto('/app/closed');
  await expect(page).toHaveURL(/\/access$/);
});
