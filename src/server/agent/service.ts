import {
  AgentError,
  validateAgentEvaluation,
  type AgentEvaluator,
} from '../../domain/agent';
import { ScanError } from '../../domain/scan';
import type { LoopDatabase } from '../loops/service';
import { loopService } from '../loops/service';
import { tokenVault } from '../integrations/crypto';
import { googleTokens, type MailSource } from '../integrations/gmail/client';
import { leaseHeartbeat } from './heartbeat';
import {
  quietAgentLogger,
  shortJobId,
  type AgentOperationalLogger,
} from './logging';
import { AGENT_HEARTBEAT_MS, AGENT_LEASE_MS, agentStore } from './store';

const HOUR = 3_600_000;

function afterExpected(expectedBy: string | null, fallback: Date) {
  if (!expectedBy) return fallback;
  return new Date(
    Math.max(
      fallback.getTime(),
      new Date(`${expectedBy}T12:00:00.000Z`).getTime() + 24 * HOUR,
    ),
  );
}

function safeError(error: unknown) {
  if (error instanceof AgentError) return error;
  if (error instanceof ScanError)
    return new AgentError(
      error.code === 'GMAIL_AUTH' ? 'GMAIL_AUTH' : 'GMAIL_API',
    );
  return new AgentError('STORAGE');
}

