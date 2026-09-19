import { test, expect } from './fixtures';

test('a real Loop persists through edits, activity, verification, and closure', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const title = `Refund for order ${testInfo.project.name}-${Date.now()}`;
  await page.goto('/app');
  await expect(
    page.getByRole('heading', { name: 'Your open Loops' }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/dashboard-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('link', { name: 'New Loop' }).click();
  await page.getByLabel('What hasn’t finished?').fill(title);
  await page
    .getByLabel('What’s the situation?')
    .fill('Returned a jacket. The promised refund hasn’t arrived.');
  await page
    .getByLabel('Desired outcome')
    .fill('£128 is returned to my account.');
  await page.getByLabel('Current state').selectOption('WAITING');
  await page.getByLabel('Expected by').fill('2027-01-15');
  await page.getByLabel('Who or what are we waiting on?').fill('The retailer');
  await page.getByLabel('Next action').fill('Check the bank statement.');
  await page
    .getByLabel('What will count as finished?')
    .fill('A £128 credit on my bank statement.');
  await page.getByRole('button', { name: 'Open this Loop' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const detailUrl = page.url();
  await expect(
    page.getByRole('button', { name: 'Verify & close Loop' }),
  ).toHaveCount(0);
  await page
    .getByLabel('Add to the story')
    .fill('Customer support says the refund has been processed.');
  await page.getByRole('button', { name: 'Add activity' }).click();
  await expect(
    page.getByText('Customer support says the refund has been processed.'),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Customer support says the refund has been processed.'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Edit details & state' }).click();
  await page.getByLabel('Current state').selectOption('NEEDS_USER');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.locator('.detail-header .status')).toHaveText('Needs you');
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /attention/ })).toBeVisible();
  await page.goto(detailUrl);
  await page.getByRole('link', { name: 'Edit details & state' }).click();
  await page.getByLabel('Current state').selectOption('VERIFYING');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page
    .getByLabel('Record the evidence')
    .fill('I checked the statement: the £128 credit arrived today.');
  await page.getByLabel('I verified that').check();
  await page.getByRole('button', { name: 'Verify & close Loop' }).click();
  await expect(
    page.getByRole('heading', { name: 'One less open Loop.' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('Completion evidence')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Edit details & state' }),
  ).toHaveCount(0);
  await page.screenshot({
    path: `test-results/detail-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.goto('/app/closed');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('landing renders immediately, uses WebGL2 without WebGPU, and scrolls to closure', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', {
      value: undefined,
      configurable: true,
    });
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /Things start/ }),
  ).toBeVisible();
  await expect(page.locator('.hero-art')).toHaveAttribute(
    'data-renderer',
    'webgl2',
    { timeout: 30_000 },
  );
  await page.screenshot({
    path: `test-results/landing-${testInfo.project.name}.png`,
    fullPage: false,
  });
  await page
    .getByRole('heading', { name: 'Now it’s finished.' })
    .scrollIntoViewIfNeeded();
  await expect(page.locator('.story-diagram')).toHaveAttribute(
    'data-stage',
    '5',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('link', { name: 'Find my open loops' }).first().click();
  await expect(page).toHaveURL(/\/app$/);
  expect(errors).toEqual([]);
});

test('reduced motion keeps a polished static hero with no graphics bundle or canvas', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const graphicsBundles: Promise<boolean>[] = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'script')
      graphicsBundles.push(
        response
          .text()
          .then((body) => body.includes('THREE.WebGPURenderer'))
          .catch(() => false),
      );
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /Things start/ }),
  ).toBeVisible();
  await expect(page.locator('.hero-art')).toHaveAttribute(
    'data-renderer',
    'static',
  );
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'A reply isn’t a resolution.' }),
  ).toBeAttached();
  await page.screenshot({
    path: `test-results/reduced-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect((await Promise.all(graphicsBundles)).some(Boolean)).toBe(false);
});

test('unknown loop has a useful not-found state', async ({ page }) => {
  await page.goto('/app/loops/not-a-uuid');
  await expect(
    page.getByRole('heading', { name: 'This page isn’t here.' }),
  ).toBeVisible();
});
