import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, lt, notInArray, or, sql } from 'drizzle-orm';
import { AGENT_CONTEXT_MESSAGES, agentMaxAttempts } from '../../domain/agent';
import type { LoopDatabase } from '../loops/service';
import * as schema from '../db/schema';
import type { AgentJob } from '../db/schema';
import type { NormalizedEmail } from '../integrations/gmail/normalize';
import { sourceKey } from '../scan/store';

export const AGENT_LEASE_MS = 90_000;
export const AGENT_HEARTBEAT_MS = 25_000;

export function agentStore(
  db: LoopDatabase,
  options: { leaseMs?: number } = {},
) {
  const leaseMs = options.leaseMs ?? AGENT_LEASE_MS;
  if (!Number.isFinite(leaseMs) || leaseMs < 30)
    throw new Error('Agent lease duration is invalid.');
  const ownedLease = (jobId: string, userId: string, leaseId: string) =>
    and(
      eq(schema.agentJobs.id, jobId),
      eq(schema.agentJobs.userId, userId),
      eq(schema.agentJobs.status, 'RUNNING'),
      eq(schema.agentJobs.leaseId, leaseId),
    );
  const hasLease = async (jobId: string, userId: string, leaseId: string) => {
    const [job] = await db
      .select({ id: schema.agentJobs.id })
      .from(schema.agentJobs)
      .where(ownedLease(jobId, userId, leaseId));
    return !!job;
  };

  return {
    async claimDue() {
      return db.transaction(async (tx) => {
        const now = new Date();
        const [job] = await tx
          .select()
          .from(schema.agentJobs)
          .where(
            and(
              inArray(schema.agentJobs.status, ['PENDING', 'RUNNING']),
              or(
                and(
                  eq(schema.agentJobs.status, 'PENDING'),
                  lt(schema.agentJobs.runAt, now),
                ),
                and(
                  eq(schema.agentJobs.status, 'RUNNING'),
                  lt(schema.agentJobs.leaseUntil, now),
                ),
              ),
            ),
          )
          .orderBy(schema.agentJobs.runAt)
          .limit(1)
          .for('update', { skipLocked: true });
        if (!job) return null;
        agentMaxAttempts.parse(job.maxAttempts);
        const leaseId = randomUUID();
        const [claimed] = await tx
          .update(schema.agentJobs)
          .set({
            status: 'RUNNING',
            leaseId,
            leaseUntil: new Date(now.getTime() + leaseMs),
            attempts: job.attempts + 1,
            updatedAt: now,
          })
          .where(eq(schema.agentJobs.id, job.id))
          .returning();
        return claimed ? { job: claimed, leaseId } : null;
      });
    },
    async renewLease(jobId: string, userId: string, leaseId: string) {
      const [renewed] = await db
        .update(schema.agentJobs)
        .set({
          leaseUntil: new Date(Date.now() + leaseMs),
          updatedAt: new Date(),
        })
        .where(ownedLease(jobId, userId, leaseId))
        .returning({ id: schema.agentJobs.id });
      return !!renewed;
    },
    async ownsLease(jobId: string, userId: string, leaseId: string) {
      return hasLease(jobId, userId, leaseId);
    },
    async updateConnectionTokens(
      job: AgentJob,
      leaseId: string,
      connectionId: string,
      tokenCiphertext: string,
    ) {
      return db.transaction(async (tx) => {
        const [lease] = await tx
          .select({ id: schema.agentJobs.id })
          .from(schema.agentJobs)
          .where(ownedLease(job.id, job.userId, leaseId))
          .for('update');
        if (!lease) return false;
        const [saved] = await tx
          .update(schema.sourceConnections)
          .set({ tokenCiphertext, updatedAt: new Date() })
          .where(
            and(
              eq(schema.sourceConnections.id, connectionId),
              eq(schema.sourceConnections.userId, job.userId),
              eq(schema.sourceConnections.status, 'CONNECTED'),
            ),
          )
          .returning({ id: schema.sourceConnections.id });
        return !!saved;
      });
    },
    async markConnectionNeedsReauth(
      job: AgentJob,
      leaseId: string,
      connectionId: string,
    ) {
      return db.transaction(async (tx) => {
        const [lease] = await tx
          .select({ id: schema.agentJobs.id })
          .from(schema.agentJobs)
          .where(ownedLease(job.id, job.userId, leaseId))
          .for('update');
        if (!lease) return false;
        const [saved] = await tx
          .update(schema.sourceConnections)
          .set({
            status: 'NEEDS_REAUTH',
            tokenCiphertext: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.sourceConnections.id, connectionId),
              eq(schema.sourceConnections.userId, job.userId),
            ),
          )
          .returning({ id: schema.sourceConnections.id });
        return !!saved;
      });
    },
    async loadContext(job: AgentJob) {
      const [loop] = await db
        .select()
        .from(schema.loops)
        .where(
          and(
            eq(schema.loops.id, job.loopId),
            eq(schema.loops.userId, job.userId),
          ),
        );
      if (!loop) return null;
      const connection = loop.monitoringConnectionId
        ? (
            await db
              .select()
              .from(schema.sourceConnections)
              .where(
                and(
                  eq(schema.sourceConnections.id, loop.monitoringConnectionId),
                  eq(schema.sourceConnections.userId, job.userId),
                ),
              )
          )[0]
        : null;
      const evidence =
        loop.monitoringConnectionId && loop.monitoringConversationId
          ? await db
              .select()
              .from(schema.externalEvents)
              .where(
                and(
                  eq(schema.externalEvents.userId, job.userId),
                  eq(
                    schema.externalEvents.connectionId,
                    loop.monitoringConnectionId,
                  ),
                  eq(
                    schema.externalEvents.conversationId,
                    loop.monitoringConversationId,
                  ),
                ),
              )
          : [];
      return { loop, connection, evidence };
    },
    async persistConversationEvidence(
      job: AgentJob,
      leaseId: string,
      connectionId: string,
      events: NormalizedEmail[],
    ) {
      return db.transaction(async (tx) => {
        const [lease] = await tx
          .select({ id: schema.agentJobs.id })
          .from(schema.agentJobs)
          .where(ownedLease(job.id, job.userId, leaseId))
          .for('update');
        if (!lease) return null;

        const dedupeKeys = events.map((event) =>
          sourceKey(connectionId, event.messageId),
        );
        const existing = dedupeKeys.length
          ? await tx
              .select({
                id: schema.externalEvents.id,
                messageId: schema.externalEvents.messageId,
                dedupeKey: schema.externalEvents.dedupeKey,
              })
              .from(schema.externalEvents)
              .where(
                and(
                  eq(schema.externalEvents.userId, job.userId),
                  eq(schema.externalEvents.connectionId, connectionId),
                  inArray(schema.externalEvents.dedupeKey, dedupeKeys),
                ),
              )
          : [];
        const seen = new Set(existing.map((event) => event.messageId));
        for (const event of events) {
          await tx
            .insert(schema.externalEvents)
            .values({
              userId: job.userId,
              connectionId,
              provider: 'gmail',
              messageId: event.messageId,
              conversationId: event.conversationId,
              sender: '',
              subject: '',
              occurredAt: event.occurredAt,
              content: '',
              dedupeKey: sourceKey(connectionId, event.messageId),
              metadata: {
                direction: event.metadata.direction,
                possibleDates: [],
              },
            })
            .onConflictDoNothing({ target: schema.externalEvents.dedupeKey });
        }

        const active = [...events]
          .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
          .slice(0, AGENT_CONTEXT_MESSAGES);
        for (const event of active) {
          await tx
            .update(schema.externalEvents)
            .set({
              sender: event.sender,
              subject: event.subject,
              content: event.content,
              metadata: event.metadata,
            })
            .where(
              and(
                eq(
                  schema.externalEvents.dedupeKey,
                  sourceKey(connectionId, event.messageId),
                ),
                eq(schema.externalEvents.userId, job.userId),
                eq(schema.externalEvents.connectionId, connectionId),
              ),
            );
        }

        const candidates = await tx
          .select({ refs: schema.loopCandidates.sourceReferences })
          .from(schema.loopCandidates)
          .where(
            and(
              eq(schema.loopCandidates.userId, job.userId),
              eq(schema.loopCandidates.loopId, job.loopId),
              inArray(schema.loopCandidates.status, ['ACCEPTED', 'MERGED']),
            ),
          );
        const baselineIds = candidates.flatMap((candidate) => candidate.refs);
        const history = await tx
          .select({ payload: schema.loopEvents.payload })
          .from(schema.loopEvents)
          .where(eq(schema.loopEvents.loopId, job.loopId));
        const citedIds = history.flatMap(({ payload }) => {
          const refs = payload.evidenceReferences;
          return Array.isArray(refs)
            ? refs.filter((value): value is string => typeof value === 'string')
            : [];
        });
        const activeKeys = active.map((event) =>
          sourceKey(connectionId, event.messageId),
        );
        const context = await tx
          .select()
          .from(schema.externalEvents)
          .where(
            and(
              eq(schema.externalEvents.userId, job.userId),
              eq(schema.externalEvents.connectionId, connectionId),
              or(
                activeKeys.length
                  ? inArray(schema.externalEvents.dedupeKey, activeKeys)
                  : undefined,
                baselineIds.length
                  ? inArray(schema.externalEvents.id, baselineIds)
                  : undefined,
              ),
            ),
          )
          .orderBy(desc(schema.externalEvents.occurredAt));
        const keepIds = [
          ...new Set([
            ...baselineIds,
            ...citedIds,
            ...context.map((event) => event.id),
          ]),
        ];
        await tx
          .update(schema.externalEvents)
          .set({
            content: '',
            subject: '',
            sender: '',
            metadata: sql`jsonb_build_object('direction', ${schema.externalEvents.metadata}->>'direction', 'possibleDates', '[]'::jsonb)`,
          })
          .where(
            and(
              eq(schema.externalEvents.userId, job.userId),
              eq(schema.externalEvents.connectionId, connectionId),
              eq(
                schema.externalEvents.conversationId,
                events[0].conversationId,
              ),
              keepIds.length
                ? notInArray(schema.externalEvents.id, keepIds)
                : undefined,
            ),
          );
        return {
          evidence: context.filter((event) => event.content.length > 0),
          newMessageIds: new Set(
            events
              .filter((event) => !seen.has(event.messageId))
              .map((event) => event.messageId),
          ),
        };
      });
    },
    async finishNoop(
      jobId: string,
      userId: string,
      leaseId: string,
      cancel = false,
    ) {
      const [finished] = await db
        .update(schema.agentJobs)
        .set({
          status: cancel ? 'CANCELLED' : 'COMPLETED',
          leaseId: null,
          leaseUntil: null,
          resultAppliedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(ownedLease(jobId, userId, leaseId))
        .returning({ id: schema.agentJobs.id });
      return !!finished;
    },
    async retry(job: AgentJob, leaseId: string, code: string) {
      const maxAttempts = agentMaxAttempts.parse(job.maxAttempts);
      if (job.attempts >= maxAttempts)
        return {
          exhausted: await hasLease(job.id, job.userId, leaseId),
          retried: false,
        };
      const delay = Math.min(
        60 * 60_000,
        30_000 * 2 ** Math.max(0, job.attempts - 1),
      );
      const [retried] = await db
        .update(schema.agentJobs)
        .set({
          status: 'PENDING',
          leaseId: null,
          leaseUntil: null,
          runAt: new Date(Date.now() + delay),
          lastError: code,
          updatedAt: new Date(),
        })
        .where(ownedLease(job.id, job.userId, leaseId))
        .returning({ id: schema.agentJobs.id });
      return { exhausted: false, retried: !!retried };
    },
  };
}
