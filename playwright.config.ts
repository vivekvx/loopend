import { TEST_AUTH_SECRET } from './tests/fixtures/auth';
import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';
import { testDatabaseUrl } from './src/server/db/test-safety';
config({ path: '.env.local', quiet: true });
const database = testDatabaseUrl();
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
        channel: 'chrome',
      },
    },
  ],
  webServer: {
    command: 'pnpm exec next start --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: database,
      LOOPEND_DEPLOYMENT: 'local',
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      SOURCE_TOKEN_ENCRYPTION_KEY: '',
      LOOP_SCAN_AI_API_KEY: '',
      APP_URL: 'http://127.0.0.1:3100',
    },
  },
});
