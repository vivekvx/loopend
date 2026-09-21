import { and, eq } from 'drizzle-orm';
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
import { sourceConnections } from '../db/schema';
import { agentStore } from './store';

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
  },
) {
  const store = agentStore(db);
  const vault = tokenVault(dependencies.encryptionKey);
  return {
    async runOne() {
      const claimed = await store.claimDue();
      if (!claimed) return false;
      const { job, leaseId } = claimed;
      const loops = loopService(db, job.userId);
      try {
        const initial = await store.loadContext(job);
        if (
          !initial ||
          !initial.loop.monitoringEnabled ||
          initial.loop.monitoringGeneration !== job.generation ||
          initial.loop.status === 'CLOSED'
        ) {
          await store.finishNoop(job.id, job.userId, leaseId, true);
          return true;
        }
        if (!['WAITING', 'AGENT_WORKING'].includes(initial.loop.status)) {
          await store.finishNoop(job.id, job.userId, leaseId, true);
          return true;
        }
        const begun = await loops.agentBegin(job.loopId, job.generation);
        if (!begun) {
          await store.finishNoop(job.id, job.userId, leaseId, true);
          return true;
        }
        const context = await store.loadContext(job);
        if (
          !context ||
          !context.connection ||
          !context.loop.monitoringConversationId
        ) {
          await loops.agentApply({
            jobId: job.id,
            leaseId,
            generation: job.generation,
            decision: 'NEEDS_USER',
            rationale: 'The Gmail source for this Loop is no longer available.',
            evidenceReferences: [],
            nextCheckAt: null,
            userSummary: 'Reconnect Gmail or review this Loop manually.',
          });
          return true;
        }
        if (
          context.connection.status !== 'CONNECTED' ||
          !context.connection.tokenCiphertext
        ) {
          await loops.agentApply({
            jobId: job.id,
            leaseId,
            generation: job.generation,
            decision: 'NEEDS_USER',
            rationale: 'Gmail is disconnected or needs reauthorization.',
            evidenceReferences: [],
            nextCheckAt: null,
            userSummary:
              'Reconnect Gmail before Loopend can continue monitoring this conversation.',
          });
          return true;
        }
        const now = new Date();
        const expected = context.loop.expectedBy
          ? new Date(`${context.loop.expectedBy}T23:59:59.999Z`)
          : null;
        if (expected && expected > now) {
          await loops.agentApply({
            jobId: job.id,
            leaseId,
            generation: job.generation,
            decision: 'STILL_WAITING',
            rationale: 'The expected window has not passed yet.',
            evidenceReferences: [],
            nextCheckAt: afterExpected(context.loop.expectedBy, now),
            userSummary:
              'Still within the expected window. Loopend will check after it has passed.',
          });
          return true;
        }
        const tokens = googleTokens.safeParse(
          vault.open(
            context.connection.tokenCiphertext,
            `gmail:${context.connection.accountId}`,
          ),
        );
        if (!tokens.success) throw new AgentError('GMAIL_AUTH');
        const signal = AbortSignal.timeout(120_000);
        if (!dependencies.source.conversation) throw new AgentError('SETUP');
        const conversation = await dependencies.source.conversation(
          tokens.data,
          context.connection.accountEmail,
          context.loop.monitoringConversationId,
          async (updated) => {
            const saved = await db
              .update(sourceConnections)
              .set({
                tokenCiphertext: vault.seal(
                  updated,
                  `gmail:${context.connection!.accountId}`,
                ),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(sourceConnections.id, context.connection!.id),
                  eq(sourceConnections.userId, job.userId),
                  eq(sourceConnections.status, 'CONNECTED'),
                ),
              )
              .returning({ id: sourceConnections.id });
            if (!saved.length) throw new AgentError('GMAIL_AUTH');
          },
          signal,
        );
        if (
          conversation.some(
            (event) =>
              event.conversationId !== context.loop.monitoringConversationId,
          )
        )
          throw new AgentError('GMAIL_API');
        const before = new Set(
          context.evidence.map((event) => event.messageId),
        );
        const current = conversation.length
          ? await store.persistConversationEvidence(
              job,
              context.connection.id,
              conversation,
            )
          : context.evidence;
        const newEvidence = current.filter(
          (event) => !before.has(event.messageId),
        );
        if (!newEvidence.length) {
          await loops.agentApply({
            jobId: job.id,
            leaseId,
            generation: job.generation,
            decision: 'STILL_WAITING',
            rationale: 'There is no new message evidence in this conversation.',
            evidenceReferences: [],
            nextCheckAt: new Date(
              now.getTime() + context.loop.monitoringCadenceHours * HOUR,
            ),
            userSummary:
              'No new evidence yet. Loopend will keep an eye on this conversation.',
          });
          return true;
        }
        const evidence = current.map((event) => ({
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
            signal,
          ),
          evidence,
        );
        const requested = evaluation.recommendedNextCheckAt
          ? new Date(evaluation.recommendedNextCheckAt)
          : new Date(
              now.getTime() + context.loop.monitoringCadenceHours * HOUR,
            );
        const conservative = new Date(
          Math.max(now.getTime() + 12 * HOUR, requested.getTime()),
        );
        await loops.agentApply({
          jobId: job.id,
          leaseId,
          generation: job.generation,
          decision: evaluation.decision,
          rationale: evaluation.rationale,
          evidenceReferences: evaluation.evidenceReferences,
          nextCheckAt:
            evaluation.decision === 'STILL_WAITING' ? conservative : null,
          userSummary: evaluation.userSummary,
        });
        return true;
      } catch (error) {
        const safe = safeError(error);
        if (safe.code === 'GMAIL_AUTH') {
          await db
            .update(sourceConnections)
            .set({
              status: 'NEEDS_REAUTH',
              tokenCiphertext: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(
                  sourceConnections.id,
                  (await store.loadContext(job))?.connection?.id ?? '',
                ),
                eq(sourceConnections.userId, job.userId),
              ),
            );
          await loops.agentApply({
            jobId: job.id,
            leaseId,
            generation: job.generation,
            decision: 'NEEDS_USER',
            rationale:
              'Gmail authorization needs to be restored before monitoring can continue.',
            evidenceReferences: [],
            nextCheckAt: null,
            userSummary: 'Reconnect Gmail to continue monitoring this Loop.',
          });
          return true;
        }
        if (job.attempts >= 5)
          await loops.agentApply({
            jobId: job.id,
            leaseId,
            generation: job.generation,
            decision: 'NEEDS_USER',
            rationale:
              'Loopend could not safely complete several monitoring checks.',
            evidenceReferences: [],
            nextCheckAt: null,
            userSummary:
              'Monitoring needs your attention before it can continue.',
          });
        else await store.retry(job, leaseId, safe.code);
        return true;
      }
    },
  };
}
