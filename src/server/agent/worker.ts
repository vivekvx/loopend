import { quietAgentLogger, type AgentOperationalLogger } from './logging';

function waitForWork(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, delayMs);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

export async function runAgentWorker(options: {
  runOne: () => Promise<boolean>;
  close: () => Promise<void>;
  signal: AbortSignal;
  once?: boolean;
  batchSize?: number;
  pollMs?: number;
  logger?: AgentOperationalLogger;
}) {
  const logger = options.logger ?? quietAgentLogger;
  const emit: AgentOperationalLogger = (event) => {
    try {
      logger(event);
    } catch {
      // Resource cleanup cannot depend on an operational log sink.
    }
  };
  const batchSize = options.batchSize ?? 8;
  const pollMs = options.pollMs ?? 5_000;
  let failure: unknown;
  emit({ event: 'worker.started' });
  try {
    do {
      let worked = false;
      for (
        let count = 0;
        count < batchSize && !options.signal.aborted;
        count++
      ) {
        worked = await options.runOne();
        if (!worked) break;
      }
      if (options.once || options.signal.aborted) break;
      if (!worked) await waitForWork(pollMs, options.signal);
    } while (!options.signal.aborted);
  } catch (error) {
    failure = error;
    emit({ event: 'worker.failed', code: 'WORKER' });
  }
  try {
    await options.close();
  } catch (error) {
    failure ??= error;
    emit({ event: 'worker.failed', code: 'DB_CLOSE' });
  } finally {
    emit({ event: 'worker.stopped' });
  }
  if (failure) throw failure;
}
