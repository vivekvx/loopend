import { createHash, randomUUID } from 'node:crypto';
import {
  and,
  desc,
  eq,
  inArray,
  notInArray,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import {
  ScanError,
  type DetectionCandidate,
  type DetectionEvent,
} from '../../domain/scan';
import { loopService, type LoopDatabase } from '../loops/service';
import {
  sourceConnections,
  externalEvents,
  loopCandidates,
} from '../db/schema';
import type { NormalizedEmail } from '../integrations/gmail/normalize';

export const sourceKey = (connectionId: string, value: string) =>
  createHash('sha256').update(`gmail:${connectionId}:${value}`).digest('hex');
export type PreparedScan = {
  events: (NormalizedEmail & {
    id: string;
    dedupeKey: string;
    connectionId: string;
    provider: string;
  })[];
  detectionEvents: DetectionEvent[];
};
export function scanStore(db: LoopDatabase) {
  return {
    async review() {
      const connections = await db
        .select({
          id: sourceConnections.id,
          accountEmail: sourceConnections.accountEmail,
          status: sourceConnections.status,
          lastScanAt: sourceConnections.lastScanAt,
          lastScanCount: sourceConnections.lastScanCount,
          lastScanError: sourceConnections.lastScanError,
          scanLeaseUntil: sourceConnections.scanLeaseUntil,
        })
        .from(sourceConnections)
        .orderBy(desc(sourceConnections.connectedAt));
      const candidates = await db
        .select()
        .from(loopCandidates)
        .where(eq(loopCandidates.status, 'PENDING'))
        .orderBy(desc(loopCandidates.createdAt));
      const references = [
        ...new Set(
          candidates.flatMap((candidate) => candidate.sourceReferences),
        ),
      ];
      const evidence = references.length
        ? await db
            .select({
              id: externalEvents.id,
              sender: externalEvents.sender,
              subject: externalEvents.subject,
              content: externalEvents.content,
              occurredAt: externalEvents.occurredAt,
              conversationId: externalEvents.conversationId,
            })
            .from(externalEvents)
            .where(inArray(externalEvents.id, references))
        : [];
      return { connections, candidates, evidence };
    },
    async acquire(connectionId: string) {
      const now = new Date();
      const lease = randomUUID();
      const [connection] = await db
        .update(sourceConnections)
        .set({
          scanLeaseId: lease,
          scanLeaseUntil: new Date(now.getTime() + 180_000),
          lastScanError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(sourceConnections.id, connectionId),
            eq(sourceConnections.status, 'CONNECTED'),
            or(
              isNull(sourceConnections.scanLeaseUntil),
              lt(sourceConnections.scanLeaseUntil, now),
            ),
            or(
              isNull(sourceConnections.lastScanAt),
              lt(
                sourceConnections.lastScanAt,
                new Date(now.getTime() - 30_000),
              ),
            ),
          ),
        )
        .returning();
      if (!connection) {
        const [existing] = await db
          .select({ status: sourceConnections.status })
          .from(sourceConnections)
          .where(eq(sourceConnections.id, connectionId));
        throw new ScanError(
          existing?.status === 'CONNECTED' ? 'BUSY' : 'DISCONNECTED',
        );
      }
      return { connection, lease };
    },
    async prepare(
      connectionId: string,
      normalized: NormalizedEmail[],
    ): Promise<PreparedScan> {
      const keys = normalized.map((event) =>
        sourceKey(connectionId, event.messageId),
      );
      const existing = keys.length
        ? await db
            .select({
              id: externalEvents.id,
              dedupeKey: externalEvents.dedupeKey,
            })
            .from(externalEvents)
            .where(inArray(externalEvents.dedupeKey, keys))
        : [];
      const byKey = new Map(
        existing.map((event) => [event.dedupeKey, event.id]),
      );
      const events = normalized.map((event) => ({
        ...event,
        id: byKey.get(sourceKey(connectionId, event.messageId)) ?? randomUUID(),
        dedupeKey: sourceKey(connectionId, event.messageId),
        connectionId,
        provider: 'gmail',
      }));
      const decided = await db
        .select({ conversationId: loopCandidates.conversationId })
        .from(loopCandidates)
        .where(
          and(
            eq(loopCandidates.connectionId, connectionId),
            or(
              inArray(loopCandidates.status, ['ACCEPTED', 'MERGED']),
              and(
                eq(loopCandidates.status, 'DISMISSED'),
                eq(loopCandidates.dismissalReason, 'USER'),
              ),
            ),
          ),
        );
      const excluded = new Set(
        decided.map((candidate) => candidate.conversationId),
      );
      const detectionEvents: DetectionEvent[] = events
        .filter((event) => !excluded.has(event.conversationId))
        .map((event) => ({
          id: event.id,
          conversationId: sourceKey(connectionId, event.conversationId),
          sender: event.sender,
          subject: event.subject,
          occurredAt: event.occurredAt.toISOString(),
          content: event.content,
          direction: event.metadata.direction,
          possibleDates: event.metadata.possibleDates,
        }));
      return { events, detectionEvents };
    },
    async persist(
      connectionId: string,
      lease: string,
      prepared: PreparedScan,
      candidates: DetectionCandidate[],
      fetched: number,
    ) {
      return db.transaction(async (tx) => {
        const [connection] = await tx
          .select()
          .from(sourceConnections)
          .where(eq(sourceConnections.id, connectionId))
          .for('update');
        if (
          !connection ||
          connection.status !== 'CONNECTED' ||
          connection.scanLeaseId !== lease ||
          !connection.scanLeaseUntil ||
          connection.scanLeaseUntil < new Date()
        )
          throw new ScanError('DISCONNECTED');
        const cited = new Set(
          candidates.flatMap((candidate) => candidate.sourceReferences),
        );
        for (const event of prepared.events) {
          // Only candidate evidence retains an excerpt. Other events keep dedupe/trace identifiers only.
          const retained = cited.has(event.id);
          await tx
            .insert(externalEvents)
            .values({
              ...event,
              content: retained ? event.content : '',
              subject: retained ? event.subject : '',
              sender: retained ? event.sender : '',
              metadata: retained
                ? event.metadata
                : { direction: event.metadata.direction, possibleDates: [] },
            })
            .onConflictDoNothing({ target: externalEvents.dedupeKey });
          if (retained)
            await tx
              .update(externalEvents)
              .set({
                content: event.content,
                subject: event.subject,
                sender: event.sender,
                metadata: event.metadata,
              })
              .where(eq(externalEvents.id, event.id));
        }
        let added = 0;
        const detectedConversations: string[] = [];
        for (const candidate of candidates) {
          if (candidate.confidence === 'LOW') continue;
          const evidence = prepared.events.filter((event) =>
            candidate.sourceReferences.includes(event.id),
          );
          if (
            evidence.length !== candidate.sourceReferences.length ||
            new Set(evidence.map((event) => event.conversationId)).size !== 1
          )
            throw new ScanError('AI_OUTPUT');
          const conversationId = evidence[0].conversationId;
          detectedConversations.push(conversationId);
          const dedupeKey = sourceKey(
            connectionId,
            `conversation:${conversationId}`,
          );
          const inserted = await tx
            .insert(loopCandidates)
            .values({
              ...candidate,
              confidence: candidate.confidence,
              connectionId,
              conversationId,
              dedupeKey,
            })
            .onConflictDoNothing({ target: loopCandidates.dedupeKey })
            .returning({ id: loopCandidates.id });
          added += inserted.length;
          if (!inserted.length)
            await tx
              .update(loopCandidates)
              .set({
                ...candidate,
                confidence: candidate.confidence,
                status: 'PENDING',
                dismissalReason: null,
                version: sql`${loopCandidates.version} + 1`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(loopCandidates.dedupeKey, dedupeKey),
                  or(
                    eq(loopCandidates.status, 'PENDING'),
                    and(
                      eq(loopCandidates.status, 'DISMISSED'),
                      eq(loopCandidates.dismissalReason, 'SCAN'),
                    ),
                  ),
                ),
              );
          // Updates lock the candidate row; accepted/ignored decisions always win.
        }
        const evaluated = new Set(
          prepared.detectionEvents.map((event) => event.id),
        );
        const evaluatedConversations = [
          ...new Set(
            prepared.events
              .filter((event) => evaluated.has(event.id))
              .map((event) => event.conversationId),
          ),
        ];
        if (evaluatedConversations.length)
          await tx
            .update(loopCandidates)
            .set({
              status: 'DISMISSED',
              dismissalReason: 'SCAN',
              version: sql`${loopCandidates.version} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(loopCandidates.connectionId, connectionId),
                eq(loopCandidates.status, 'PENDING'),
                inArray(loopCandidates.conversationId, evaluatedConversations),
                detectedConversations.length
                  ? notInArray(
                      loopCandidates.conversationId,
                      detectedConversations,
                    )
                  : undefined,
              ),
            );
        // A refreshed candidate may cite different evidence. Do not retain orphaned excerpts.
        await tx
          .update(externalEvents)
          .set({
            content: '',
            subject: '',
            sender: '',
            metadata: sql`jsonb_build_object('direction', ${externalEvents.metadata}->>'direction', 'possibleDates', '[]'::jsonb)`,
          })
          .where(
            and(
              eq(externalEvents.connectionId, connectionId),
              sql`NOT EXISTS (SELECT 1 FROM ${loopCandidates} WHERE ${externalEvents.id} = ANY(${loopCandidates.sourceReferences}))`,
            ),
          );
        await tx
          .update(sourceConnections)
          .set({
            scanLeaseId: null,
            scanLeaseUntil: null,
            lastScanAt: new Date(),
            lastScanCount: fetched,
            lastScanError: null,
            updatedAt: new Date(),
          })
          .where(eq(sourceConnections.id, connectionId));
        return added;
      });
    },
    async fail(connectionId: string, lease: string, code: ScanError['code']) {
      await db
        .update(sourceConnections)
        .set({
          scanLeaseId: null,
          scanLeaseUntil: null,
          lastScanError: code,
          updatedAt: new Date(),
          ...(code === 'GMAIL_AUTH'
            ? { status: 'NEEDS_REAUTH' as const, tokenCiphertext: null }
            : {}),
        })
        .where(
          and(
            eq(sourceConnections.id, connectionId),
            eq(sourceConnections.scanLeaseId, lease),
          ),
        );
    },
    async accept(id: string, version: number) {
      return db.transaction(async (tx) => {
        const [candidate] = await tx
          .select()
          .from(loopCandidates)
          .where(eq(loopCandidates.id, id))
          .for('update');
        if (!candidate) throw new ScanError('STALE');
        if (candidate.status === 'ACCEPTED' && candidate.loopId)
          return candidate.loopId;
        if (candidate.status !== 'PENDING' || candidate.version !== version)
          throw new ScanError('STALE');
        const sources = await tx
          .select({ id: externalEvents.id })
          .from(externalEvents)
          .where(
            and(
              eq(externalEvents.connectionId, candidate.connectionId),
              inArray(externalEvents.id, candidate.sourceReferences),
            ),
          );
        if (
          !sources.length ||
          sources.length !== candidate.sourceReferences.length
        )
          throw new ScanError('STALE');
        const loop = await loopService(tx).create(
          {
            title: candidate.title,
            summary: candidate.summary,
            desiredOutcome: candidate.desiredOutcome,
            waitingOn: candidate.waitingOn,
            expectedBy: candidate.expectedBy ?? '',
            nextAction: candidate.nextAction ?? '',
            verificationCondition: candidate.verificationCondition,
            status: 'OPEN',
          },
          {
            candidateId: candidate.id,
            sourceReferences: candidate.sourceReferences,
          },
        );
        await tx
          .update(loopCandidates)
          .set({
            status: 'ACCEPTED',
            loopId: loop.id,
            version: version + 1,
            updatedAt: new Date(),
          })
          .where(eq(loopCandidates.id, id));
        return loop.id;
      });
    },
    async dismiss(id: string, version: number) {
      await db.transaction(async (tx) => {
        const [candidate] = await tx
          .select()
          .from(loopCandidates)
          .where(eq(loopCandidates.id, id))
          .for('update');
        if (
          candidate?.status === 'DISMISSED' &&
          candidate.dismissalReason === 'USER'
        )
          return;
        if (
          !candidate ||
          candidate.status !== 'PENDING' ||
          candidate.version !== version
        )
          throw new ScanError('STALE');
        await tx
          .update(loopCandidates)
          .set({
            status: 'DISMISSED',
            dismissalReason: 'USER',
            version: version + 1,
            updatedAt: new Date(),
          })
          .where(eq(loopCandidates.id, id));
      });
    },
  };
}
