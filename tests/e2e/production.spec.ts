import { test, expect } from './fixtures';
import { registerTestAccount } from '../fixtures/auth';

test('health returns only status and pages enforce a fresh CSP nonce', async ({
  page,
  request,
}) => {
  const live = await request.get('/api/health/live');
  expect(live.status()).toBe(200);
  expect(await live.json()).toEqual({ status: 'alive' });
  const ready = await request.get('/api/health/ready');
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: 'ready' });
  expect(ready.headers()['cache-control']).toBe('no-store');
  const violations: string[] = [];
  page.on('console', (message) => {
    if (
      /violates.*Content Security Policy|Refused to execute/i.test(
        message.text(),
      )
    )
      violations.push(message.text());
  });
  const response = await page.goto('/app/settings');
  const policy = response!.headers()['content-security-policy'];
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).not.toContain('unsafe-eval');
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  const nonces = await page
    .locator('script:not([src])')
    .evaluateAll((scripts) =>
      scripts.map((script) => (script as HTMLScriptElement).nonce),
    );
  expect(nonces.length).toBeGreaterThan(0);
  expect(nonces.every((value) => value === nonce)).toBe(true);
  const refreshed = await page.reload();
  expect(refreshed!.headers()['content-security-policy']).not.toBe(policy);
  expect(violations).toEqual([]);
});

test('confirmed account deletion revokes access and ignores a forged owner field', async ({
  page,
  browser,
  identity,
}) => {
  const other = await registerTestAccount();
  const otherContext = await browser.newContext();
  await otherContext.addCookies(other.cookies);
  try {
    await page.goto('/app/settings');
    await page.getByText('Delete your account', { exact: true }).click();
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await page
      .locator('form')
      .filter({ has: page.getByLabel('Type DELETE to confirm') })
      .evaluate((form, otherId) => {
        const forged = document.createElement('input');
        forged.type = 'hidden';
        forged.name = 'userId';
        forged.value = otherId;
        form.appendChild(forged);
      }, other.id);
    await page
      .getByRole('button', { name: 'Permanently delete account' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Your account has been deleted.' }),
    ).toBeVisible();
    await page.goto('/app');
    await expect(page).toHaveURL(/\/sign-in$/);
    const otherPage = await otherContext.newPage();
    await otherPage.goto('http://127.0.0.1:3100/app/settings');
    await expect(
      otherPage.getByText(other.email, { exact: true }),
    ).toBeVisible();
    expect(other.id).not.toBe(identity.id);
  } finally {
    await otherContext.close();
  }
});
