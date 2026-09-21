import { randomUUID } from 'node:crypto';
import { and, eq, inArray, lt, or } from 'drizzle-orm';
import type { LoopDatabase } from '../loops/service';
import * as schema from '../db/schema';
import type { AgentJob } from '../db/schema';
import type { NormalizedEmail } from '../integrations/gmail/normalize';
import { sourceKey } from '../scan/store';

const LEASE_MS = 90_000;
const MAX_ATTEMPTS = 5;

export function agentStore(db: LoopDatabase) {
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
        const leaseId = randomUUID();
        const [claimed] = await tx
          .update(schema.agentJobs)
          .set({
            status: 'RUNNING',
            leaseId,
            leaseUntil: new Date(now.getTime() + LEASE_MS),
            attempts: job.attempts + 1,
            updatedAt: now,
          })
          .where(eq(schema.agentJobs.id, job.id))
          .returning();
        return claimed ? { job: claimed, leaseId } : null;
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
      connectionId: string,
      events: NormalizedEmail[],
    ) {
      for (const event of events) {
        const dedupeKey = sourceKey(connectionId, event.messageId);
        await db
          .insert(schema.externalEvents)
          .values({
            userId: job.userId,
            connectionId,
            provider: 'gmail',
            messageId: event.messageId,
            conversationId: event.conversationId,
            sender: event.sender,
            subject: event.subject,
            occurredAt: event.occurredAt,
            content: event.content,
            dedupeKey,
            metadata: event.metadata,
          })
          .onConflictDoNothing({ target: schema.externalEvents.dedupeKey });
      }
      return db
        .select()
        .from(schema.externalEvents)
        .where(
          and(
            eq(schema.externalEvents.userId, job.userId),
            eq(schema.externalEvents.connectionId, connectionId),
            eq(
              schema.externalEvents.conversationId,
              events[0]?.conversationId ?? '',
            ),
          ),
        );
    },
    async finishNoop(
      jobId: string,
      userId: string,
      leaseId: string,
      cancel = false,
    ) {
      await db
        .update(schema.agentJobs)
        .set({
          status: cancel ? 'CANCELLED' : 'COMPLETED',
          leaseId: null,
          leaseUntil: null,
          resultAppliedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.agentJobs.id, jobId),
            eq(schema.agentJobs.userId, userId),
            eq(schema.agentJobs.status, 'RUNNING'),
            eq(schema.agentJobs.leaseId, leaseId),
          ),
        );
    },
    async retry(job: AgentJob, leaseId: string, code: string) {
      const exhausted = job.attempts >= MAX_ATTEMPTS;
      const delay = Math.min(
        60 * 60_000,
        30_000 * 2 ** Math.max(0, job.attempts - 1),
      );
      await db
        .update(schema.agentJobs)
        .set({
          status: exhausted ? 'FAILED' : 'PENDING',
          leaseId: null,
          leaseUntil: null,
          runAt: exhausted ? job.runAt : new Date(Date.now() + delay),
          lastError: code,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.agentJobs.id, job.id),
            eq(schema.agentJobs.userId, job.userId),
            eq(schema.agentJobs.status, 'RUNNING'),
            eq(schema.agentJobs.leaseId, leaseId),
          ),
        );
      return exhausted;
    },
  };
}
