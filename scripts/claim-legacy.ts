import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { claimLegacy } from '../src/server/db/claim-legacy';
import * as schema from '../src/server/db/schema';

const userId = process.argv[2];
if (!userId || process.argv[3] !== '--confirm-legacy-transfer')
  throw new Error(
    'Usage: pnpm db:claim-legacy <existing-user-id> --confirm-legacy-transfer. Review and back up legacy data first.',
  );
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const client = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const counts = await claimLegacy(drizzle(client, { schema }), userId);
  console.log('Legacy transfer completed. Counts:', counts);
} finally {
  await client.end();
}
