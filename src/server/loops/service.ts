import { and, asc, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
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
  MonitoringConflictError,
  monitoringInput,
  statusLabels,
} from '../../domain/loops';
import {
  DEFAULT_AGENT_MAX_ATTEMPTS,
  agentMaxAttempts,
  type AgentDecision,
} from '../../domain/agent';
import { userFacingCopy } from '../../lib/user-copy';

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
  async function lockedForMonitoring(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    id: string,
    monitoringGeneration: number,
  ) {
    const [loop] = await tx.select().from(loops).where(owned(id)).for('update');
    if (!loop) throw new DomainError('This Loop could not be found.');
    if (loop.monitoringGeneration !== monitoringGeneration)
      throw new MonitoringConflictError('Monitoring configuration is stale.');
    return loop;
  }
  async function cancelActiveMonitoringJobs(
    tx: LoopTransaction,
    loopId: string,
    now: Date,
    exceptJobId?: string,
  ) {
    await tx
      .update(schema.agentJobs)
      .set({ status: 'CANCELLED', updatedAt: now })
      .where(
        and(
          eq(schema.agentJobs.loopId, loopId),
          eq(schema.agentJobs.userId, userId),
          inArray(schema.agentJobs.status, ['PENDING', 'RUNNING']),
          exceptJobId ? ne(schema.agentJobs.id, exceptJobId) : undefined,
        ),
      );
  }
  async function minimizeConversationEvidence(
    tx: LoopTransaction,
    loop: schema.Loop,
  ) {
    if (!loop.monitoringConnectionId || !loop.monitoringConversationId) return;
    const candidates = await tx
      .select({ refs: schema.loopCandidates.sourceReferences })
      .from(schema.loopCandidates)
      .where(
        and(
          eq(schema.loopCandidates.userId, userId),
          eq(schema.loopCandidates.loopId, loop.id),
          inArray(schema.loopCandidates.status, ['ACCEPTED', 'MERGED']),
        ),
      );
    const history = await tx
      .select({ payload: loopEvents.payload })
      .from(loopEvents)
      .where(eq(loopEvents.loopId, loop.id));
    const retainedEvidence = [
      ...new Set([
        ...candidates.flatMap((candidate) => candidate.refs),
        ...history.flatMap(({ payload }) => {
          const refs = payload.evidenceReferences;
          return Array.isArray(refs)
            ? refs.filter((value): value is string => typeof value === 'string')
            : [];
        }),
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
          eq(schema.externalEvents.userId, userId),
          eq(schema.externalEvents.connectionId, loop.monitoringConnectionId),
          eq(
            schema.externalEvents.conversationId,
            loop.monitoringConversationId,
          ),
          retainedEvidence.length
            ? notInArray(schema.externalEvents.id, retainedEvidence)
            : undefined,
        ),
      );
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
        const now = new Date();
        const stopMonitoring =
          input.status === 'VERIFYING' && previous.monitoringEnabled;
        if (stopMonitoring) await cancelActiveMonitoringJobs(tx, id, now);
        const [loop] = await tx
          .update(loops)
          .set({
            ...input,
            expectedBy: input.expectedBy || null,
            ...(stopMonitoring
              ? {
                  monitoringEnabled: false,
                  monitoringNextCheckAt: null,
                  monitoringGeneration: previous.monitoringGeneration + 1,
                }
              : {}),
            version: previous.version + 1,
            updatedAt: now,
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
        if (loop.monitoringEnabled)
          await cancelActiveMonitoringJobs(tx, id, now);
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
            ...(loop.monitoringEnabled
              ? {
                  monitoringEnabled: false,
                  monitoringNextCheckAt: null,
                  monitoringGeneration: loop.monitoringGeneration + 1,
                }
              : {}),
            version: loop.version + 1,
          })
          .where(owned(id));
      });
    },
    async configureMonitoring(
      id: string,
      monitoringGeneration: number,
      raw: unknown,
    ) {
      const input = monitoringInput.parse(raw);
      return db.transaction(async (tx) => {
        const loop = await lockedForMonitoring(tx, id, monitoringGeneration);
        assertEditable(loop.status);
        const generation = loop.monitoringGeneration + 1;
        const now = new Date();
        if (!input.enabled) {
          await cancelActiveMonitoringJobs(tx, id, now);
          await minimizeConversationEvidence(tx, loop);
          const [updated] = await tx
            .update(loops)
            .set({
              monitoringEnabled: false,
              monitoringNextCheckAt: null,
              monitoringGeneration: generation,
              updatedAt: now,
              version: loop.version + 1,
            })
            .where(owned(id))
            .returning();
          await tx.insert(loopEvents).values({
            loopId: id,
            type: 'monitoring.paused',
            source: 'agent',
            actor: 'user',
            body: 'Monitoring paused. Loopend will not check this Loop again until you resume it.',
          });
          return updated;
        }
        if (loop.status === 'VERIFYING')
          throw new DomainError(
            'Finish reviewing this outcome before resuming monitoring.',
          );
        const source =
          loop.monitoringSource === 'GMAIL_CONVERSATION' &&
          loop.monitoringConnectionId &&
          loop.monitoringConversationId
            ? {
                connectionId: loop.monitoringConnectionId,
                conversationId: loop.monitoringConversationId,
              }
            : await tx
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
                )
                .then(([candidate]) => candidate);
        if (!source)
          throw new DomainError(
            'Monitoring is available for Loops you chose to track from Gmail.',
          );
        const [connection] = await tx
          .select({ id: schema.sourceConnections.id })
          .from(schema.sourceConnections)
          .where(
            and(
              eq(schema.sourceConnections.id, source.connectionId),
              eq(schema.sourceConnections.userId, userId),
              eq(schema.sourceConnections.status, 'CONNECTED'),
            ),
          );
        if (!connection)
          throw new DomainError('Reconnect Gmail before enabling monitoring.');
        const requested = input.nextCheckAt
          ? new Date(input.nextCheckAt).getTime()
          : null;
        if (requested !== null && requested <= now.getTime())
          throw new DomainError('Choose a future time for the next check.');
        const afterExpected =
          requested === null && loop.expectedBy
            ? new Date(`${loop.expectedBy}T12:00:00.000Z`).getTime() +
              24 * 60 * 60 * 1000
            : 0;
        const earliest =
          requested === null
            ? now.getTime() + 12 * 60 * 60 * 1000
            : now.getTime();
        const next = new Date(
          Math.max(
            earliest,
            requested ?? now.getTime() + input.cadenceHours * 60 * 60 * 1000,
            afterExpected,
          ),
        );
        const nextStatus = loop.status === 'OPEN' ? 'WAITING' : loop.status;
        if (
          loop.monitoringEnabled &&
          loop.monitoringCadenceHours === input.cadenceHours &&
          loop.monitoringNextCheckAt?.getTime() === next.getTime()
        )
          return loop;
        await cancelActiveMonitoringJobs(tx, id, now);
        await minimizeConversationEvidence(tx, loop);
        const [updated] = await tx
          .update(loops)
          .set({
            status: nextStatus,
            monitoringEnabled: true,
            monitoringSource: 'GMAIL_CONVERSATION',
            monitoringMode: 'OBSERVE_ONLY',
            monitoringConnectionId: source.connectionId,
            monitoringConversationId: source.conversationId,
            monitoringCadenceHours: input.cadenceHours,
            monitoringNextCheckAt: next,
            monitoringGeneration: generation,
            updatedAt: now,
            version: loop.version + 1,
          })
          .where(owned(id))
          .returning();
        await tx.insert(loopEvents).values({
          loopId: id,
          type: loop.monitoringEnabled
            ? 'monitoring.rescheduled'
            : 'monitoring.enabled',
          source: 'agent',
          actor: 'user',
          body: loop.monitoringEnabled
            ? 'Monitoring schedule updated.'
            : 'Monitoring enabled. First check scheduled.',
          payload: {
            source: 'GMAIL_CONVERSATION',
            mode: 'OBSERVE_ONLY',
            nextCheckAt: next.toISOString(),
          },
        });
        await tx.insert(schema.agentJobs).values({
          userId,
          loopId: id,
          generation,
          maxAttempts: agentMaxAttempts.parse(DEFAULT_AGENT_MAX_ATTEMPTS),
          idempotencyKey: `${id}:${generation}:${next.toISOString()}`,
          runAt: next,
        });
        return updated;
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
        const body = userFacingCopy(input.userSummary ?? input.rationale);
        const type =
          input.decision === 'POSSIBLE_SUCCESS'
            ? 'agent.possible_outcome_detected'
            : input.decision === 'NEEDS_USER' || input.decision === 'UNKNOWN'
              ? 'agent.needs_user'
              : input.evidenceReferences.length
                ? 'agent.progress_observed'
                : 'agent.observed';
        if (input.evidenceReferences.length) {
          const sources = await tx
            .select({ id: schema.externalEvents.id })
            .from(schema.externalEvents)
            .where(
              and(
                eq(schema.externalEvents.userId, userId),
                eq(
                  schema.externalEvents.connectionId,
                  loop.monitoringConnectionId!,
                ),
                eq(
                  schema.externalEvents.conversationId,
                  loop.monitoringConversationId!,
                ),
                inArray(schema.externalEvents.id, input.evidenceReferences),
              ),
            );
          if (sources.length !== new Set(input.evidenceReferences).size)
            return false;
        }
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
        const stopMonitoring = target !== 'WAITING';
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
              maxAttempts: agentMaxAttempts.parse(DEFAULT_AGENT_MAX_ATTEMPTS),
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
              body: 'Still waiting. Loopend will check again.',
              payload: { nextCheckAt: scheduled.toISOString() },
            });
        }
        await minimizeConversationEvidence(tx, loop);
        if (stopMonitoring)
          await cancelActiveMonitoringJobs(tx, loop.id, now, job.id);
        await tx
          .update(loops)
          .set({
            status: target,
            monitoringNextCheckAt: scheduled,
            monitoringLastCheckAt: now,
            monitoringLastObservation: body,
            ...(stopMonitoring
              ? {
                  monitoringEnabled: false,
                  monitoringGeneration: loop.monitoringGeneration + 1,
                }
              : {}),
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
