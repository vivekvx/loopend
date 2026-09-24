import 'server-only';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import { databaseUrl, ConfigurationError } from '../config';

const globalDb = globalThis as unknown as {
  loopendSql?: ReturnType<typeof postgres>;
};
export function getDb() {
  const parsed = databaseUrl.safeParse(process.env.DATABASE_URL);
  if (!parsed.success) throw new ConfigurationError(['DATABASE_URL']);
  const url = parsed.data;
  const client =
    globalDb.loopendSql ??
    postgres(url, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      onnotice: () => {},
      connection: { statement_timeout: 10000 },
    });
  globalDb.loopendSql = client;
  return drizzle(client, { schema });
}
