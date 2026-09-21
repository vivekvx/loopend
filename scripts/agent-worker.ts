import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/server/db/schema';
import { scanSetup } from '../src/server/scan/config';
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
    const setup = scanSetup();
    const databaseUrl = process.env.DATABASE_URL;
    if (!setup.gmailReady || !setup.aiReady || !databaseUrl) {
      consoleAgentLogger({ event: 'worker.failed', code: 'CONFIG' });
      process.exitCode = 1;
      return;
    }
    client = postgres(databaseUrl, { max: 5, prepare: false });
    const database = drizzle(client, { schema });
    const worker = agentRuntimeService(database, {
      source: gmailClient({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        redirectUri: `${setup.origin}/api/gmail/callback`,
      }),
      evaluator: structuredAgentEvaluator({
        apiKey: process.env.LOOP_SCAN_AI_API_KEY!,
        baseUrl: setup.baseUrl,
        model: setup.model,
      }),
      encryptionKey: process.env.SOURCE_TOKEN_ENCRYPTION_KEY!,
      logger: consoleAgentLogger,
    });
    await runAgentWorker({
      runOne: worker.runOne,
      close: async () => {
        const activeClient = client;
        client = null;
        if (activeClient) await activeClient.end({ timeout: 5 });
      },
      signal: shutdown.signal,
      once: process.env.LOOPEND_WORKER_ONCE === '1',
      logger: consoleAgentLogger,
    });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (client) await client.end({ timeout: 5 }).catch(() => undefined);
  }
}

main().catch(() => {
  consoleAgentLogger({ event: 'worker.failed', code: 'WORKER' });
  process.exitCode = 1;
});
