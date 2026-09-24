import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
if (process.env.NODE_ENV !== 'production')
  config({ path: '.env.local', quiet: true });
export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || '',
  },
});