export function agentRuntimeService(
  db: LoopDatabase,
  dependencies: {
    source: MailSource;
    evaluator: AgentEvaluator;
    encryptionKey: string;
    leaseMs?: number;
    heartbeatMs?: number;
    logger?: AgentOperationalLogger;
  },
) {
  const leaseMs = dependencies.leaseMs ?? AGENT_LEASE_MS;
  const heartbeatMs = dependencies.heartbeatMs ?? AGENT_HEARTBEAT_MS;
  if (heartbeatMs >= leaseMs)
    throw new Error('Agent heartbeat must be shorter than its lease.');
  const store = agentStore(db, { leaseMs });
  const vault = tokenVault(dependencies.encryptionKey);
  const logger = dependencies.logger ?? quietAgentLogger;
  const emit: AgentOperationalLogger = (event) => {
    try {
      logger(event);
    } catch {
      // Operational logging must never change job semantics.
    }
  };

  return {
    async runOne() {
      const claimed = await store.claimDue();
      if (!claimed) return false;
      const startedAt = Date.now();
      const { job, leaseId } = claimed;
      const safeJob = shortJobId(job.id);
      const loops = loopService(db, job.userId);
      const heartbeat = leaseHeartbeat(
        () => store.renewLease(job.id, job.userId, leaseId),
        heartbeatMs,
      );
      let connectionId: string | null = null;
      let terminalLogged = false;
      const durationMs = () => Math.max(0, Date.now() - startedAt);
      const completed = () => {
        terminalLogged = true;
        emit({
          event: 'job.completed',
          job: safeJob,
          attempt: job.attempts,
          durationMs: durationMs(),
        });
      };
      const failed = (code: AgentError['code']) => {
        terminalLogged = true;
        emit({
          event: 'job.failed',
          job: safeJob,
          attempt: job.attempts,
          durationMs: durationMs(),
          code,
        });
      };
      const apply = async (input: {
        decision:
          'STILL_WAITING' | 'POSSIBLE_SUCCESS' | 'NEEDS_USER' | 'UNKNOWN';
        rationale: string;
        evidenceReferences: string[];
        nextCheckAt: Date | null;
        userSummary: string | null;
      }) => {
        await heartbeat.assertOwned();
        const applied = await loops.agentApply({
          jobId: job.id,
          leaseId,
          generation: job.generation,
          ...input,
        });
        if (!applied) throw new AgentError('STALE');
      };
      const finishNoop = async () => {
        await heartbeat.assertOwned();
        if (!(await store.finishNoop(job.id, job.userId, leaseId, true)))
          throw new AgentError('STALE');
      };

      emit({ event: 'job.claimed', job: safeJob, attempt: job.attempts });
      try {
        const initial = await store.loadContext(job);
        if (
          !initial ||
          !initial.loop.monitoringEnabled ||
          initial.loop.monitoringGeneration !== job.generation ||
          initial.loop.status === 'CLOSED'
        ) {
          await finishNoop();
          completed();
          return true;
        }
        if (!['WAITING', 'AGENT_WORKING'].includes(initial.loop.status)) {
          await finishNoop();
          completed();
          return true;
        }
        const begun = await loops.agentBegin(job.loopId, job.generation);
        if (!begun) {
          await finishNoop();
          completed();
          return true;
        }
        const context = await store.loadContext(job);
        connectionId = context?.connection?.id ?? null;
        if (
          !context ||
          !context.connection ||
          !context.loop.monitoringConversationId
        ) {
          await apply({
            decision: 'NEEDS_USER',
            rationale: 'The Gmail source for this Loop is no longer available.',
            evidenceReferences: [],
            nextCheckAt: null,
            userSummary: 'Reconnect Gmail or review this Loop manually.',
          });
          completed();
          return true;
        }
        if (
          context.connection.status !== 'CONNECTED' ||
          !context.connection.tokenCiphertext
        ) {
          await apply({
            decision: 'NEEDS_USER',
            rationale: 'Gmail is disconnected or needs reauthorization.',
            evidenceReferences: [],
            nextCheckAt: null,
            userSummary:
              'Reconnect Gmail before Loopend can continue monitoring this conversation.',
          });
          completed();
          return true;
        }
        const now = new Date();
        const expected = context.loop.expectedBy
          ? new Date(`${context.loop.expectedBy}T23:59:59.999Z`)
          : null;
        if (expected && expected > now) {
          await apply({
            decision: 'STILL_WAITING',
            rationale: 'The expected window has not passed yet.',
            evidenceReferences: [],
            nextCheckAt: afterExpected(context.loop.expectedBy, now),
            userSummary:
              'Still within the expected window. Loopend will check after it has passed.',
          });
          completed();
          return true;
        }
        const tokens = googleTokens.safeParse(
          vault.open(
            context.connection.tokenCiphertext,
            `gmail:${context.connection.accountId}`,
          ),
        );
        if (!tokens.success) throw new AgentError('GMAIL_AUTH');
        if (!dependencies.source.conversation) throw new AgentError('SETUP');
        await heartbeat.assertOwned();
        const conversation = await dependencies.source.conversation(
          tokens.data,
          context.connection.accountEmail,
          context.loop.monitoringConversationId,
          async (updated) => {
            await heartbeat.assertOwned();
            const saved = await store.updateConnectionTokens(
              job,
              leaseId,
              context.connection!.id,
              vault.seal(updated, `gmail:${context.connection!.accountId}`),
            );
            if (!saved) throw new AgentError('STALE');
          },
          AbortSignal.any([heartbeat.signal, AbortSignal.timeout(120_000)]),
        );
        await heartbeat.assertOwned();
        if (
          conversation.some(
            (event) =>
              event.conversationId !== context.loop.monitoringConversationId,
          )
        )
          throw new AgentError('GMAIL_API');
        const persisted = conversation.length
          ? await store.persistConversationEvidence(
              job,
              leaseId,
              context.connection.id,
              conversation,
            )
          : { evidence: context.evidence, newMessageIds: new Set<string>() };
        if (!persisted) throw new AgentError('STALE');
        await heartbeat.assertOwned();
        if (!persisted.newMessageIds.size) {
          await apply({
            decision: 'STILL_WAITING',
            rationale: 'There is no new message evidence in this conversation.',
            evidenceReferences: [],
            nextCheckAt: new Date(
              now.getTime() + context.loop.monitoringCadenceHours * HOUR,
            ),
            userSummary:
              'No new evidence yet. Loopend will keep an eye on this conversation.',
          });
          completed();
          return true;
        }
        const evidence = [...persisted.evidence]
          .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
          .map((event) => ({
            id: event.id,
            sender: event.sender,
            subject: event.subject,
            occurredAt: event.occurredAt.toISOString(),
            content: event.content,
            direction: event.metadata.direction,
          }));
        const evaluation = validateAgentEvaluation(
          await dependencies.evaluator.evaluate(
            {
              loop: {
                status: context.loop.status,
                desiredOutcome: context.loop.desiredOutcome,
                verificationCondition: context.loop.verificationCondition,
                waitingOn: context.loop.waitingOn,
              },
              evidence,
              previousObservation: context.loop.monitoringLastObservation,
            },
            AbortSignal.any([heartbeat.signal, AbortSignal.timeout(75_000)]),
          ),
          evidence,
        );
        await heartbeat.assertOwned();
        const requested = evaluation.recommendedNextCheckAt
          ? new Date(evaluation.recommendedNextCheckAt)
          : new Date(
              now.getTime() + context.loop.monitoringCadenceHours * HOUR,
            );
        const conservative = new Date(
          Math.max(now.getTime() + 12 * HOUR, requested.getTime()),
        );
        await apply({
          decision: evaluation.decision,
          rationale: evaluation.rationale,
          evidenceReferences: evaluation.evidenceReferences,
          nextCheckAt:
            evaluation.decision === 'STILL_WAITING' ? conservative : null,
          userSummary: evaluation.userSummary,
        });
        completed();
        return true;
      } catch (error) {
        const safe = heartbeat.lost
          ? new AgentError('STALE')
          : safeError(error);
        if (safe.code === 'STALE') {
          failed('STALE');
          return true;
        }
        if (safe.code === 'GMAIL_AUTH') {
          try {
            await heartbeat.assertOwned();
            if (connectionId) {
              const marked = await store.markConnectionNeedsReauth(
                job,
                leaseId,
                connectionId,
              );
              if (!marked) throw new AgentError('STALE');
            }
            await apply({
              decision: 'NEEDS_USER',
              rationale:
                'Gmail authorization needs to be restored before monitoring can continue.',
              evidenceReferences: [],
              nextCheckAt: null,
              userSummary: 'Reconnect Gmail to continue monitoring this Loop.',
            });
            failed('GMAIL_AUTH');
          } catch {
            failed('STALE');
          }
          return true;
        }
        try {
          await heartbeat.assertOwned();
          const retry = await store.retry(job, leaseId, safe.code);
          if (retry.exhausted) {
            await apply({
              decision: 'NEEDS_USER',
              rationale:
                'Loopend could not safely complete several monitoring checks.',
              evidenceReferences: [],
              nextCheckAt: null,
              userSummary:
                'Monitoring needs your attention before it can continue.',
            });
            failed(safe.code);
          } else if (retry.retried) {
            terminalLogged = true;
            emit({
              event: 'job.retried',
              job: safeJob,
              attempt: job.attempts,
              durationMs: durationMs(),
              code: safe.code,
            });
          } else {
            failed('STALE');
          }
        } catch {
          failed('STALE');
        }
        return true;
      } finally {
        await heartbeat.stop();
        if (!terminalLogged) failed('STORAGE');
      }
    },
  };
}
