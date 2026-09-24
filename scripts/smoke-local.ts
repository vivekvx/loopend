import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import postgres from 'postgres';
import { testDatabaseUrl } from '../src/server/db/test-safety';

// This creates its own disposable local database; it never opens a real mailbox.
const url = new URL(testDatabaseUrl());
const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
const name = `loopend_smoke_test_${randomBytes(6).toString('hex')}`;
let created = false;
let web: ChildProcess | undefined;
let webExit: Promise<unknown> | undefined;
async function run(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn('pnpm', args, { env, stdio: 'ignore' });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error('Smoke command failed.');
  console.info(
    JSON.stringify({ event: 'smoke.command_passed', command: args[0] }),
  );
}
try {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('PORT');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  await admin`create database ${admin(name)}`;
  created = true;
  url.pathname = `/${name}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    LOOPEND_DEPLOYMENT: 'production',
    DATABASE_URL: url.toString(),
    MIGRATION_DATABASE_URL: url.toString(),
    APP_URL: `https://127.0.0.1:${port}`,
    PORT: String(port),
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    SOURCE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    GOOGLE_CLIENT_ID: 'local-smoke-no-network',
    GOOGLE_CLIENT_SECRET: 'local-smoke-no-network',
    LOOP_SCAN_AI_API_KEY: 'local-smoke-no-network',
    LOOP_SCAN_AI_BASE_URL: 'https://provider.invalid/v1',
    LOOP_SCAN_AI_MODEL: 'local-smoke-model',
  };
  await run(['config:check', 'web'], env);
  await run(['config:check', 'worker'], env);
  await run(['db:migrate'], env);
  await run(['db:migrate'], env);
  await run(['worker:once'], env);
  await run(['diagnostics'], env);
  web = spawn('pnpm', ['start'], { env, stdio: 'ignore', detached: true });
  webExit = once(web, 'exit');
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (web.exitCode !== null) throw new Error('Web startup failed.');
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/health/ready`,
        { signal: AbortSignal.timeout(1000) },
      );
      if (
        response.status === 200 &&
        JSON.stringify(await response.json()) === '{"status":"ready"}'
      ) {
        ready = true;
        break;
      }
    } catch {
      /* Startup may not yet be listening. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Readiness failed.');
  const live = await fetch(`http://127.0.0.1:${port}/api/health/live`, {
    signal: AbortSignal.timeout(1000),
  });
  if (
    live.status !== 200 ||
    JSON.stringify(await live.json()) !== '{"status":"alive"}'
  )
    throw new Error('Liveness failed.');
  console.info(
    JSON.stringify({ event: 'smoke.passed', realProvidersUsed: false }),
  );
} catch {
  console.error(JSON.stringify({ event: 'smoke.failed' }));
  process.exitCode = 1;
} finally {
  if (web?.pid && web.exitCode === null) {
    process.kill(-web.pid, 'SIGTERM');
    await webExit;
  }
  if (created) await admin`drop database ${admin(name)} with (force)`;
  await admin.end();
}
