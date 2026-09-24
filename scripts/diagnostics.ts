import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readConfig } from '../src/server/config';
import { checkDatabase } from '../src/server/health';
import { operationalLog } from '../src/server/logging';
import * as schema from '../src/server/db/schema';

let client: ReturnType<typeof postgres> | undefined;
try {
  const config = readConfig('worker');
  operationalLog({ event: 'config.ready' });
  client = postgres(config.DATABASE_URL, {
    max: 1,
    onnotice: () => {},
    connect_timeout: 10,
    connection: { statement_timeout: 5000 },
  });
  await checkDatabase(drizzle(client, { schema }));
  operationalLog({ event: 'database.ready' });
  const [counts] = await client`select
    (select count(*)::int from source_connections where status = 'CONNECTED') as connected,
    (select count(*)::int from source_connections where scan_requested_at is not null) as scans_pending,
    (select count(*)::int from agent_jobs where status = 'PENDING') as monitoring_pending,
    (select count(*)::int from agent_jobs where status = 'RUNNING') as monitoring_running,
    (select count(*)::int from agent_jobs where status = 'FAILED') as monitoring_failed`;
  console.info(JSON.stringify({ event: 'diagnostics.counts', ...counts }));
} catch {
  operationalLog({ event: 'database.failed', code: 'DATABASE' });
  process.exitCode = 1;
} finally {
  await client?.end({ timeout: 5 });
}
