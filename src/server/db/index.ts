import 'server-only';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

const globalDb = globalThis as unknown as {
  loopendSql?: ReturnType<typeof postgres>;
};
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required.');
  const client =
    globalDb.loopendSql ??
    postgres(url, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  globalDb.loopendSql = client;
  return drizzle(client, { schema });
}
