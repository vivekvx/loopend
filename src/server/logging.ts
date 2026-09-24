import type { AgentOperationalEvent } from './agent/logging';

type OperationalEvent =
  | AgentOperationalEvent
  | {
      event:
        | 'web.failed'
        | 'oauth.failed'
        | 'account.erased'
        | 'account.revocation_unconfirmed'
        | 'scan.completed'
        | 'scan.failed'
        | 'config.ready'
        | 'config.failed'
        | 'database.ready'
        | 'database.failed'
        | 'migration.completed'
        | 'migration.failed';
      code?: 'CONFIG' | 'DATABASE' | 'PROVIDER' | 'STORAGE' | 'STATE' | 'SCAN';
    };
// Callers cannot attach arbitrary exceptions or provider payloads.
export function operationalLog(event: OperationalEvent) {
  console.info(JSON.stringify({ time: new Date().toISOString(), ...event }));
}
