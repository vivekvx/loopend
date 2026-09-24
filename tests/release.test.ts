import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { testDatabaseUrl } from '../src/server/db/test-safety';
import { checkDatabase } from '../src/server/health';
import * as schema from '../src/server/db/schema';
import { loopService } from '../src/server/loops/service';
import { eraseAccount } from '../src/server/account/service';

test('release migrates fresh and historical databases; restricted runtime can erase only with its live session', async () => {
  const url = new URL(testDatabaseUrl());
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const name = `loopend_release_test_${randomBytes(6).toString('hex')}`;
  const role = `loopend_test_${randomBytes(6).toString('hex')}`;
  const directory = await mkdtemp(join(tmpdir(), 'loopend-migrations-'));
  let client: ReturnType<typeof postgres> | undefined;
  let created = false,
    roleCreated = false;
  try {
    await admin`create database ${admin(name)}`;
    created = true;
    url.pathname = `/${name}`;
    client = postgres(url.toString(), { max: 1, onnotice: () => {} });
    const db = drizzle(client, { schema });
    await mkdir(join(directory, 'meta'));
    const journal = JSON.parse(
      await readFile('drizzle/meta/_journal.json', 'utf8'),
    ) as { entries: { idx: number; tag: string }[] };
    const historical = {
      ...journal,
      entries: journal.entries.filter((entry) => entry.idx <= 10),
    };
    await writeFile(
      join(directory, 'meta/_journal.json'),
      JSON.stringify(historical),
    );
    for (const entry of historical.entries)
      await copyFile(
        `drizzle/${entry.tag}.sql`,
        join(directory, `${entry.tag}.sql`),
      );
    await migrate(db, { migrationsFolder: directory });
    await assert.rejects(() => checkDatabase(db));
    const owner = randomUUID();
    const sessionToken = randomBytes(32).toString('base64url');
    await db.insert(schema.user).values({
      id: owner,
      name: 'Upgrade fixture',
      email: `${owner}@example.com`,
    });
    await db.insert(schema.session).values({
      userId: owner,
      token: sessionToken,
      expiresAt: new Date(Date.now() + 3600000),
    });
    const loop = await loopService(db, owner).create({
      title: 'Preserve this history',
      summary: 'Upgrade fixture',
      desiredOutcome: 'A verified outcome',
      status: 'OPEN',
      waitingOn: '',
      expectedBy: '',
      nextAction: '',
      verificationCondition: 'A person checks the result',
    });
    await migrate(db, { migrationsFolder: './drizzle' });
    await migrate(db, { migrationsFolder: './drizzle' });
    await checkDatabase(db);
    assert.ok(await loopService(db, owner).get(loop.id));
    await client`create role ${client(role)} nologin`;
    roleCreated = true;
    await client`grant usage on schema public to ${client(role)}`;
    await client`grant select, insert, update, delete on all tables in schema public to ${client(role)}`;
    await client`grant usage, select on all sequences in schema public to ${client(role)}`;
    await client`grant execute on function public.erase_loopend_account(text,text) to ${client(role)}`;
    await assert.rejects(() =>
      db.transaction(async (tx) => {
        await tx.execute(sql`set local role ${sql.identifier(role)}`);
        await tx.execute(
          sql`select set_config('loopend.erasing_owner', ${owner}, true)`,
        );
        await tx.execute(
          sql`delete from public.loop_events where loop_id = ${loop.id}`,
        );
      }),
    );
    await assert.rejects(() =>
      db.transaction(async (tx) => {
        await tx.execute(sql`set local role ${sql.identifier(role)}`);
        await eraseAccount(
          tx,
          { userId: owner, sessionToken: 'invalid' },
          { confirmation: 'DELETE' },
          async () => true,
        );
      }),
    );
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local role ${sql.identifier(role)}`);
      await checkDatabase(tx);
      await eraseAccount(
        tx,
        { userId: owner, sessionToken },
        { confirmation: 'DELETE' },
        async () => true,
      );
    });
    assert.equal(await loopService(db, owner).get(loop.id), null);
  } finally {
    if (roleCreated && client) {
      await client`drop owned by ${client(role)}`;
      await client`drop role ${client(role)}`;
    }
    await client?.end();
    if (created) await admin`drop database ${admin(name)}`;
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
});
