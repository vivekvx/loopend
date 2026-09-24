import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/server/db/schema';
import { readConfig, ConfigurationError } from '../src/server/config';
import { checkDatabase } from '../src/server/health';
import { scanQueue } from '../src/server/scan/queue';
import { structuredDetector } from '../src/server/scan/detector';
import { gmailClient } from '../src/server/integrations/gmail/client';
import { structuredAgentEvaluator } from '../src/server/agent/evaluator';
import { agentRuntimeService } from '../src/server/agent/service';
import { consoleAgentLogger } from '../src/server/agent/logging';
import { runAgentWorker } from '../src/server/agent/worker';

async function main() {
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let client: Sql | null = null;
  try {
    const config = readConfig('worker');
    const { gmail, ai } = config.integrations;
    if (!gmail || !ai) {
      consoleAgentLogger({ event: 'worker.failed', code: 'CONFIG' });
      process.exitCode = 1;
      return;
    }
    client = postgres(config.DATABASE_URL, {
      max: 5,
      prepare: false,
      connect_timeout: 10,
      onnotice: () => {},
      connection: { statement_timeout: 10000 },
    });
    const database = drizzle(client, { schema });
    await checkDatabase(database);
    const source = gmailClient({
      clientId: gmail.GOOGLE_CLIENT_ID,
      clientSecret: gmail.GOOGLE_CLIENT_SECRET,
      redirectUri: `${gmail.APP_URL}/api/gmail/callback`,
    });
    const aiConfig = {
      apiKey: ai.LOOP_SCAN_AI_API_KEY,
      baseUrl: ai.LOOP_SCAN_AI_BASE_URL,
      model: ai.LOOP_SCAN_AI_MODEL,
    };
    const scans = scanQueue(database, {
      source,
      detector: structuredDetector(aiConfig),
      encryptionKey: gmail.SOURCE_TOKEN_ENCRYPTION_KEY,
    });
    const worker = agentRuntimeService(database, {
      source,
      evaluator: structuredAgentEvaluator(aiConfig),
      encryptionKey: gmail.SOURCE_TOKEN_ENCRYPTION_KEY,
      logger: consoleAgentLogger,
    });
    await runAgentWorker({
      runOne: async () => {
        const scanned = await scans.runOne();
        const monitored = shutdown.signal.aborted
          ? false
          : await worker.runOne();
        return scanned || monitored;
      },
      close: async () => {
        const activeClient = client;
        client = null;
        if (activeClient) await activeClient.end({ timeout: 5 });
      },
      signal: shutdown.signal,
      once: config.LOOPEND_WORKER_ONCE === '1',
      logger: consoleAgentLogger,
    });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (client)
      await client.end({ timeout: 5 }).catch(() => {
        consoleAgentLogger({ event: 'worker.failed', code: 'DB_CLOSE' });
        process.exitCode = 1;
      });
  }
}

main().catch((error: unknown) => {
  consoleAgentLogger({
    event: 'worker.failed',
    code: error instanceof ConfigurationError ? 'CONFIG' : 'WORKER',
  });
  process.exitCode = 1;
});
