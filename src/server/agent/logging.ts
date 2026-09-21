import type { AgentError } from '../../domain/agent';

type SafeErrorCode = AgentError['code'] | 'CONFIG' | 'DB_CLOSE' | 'WORKER';

export type AgentOperationalEvent =
  | { event: 'worker.started' }
  | { event: 'worker.stopped' }
  | { event: 'worker.failed'; code: SafeErrorCode }
  | {
      event: 'job.claimed';
      job: string;
      attempt: number;
    }
  | {
      event: 'job.completed';
      job: string;
      attempt: number;
      durationMs: number;
    }
  | {
      event: 'job.retried' | 'job.failed';
      job: string;
      attempt: number;
      durationMs: number;
      code: SafeErrorCode;
    };

export type AgentOperationalLogger = (event: AgentOperationalEvent) => void;

export const quietAgentLogger: AgentOperationalLogger = () => undefined;

export function shortJobId(id: string) {
  return id.replaceAll('-', '').slice(0, 10);
}

export const consoleAgentLogger: AgentOperationalLogger = (event) => {
  console.info('[loopend-worker]', JSON.stringify(event));
};
