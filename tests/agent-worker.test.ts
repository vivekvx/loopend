import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentWorker } from '../src/server/agent/worker';
import type { AgentOperationalEvent } from '../src/server/agent/logging';

test('worker shutdown drains active work, stops claims, and closes once', async () => {
  const shutdown = new AbortController();
  const events: AgentOperationalEvent[] = [];
  let calls = 0;
  let closes = 0;
  let started!: () => void;
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const worker = runAgentWorker({
    runOne: async () => {
      calls++;
      started();
      await held;
      return true;
    },
    close: async () => {
      closes++;
    },
    signal: shutdown.signal,
    pollMs: 10,
    logger: (event) => events.push(event),
  });
  await active;
  shutdown.abort();
  finish();
  await worker;
  assert.equal(calls, 1);
  assert.equal(closes, 1);
  assert.deepEqual(
    events.map((event) => event.event),
    ['worker.started', 'worker.stopped'],
  );
});

test('worker failure still closes database resources', async () => {
  let closes = 0;
  await assert.rejects(() =>
    runAgentWorker({
      runOne: async () => {
        throw new Error('not logged');
      },
      close: async () => {
        closes++;
      },
      signal: new AbortController().signal,
      once: true,
    }),
  );
  assert.equal(closes, 1);
});
