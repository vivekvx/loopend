import { test as base, expect } from '@playwright/test';
import { registerTestAccount } from '../fixtures/auth';
export const test = base.extend<{
  identity: Awaited<ReturnType<typeof registerTestAccount>>;
}>({
  identity: [
    async ({ context }, use) => {
      const identity = await registerTestAccount();
      await context.addCookies(identity.cookies);
      await use(identity);
    },
    { auto: true },
  ],
});
export { expect };
