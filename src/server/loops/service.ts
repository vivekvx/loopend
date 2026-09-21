import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { assertUserId } from '../../domain/ownership';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import {
  activityInput,
  assertCompletable,
  assertEditable,
  completionInput,
  DomainError,
  loopInput,
  monitoringInput,
  statusLabels,
} from '../../domain/loops';
import { type AgentDecision } from '../../domain/agent';

export type LoopDatabase = PostgresJsDatabase<typeof schema>;
export type LoopTransaction = Parameters<
  Parameters<LoopDatabase['transaction']>[0]
>[0];
export function loopService(
  db: LoopDatabase | LoopTransaction,
  userId: string,
) {
  assertUserId(userId);
  const { loops, loopEvents } = schema;
  const owned = (id: string) => and(eq(loops.id, id), eq(loops.userId, userId));
  async function locked(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    id: string,
    version: number,
  ) {
    const [loop] = await tx.select().from(loops).where(owned(id)).for('update');
    if (!loop) throw new DomainError('This Loop could not be found.');
    if (loop.version !== version)
      throw new DomainError(
        'This Loop changed in another window. Refresh the page and try again.',
      );
    return loop;
  }
  return {
    async list() {
      return db
        .select()
        .from(loops)
        .where(eq(loops.userId, userId))
        .orderBy(desc(loops.updatedAt), desc(loops.id));
    },
    async active() {
      return db
        .select()
        .from(loops)
        .where(and(eq(loops.userId, userId), ne(loops.status, 'CLOSED')))
        .orderBy(desc(loops.updatedAt));
    },
    async get(id: string) {
      const [loop] = await db.select().from(loops).where(owned(id));
      if (!loop) return null;
      const events = await db
        .select()
        .from(loopEvents)
        .where(eq(loopEvents.loopId, id))
        .orderBy(asc(loopEvents.sequence));
      const references = [
        ...new Set(
          events.flatMap((event) => {
            const refs = event.payload.evidenceReferences;
            return Array.isArray(refs)
              ? refs.filter(
                  (value): value is string => typeof value === 'string',
                )
              : [];
          }),
        ),
      ];
      const evidence = references.length
        ? await db
            .select({
              id: schema.externalEvents.id,
              sender: schema.externalEvents.sender,
              subject: schema.externalEvents.subject,
              content: schema.externalEvents.content,
              occurredAt: schema.externalEvents.occurredAt,
            })
            .from(schema.externalEvents)
            .where(
              and(
                eq(schema.externalEvents.userId, userId),
                inArray(schema.externalEvents.id, references),
              ),
            )
        : [];
      return { loop, events, evidence };
    },
    async create(
      raw: unknown,
      provenance?: { candidateId: string; sourceReferences: string[] },
    ) {
      const input = loopInput.parse(raw);
      return db.transaction(async (tx) => {
        let source:
          { connectionId: string; conversationId: string } | undefined;
        if (provenance) {
          const [candidate] = await tx
            .select()
            .from(schema.loopCandidates)
            .where(
              and(
                eq(schema.loopCandidates.id, provenance.candidateId),
                eq(schema.loopCandidates.userId, userId),
              ),
            );
          if (
            !candidate ||
            candidate.status !== 'PENDING' ||
            candidate.sourceReferences.length !==
              provenance.sourceReferences.length ||
            !candidate.sourceReferences.every((id) =>
              provenance.sourceReferences.includes(id),
            )
          )
            throw new DomainError('This source suggestion is not available.');
          source = {
            connectionId: candidate.connectionId,
            conversationId: candidate.conversationId,
          };
        }
        const [loop] = await tx
          .insert(loops)
          .values({
            ...input,
            userId,
            expectedBy: input.expectedBy || null,
            ...(source
              ? {
                  monitoringSource: 'GMAIL_CONVERSATION' as const,
                  monitoringConnectionId: source.connectionId,
                  monitoringConversationId: source.conversationId,
                }
              : {}),
          })
          .returning();
        await tx.insert(loopEvents).values({
          loopId: loop.id,
          type: 'loop.created',
          body: 'Loop opened. An outcome worth staying on.',
          payload: { snapshot: input },
        });
        if (provenance)
          await tx.insert(loopEvents).values({
            loopId: loop.id,
            type: 'source.accepted',
            source: 'gmail',
            body: 'You reviewed a Loop Scan suggestion from Gmail and chose to track it.',
            payload: provenance,
          });
        return loop;
      });
    },
    async update(id: string, version: number, raw: unknown) {
      const input = loopInput.parse(raw);
      return db.transaction(async (tx) => {
        const previous = await locked(tx, id, version);
        assertEditable(previous.status);
        const [loop] = await tx
          .update(loops)
          .set({
            ...input,
            expectedBy: input.expectedBy || null,
            version: version + 1,
            updatedAt: new Date(),
          })
          .where(owned(id))
          .returning();
        await tx.insert(loopEvents).values({
          loopId: id,
          type:
            previous.status === input.status
              ? 'loop.updated'
              : 'loop.state_changed',
          body:
            previous.status === input.status
              ? 'Loop details updated.'
              : `State changed from ${statusLabels[previous.status]} to ${statusLabels[input.status]}.`,
          payload: { before: previous, after: loop },
        });
        return loop;
      });
    },
    async addActivity(id: string, version: number, raw: unknown) {
      const body = activityInput.parse(raw);
      return db.transaction(async (tx) => {
        const loop = await locked(tx, id, version);
        assertEditable(loop.status);
        await tx
          .insert(loopEvents)
          .values({ loopId: id, type: 'activity.noted', body });
        await tx
          .update(loops)
          .set({ version: version + 1, updatedAt: new Date() })
          .where(owned(id));
      });
    },
    async complete(id: string, version: number, raw: unknown) {
      const input = completionInput.parse(raw);
      return db.transaction(async (tx) => {
        const loop = await locked(tx, id, version);
        assertCompletable(loop.status);
        const now = new Date();
        await tx.insert(loopEvents).values({
          loopId: id,
          type: 'outcome.verified',
          body: input.evidence,
          payload: {
            verificationCondition: loop.verificationCondition,
            confirmed: true,
          },
        });
        await tx.insert(loopEvents).values({
          loopId: id,
          type: 'loop.closed',
          body: 'Outcome verified. Loop closed.',
        });
        await tx
          .update(loops)
          .set({
            status: 'CLOSED',
            closedAt: now,
            updatedAt: now,
            version: version + 1,
          })
          .where(owned(id));
      });
    },
    async configureMonitoring(id: string, version: number, raw: unknown) {
      const input = monitoringInput.parse(raw);
      return db.transaction(async (tx) => {
        const loop = await locked(tx, id, version);
        assertEditable(loop.status);
        const generation = loop.monitoringGeneration + 1;
        const now = new Date();
        await tx
          .update(schema.agentJobs)
          .set({ status: 'CANCELLED', updatedAt: now })
          .where(
            and(
              eq(schema.agentJobs.loopId, id),
              eq(schema.agentJobs.userId, userId),
              inArray(schema.agentJobs.status, ['PENDING', 'RUNNING']),
            ),
          );
        if (!input.enabled) {
          await tx
            .update(loops)
            .set({
              monitoringEnabled: false,
              monitoringNextCheckAt: null,
              monitoringGeneration: generation,
              updatedAt: now,
              version: version + 1,
            })
            .where(owned(id));
          await tx.insert(loopEvents).values({
            loopId: id,
            type: 'agent.monitoring_disabled',
            source: 'agent',
            actor: 'user',
            body: 'Monitoring paused. Loopend will not check this Loop again until you resume it.',
          });
          return;
        }
        if (loop.status === 'VERIFYING')
          throw new DomainError(
            'Finish reviewing this outcome before resuming monitoring.',
          );
        const [candidate] = await tx
          .select({
            connectionId: schema.loopCandidates.connectionId,
            conversationId: schema.loopCandidates.conversationId,
          })
          .from(schema.loopCandidates)
          .where(
            and(
              eq(schema.loopCandidates.loopId, id),
              eq(schema.loopCandidates.userId, userId),
              eq(schema.loopCandidates.status, 'ACCEPTED'),
            ),
          );
        if (!candidate)
          throw new DomainError(
            'Monitoring is available for Loops you chose to track from Gmail.',
          );
        const [connection] = await tx
          .select({ id: schema.sourceConnections.id })
          .from(schema.sourceConnections)
          .where(
            and(
              eq(schema.sourceConnections.id, candidate.connectionId),
              eq(schema.sourceConnections.userId, userId),
              eq(schema.sourceConnections.status, 'CONNECTED'),
            ),
          );
        if (!connection)
          throw new DomainError('Reconnect Gmail before enabling monitoring.');
        const afterExpected = loop.expectedBy
          ? new Date(`${loop.expectedBy}T12:00:00.000Z`).getTime() +
            24 * 60 * 60 * 1000
          : 0;
        const requested = input.nextCheckAt
          ? new Date(input.nextCheckAt).getTime()
          : now.getTime() + input.cadenceHours * 60 * 60 * 1000;
        const next = new Date(
          Math.max(
            now.getTime() + 12 * 60 * 60 * 1000,
            requested,
            afterExpected,
          ),
        );
        const nextStatus = loop.status === 'OPEN' ? 'WAITING' : loop.status;
        await tx
          .update(loops)
          .set({
            status: nextStatus,
            monitoringEnabled: true,
            monitoringSource: 'GMAIL_CONVERSATION',
            monitoringMode: 'OBSERVE_ONLY',
            monitoringConnectionId: candidate.connectionId,
            monitoringConversationId: candidate.conversationId,
            monitoringCadenceHours: input.cadenceHours,
            monitoringNextCheckAt: next,
            monitoringGeneration: generation,
            updatedAt: now,
            version: version + 1,
          })
          .where(owned(id));
        await tx.insert(loopEvents).values({
          loopId: id,
          type: 'agent.monitoring_enabled',
          source: 'agent',
          actor: 'user',
          body: 'Loopend will quietly watch this Gmail conversation for evidence of the outcome.',
          payload: { source: 'GMAIL_CONVERSATION', mode: 'OBSERVE_ONLY' },
        });
        await tx.insert(schema.agentJobs).values({
          userId,
          loopId: id,
          generation,
          idempotencyKey: `${id}:${generation}:${next.toISOString()}`,
          runAt: next,
        });
        await tx.insert(loopEvents).values({
          loopId: id,
          type: 'agent.check_scheduled',
          source: 'agent',
          actor: 'user',
          body: `Next check scheduled for ${next.toLocaleString('en', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC.`,
          payload: { nextCheckAt: next.toISOString() },
        });
      });
    },
    async agentBegin(id: string, generation: number) {
      return db.transaction(async (tx) => {
        const [loop] = await tx
          .select()
          .from(loops)
          .where(owned(id))
          .for('update');
        if (
          !loop ||
          !loop.monitoringEnabled ||
          loop.monitoringGeneration !== generation ||
          !['WAITING', 'AGENT_WORKING'].includes(loop.status)
        )
          return null;
        return loop;
      });
    },
    async agentApply(input: {
      jobId: string;
      leaseId: string;
      generation: number;
      decision: AgentDecision;
      rationale: string;
      evidenceReferences: string[];
      nextCheckAt: Date | null;
      userSummary: string | null;
    }) {
      return db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(schema.agentJobs)
          .where(
            and(
              eq(schema.agentJobs.id, input.jobId),
              eq(schema.agentJobs.userId, userId),
            ),
          )
          .for('update');
        if (
          !job ||
          job.status !== 'RUNNING' ||
          job.leaseId !== input.leaseId ||
          job.resultAppliedAt
        )
          return false;
        const [loop] = await tx
          .select()
          .from(loops)
          .where(owned(job.loopId))
          .for('update');
        if (
          !loop ||
          !loop.monitoringEnabled ||
          loop.monitoringGeneration !== input.generation ||
          !['WAITING', 'AGENT_WORKING'].includes(loop.status)
        ) {
          await tx
            .update(schema.agentJobs)
            .set({
              status: 'CANCELLED',
              leaseId: null,
              leaseUntil: null,
              resultAppliedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(schema.agentJobs.id, job.id));
          return false;
        }
        const now = new Date();
        const target =
          input.decision === 'POSSIBLE_SUCCESS'
            ? 'VERIFYING'
            : input.decision === 'STILL_WAITING'
              ? 'WAITING'
              : 'NEEDS_USER';
        const body = input.userSummary ?? input.rationale;
        const type =
          input.decision === 'POSSIBLE_SUCCESS'
            ? 'agent.possible_outcome_detected'
            : input.decision === 'NEEDS_USER' || input.decision === 'UNKNOWN'
              ? 'agent.needs_user'
              : 'agent.observed';
        await tx.insert(loopEvents).values({
          loopId: loop.id,
          type,
          source: 'agent',
          actor: 'Loopend',
          body,
          payload: {
            decision: input.decision,
            rationale: input.rationale,
            evidenceReferences: input.evidenceReferences,
          },
        });
        let scheduled: Date | null = null;
        if (target === 'WAITING') {
          scheduled =
            input.nextCheckAt ??
            new Date(now.getTime() + loop.monitoringCadenceHours * 3_600_000);
          const [newJob] = await tx
            .insert(schema.agentJobs)
            .values({
              userId,
              loopId: loop.id,
              generation: loop.monitoringGeneration,
              idempotencyKey: `${loop.id}:${loop.monitoringGeneration}:${scheduled.toISOString()}`,
              runAt: scheduled,
            })
            .onConflictDoNothing({ target: schema.agentJobs.idempotencyKey })
            .returning({ id: schema.agentJobs.id });
          if (newJob)
            await tx.insert(loopEvents).values({
              loopId: loop.id,
              type: 'agent.rescheduled',
              source: 'agent',
              actor: 'Loopend',
              body: `Still waiting. Loopend will check again ${scheduled.toLocaleDateString('en', { timeZone: 'UTC', month: 'short', day: 'numeric' })}.`,
              payload: { nextCheckAt: scheduled.toISOString() },
            });
        }
        await tx
          .update(loops)
          .set({
            status: target,
            monitoringNextCheckAt: scheduled,
            monitoringLastCheckAt: now,
            monitoringLastObservation: body,
            version: loop.version + 1,
            updatedAt: now,
          })
          .where(owned(loop.id));
        await tx
          .update(schema.agentJobs)
          .set({
            status: 'COMPLETED',
            leaseId: null,
            leaseUntil: null,
            resultAppliedAt: now,
            updatedAt: now,
          })
          .where(eq(schema.agentJobs.id, job.id));
        return true;
      });
    },
  };
}
