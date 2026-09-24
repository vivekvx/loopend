import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { claimLegacy } from '../src/server/db/claim-legacy';
import * as schema from '../src/server/db/schema';
import { databaseUrl } from '../src/server/config';

const userId = process.argv[2];
if (!userId || process.argv[3] !== '--confirm-legacy-transfer')
  throw new Error(
    'Usage: pnpm db:claim-legacy <existing-user-id> --confirm-legacy-transfer. Review and back up legacy data first.',
  );
const parsed = databaseUrl.safeParse(
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
);
if (!parsed.success)
  throw new Error('A valid operator database connection is required.');
const client = postgres(parsed.data, { max: 1, onnotice: () => {} });
try {
  const counts = await claimLegacy(drizzle(client, { schema }), userId);
  console.log('Legacy transfer completed. Counts:', counts);
} catch {
  console.error(
    'Legacy transfer failed. No provider or database payloads are logged.',
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
