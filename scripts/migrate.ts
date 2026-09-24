import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { databaseUrl } from '../src/server/config';
import { operationalLog } from '../src/server/logging';
const parsed = databaseUrl.safeParse(
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
);
if (!parsed.success)
  throw new Error('A valid migration database connection is required.');
const client = postgres(parsed.data, {
  max: 1,
  onnotice: () => {},
  connect_timeout: 10,
});
try {
  await client`select pg_advisory_lock(721926012)`;
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  operationalLog({ event: 'migration.completed' });
} catch {
  operationalLog({ event: 'migration.failed', code: 'DATABASE' });
  process.exitCode = 1;
} finally {
  await client.end();
}
