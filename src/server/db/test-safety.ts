import { databaseUrl, type Environment } from '../config';

export function testDatabaseUrl(env: Environment = process.env) {
  const parsed = databaseUrl.safeParse(env.TEST_DATABASE_URL);
  if (!parsed.success)
    throw new Error('A separate local TEST_DATABASE_URL is required.');
  const test = new URL(parsed.data);
  const database = decodeURIComponent(test.pathname).toLowerCase();
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(test.hostname) ||
    !/(^|[_-])test([_-]|$)/.test(database.slice(1)) ||
    /prod|live/.test(database) ||
    test.searchParams.has('host') ||
    test.searchParams.has('hostaddr') ||
    env.NODE_ENV === 'production' ||
    env.LOOPEND_DEPLOYMENT === 'production'
  )
    throw new Error(
      'Tests require a local database explicitly named test; production is refused.',
    );
  for (const raw of [env.DATABASE_URL, env.MIGRATION_DATABASE_URL]) {
    if (!raw) continue;
    const other = new URL(raw);
    // Reject the same database even through aliases, credentials, or query differences.
    if (decodeURIComponent(other.pathname).toLowerCase() === database)
      throw new Error('Test and runtime/migration databases must be distinct.');
  }
  return parsed.data;
}
