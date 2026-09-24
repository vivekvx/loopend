import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readConfig, type Environment } from '../src/server/config';
import { tokenVault } from '../src/server/integrations/crypto';
import { readiness } from '../src/server/health';
import { testDatabaseUrl } from '../src/server/db/test-safety';
import { safeRead } from '../src/server/errors';

const valid = (): Environment => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://localhost/loopend',
  APP_URL: 'https://loopend.example',
  BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
  GOOGLE_CLIENT_ID: 'fixture-client',
  GOOGLE_CLIENT_SECRET: 'fixture-secret',
  SOURCE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  LOOP_SCAN_AI_API_KEY: 'fixture-ai',
  LOOP_SCAN_AI_BASE_URL: 'https://ai.example/v1',
  LOOP_SCAN_AI_MODEL: 'configured-model',
});

test('production config rejects noncanonical origins, weak secrets, invalid keys and missing integrations', () => {
  const env = valid();
  assert.equal(readConfig('web', env).production, true);
  assert.equal(
    readConfig('worker', { ...env, BETTER_AUTH_SECRET: undefined }).production,
    true,
  );
  for (const APP_URL of [
    'https://loopend.example/',
    'https://loopend.example/path',
    'http://localhost:3000',
    'https://user:pass@loopend.example',
    'https://loopend.example?x=1',
    'not-a-url',
  ])
    assert.throws(() => readConfig('web', { ...env, APP_URL }), /APP_URL/);
  for (const BETTER_AUTH_SECRET of [
    'short',
    'a'.repeat(64),
    'test-only-auth-secret-never-use-for-deployment-2026',
  ])
    assert.throws(
      () => readConfig('web', { ...env, BETTER_AUTH_SECRET }),
      /BETTER_AUTH_SECRET/,
    );
  for (const SOURCE_TOKEN_ENCRYPTION_KEY of [
    'a'.repeat(32),
    randomBytes(31).toString('base64'),
    `${env.SOURCE_TOKEN_ENCRYPTION_KEY}\n`,
    `${env.SOURCE_TOKEN_ENCRYPTION_KEY}!`,
  ]) {
    assert.throws(
      () => readConfig('worker', { ...env, SOURCE_TOKEN_ENCRYPTION_KEY }),
      /SOURCE_TOKEN_ENCRYPTION_KEY/,
    );
    assert.throws(() => tokenVault(SOURCE_TOKEN_ENCRYPTION_KEY), /SETUP/);
  }
  for (const name of [
    'DATABASE_URL',
    'APP_URL',
    'BETTER_AUTH_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'SOURCE_TOKEN_ENCRYPTION_KEY',
    'LOOP_SCAN_AI_API_KEY',
    'LOOP_SCAN_AI_BASE_URL',
    'LOOP_SCAN_AI_MODEL',
  ])
    assert.throws(
      () => readConfig('web', { ...env, [name]: undefined }),
      new RegExp(name),
    );
  assert.throws(
    () =>
      readConfig('web', {
        ...env,
        LOOP_SCAN_AI_BASE_URL: 'http://localhost:4000',
      }),
    /LOOP_SCAN_AI_BASE_URL/,
  );
  assert.throws(
    () => readConfig('web', { ...env, LOOPEND_DEPLOYMENT: 'local' }),
    /LOOPEND_DEPLOYMENT/,
  );
});

test('readiness and server rendering errors never expose secrets or exception payloads', async () => {
  const env = valid();
  assert.deepEqual(await readiness(async () => {}, env), { status: 'ready' });
  assert.deepEqual(
    await readiness(async () => {
      throw new Error(`private: ${env.DATABASE_URL} ${env.BETTER_AUTH_SECRET}`);
    }, env),
    { status: 'unavailable' },
  );
  assert.deepEqual(
    await readiness(async () => assert.fail('must not access database'), {
      ...env,
      APP_URL: 'invalid',
    }),
    { status: 'unavailable' },
  );
  await assert.rejects(
    () =>
      safeRead(async () => {
        throw new Error('private-token');
      }),
    (error: Error) =>
      error.message === 'Workspace temporarily unavailable.' &&
      !('cause' in error),
  );
});

test('test database guard rejects remote, production-like, aliases and equal databases', () => {
  assert.equal(
    testDatabaseUrl({
      TEST_DATABASE_URL: 'postgresql://localhost/loopend_test',
      DATABASE_URL: 'postgresql://localhost/loopend_dev',
    }),
    'postgresql://localhost/loopend_test',
  );
  for (const TEST_DATABASE_URL of [
    'postgresql://production.example/loopend_test',
    'postgresql://localhost/loopend',
    'postgresql://localhost/production_test',
    'postgresql://localhost/test_live',
    'postgresql://localhost/loopend_test?host=production.example',
  ])
    assert.throws(() => testDatabaseUrl({ TEST_DATABASE_URL }));
  assert.throws(() =>
    testDatabaseUrl({
      TEST_DATABASE_URL: 'postgresql://user@127.0.0.1/loopend_test',
      DATABASE_URL:
        'postgresql://another@localhost/loopend_test?sslmode=disable',
    }),
  );
  assert.throws(() =>
    testDatabaseUrl({
      TEST_DATABASE_URL: 'postgresql://localhost/loopend_test',
      NODE_ENV: 'production',
    }),
  );
});
