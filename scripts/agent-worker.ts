import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/server/db/schema';
import { scanSetup } from '../src/server/scan/config';
import { gmailClient } from '../src/server/integrations/gmail/client';
import { structuredAgentEvaluator } from '../src/server/agent/evaluator';
import { agentRuntimeService } from '../src/server/agent/service';

const setup = scanSetup();
if (!setup.gmailReady || !setup.aiReady) {
  console.error('Worker configuration is incomplete. No jobs were claimed.');
  process.exitCode = 1;
} else {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const database = drizzle(postgres(databaseUrl, { max: 5, prepare: false }), {
    schema,
  });
  const source = gmailClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: `${setup.origin}/api/gmail/callback`,
  });
  const worker = agentRuntimeService(database, {
    source,
    evaluator: structuredAgentEvaluator({
      apiKey: process.env.LOOP_SCAN_AI_API_KEY!,
      baseUrl: setup.baseUrl,
      model: setup.model,
    }),
    encryptionKey: process.env.SOURCE_TOKEN_ENCRYPTION_KEY!,
  });
  const once = process.env.LOOPEND_WORKER_ONCE === '1';
  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
  });
  process.on('SIGTERM', () => {
    stopping = true;
  });
  do {
    let worked = false;
    for (let count = 0; count < 8 && !stopping; count++) {
      worked = await worker.runOne();
      if (!worked) break;
    }
    if (once || stopping) break;
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 5_000));
  } while (!stopping);
}
