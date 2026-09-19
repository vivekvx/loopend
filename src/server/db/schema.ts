import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  date,
  integer,
  jsonb,
  bigint,
  index,
  check,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';
export * from './auth-schema';
import { statuses } from '../../domain/loops';
import { candidateStatuses } from '../../domain/scan';

export const loopStatus = pgEnum('loop_status', statuses);
export const loops = pgTable(
  'loops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    desiredOutcome: text('desired_outcome').notNull(),
    status: loopStatus('status').notNull().default('OPEN'),
    waitingOn: text('waiting_on').notNull().default(''),
    expectedBy: date('expected_by'),
    nextAction: text('next_action').notNull().default(''),
    verificationCondition: text('verification_condition').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('loops_id_owner_unique').on(t.id, t.userId),
    index('loops_owner_status_updated_idx').on(t.userId, t.status, t.updatedAt),
    index('loops_status_updated_idx').on(t.status, t.updatedAt),
    check(
      'closed_timestamp_matches_state',
      sql`(${t.status} = 'CLOSED') = (${t.closedAt} IS NOT NULL)`,
    ),
  ],
);

export const loopEvents = pgTable(
  'loop_events',
  {
    sequence: bigint('sequence', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    id: uuid('id').notNull().defaultRandom().unique(),
    loopId: uuid('loop_id')
      .notNull()
      .references(() => loops.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    source: text('source').notNull().default('manual'),
    actor: text('actor').notNull().default('user'),
    body: text('body').notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('loop_events_loop_sequence_idx').on(t.loopId, t.sequence)],
);
export type Loop = typeof loops.$inferSelect;
export type LoopEvent = typeof loopEvents.$inferSelect;

export const accessLimits = pgTable('access_limits', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
});

export const connectionStatus = pgEnum('source_connection_status', [
  'CONNECTED',
  'NEEDS_REAUTH',
  'DISCONNECTED',
]);
export const candidateStatus = pgEnum(
  'loop_candidate_status',
  candidateStatuses,
);
export const sourceConnections = pgTable(
  'source_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    provider: text('provider').notNull(),
    accountId: text('account_id').notNull(),
    accountEmail: text('account_email').notNull(),
    status: connectionStatus('status').notNull().default('CONNECTED'),
    tokenCiphertext: text('token_ciphertext'),
    metadata: jsonb('metadata')
      .$type<{ scopes: string[] }>()
      .notNull()
      .default({ scopes: [] }),
    connectedAt: timestamp('connected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    lastScanAt: timestamp('last_scan_at', { withTimezone: true }),
    lastScanCount: integer('last_scan_count').notNull().default(0),
    lastScanError: text('last_scan_error'),
    scanLeaseId: uuid('scan_lease_id'),
    scanLeaseUntil: timestamp('scan_lease_until', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('source_id_owner_unique').on(t.id, t.userId),
    index('source_owner_idx').on(t.userId),
    uniqueIndex('source_provider_account_unique').on(t.provider, t.accountId),
  ],
);

export const externalEvents = pgTable(
  'external_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => sourceConnections.id),
    provider: text('provider').notNull(),
    messageId: text('message_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    sender: text('sender').notNull(),
    subject: text('subject').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    content: text('content').notNull(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    metadata: jsonb('metadata')
      .$type<{
        direction: 'incoming' | 'outgoing';
        possibleDates: { date: string; text: string }[];
      }>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'external_connection_owner_fk',
      columns: [t.connectionId, t.userId],
      foreignColumns: [sourceConnections.id, sourceConnections.userId],
    }),
    uniqueIndex('external_id_owner_connection_unique').on(
      t.id,
      t.userId,
      t.connectionId,
    ),
    index('external_connection_conversation_idx').on(
      t.connectionId,
      t.conversationId,
    ),
  ],
);

export const loopCandidates = pgTable(
  'loop_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => sourceConnections.id),
    conversationId: text('conversation_id').notNull(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    desiredOutcome: text('desired_outcome').notNull(),
    waitingOn: text('waiting_on').notNull(),
    expectedBy: date('expected_by'),
    nextAction: text('next_action'),
    verificationCondition: text('verification_condition').notNull(),
    confidence: text('confidence').$type<'MEDIUM' | 'HIGH'>().notNull(),
    reason: text('reason').notNull(),
    status: candidateStatus('status').notNull().default('PENDING'),
    dismissalReason: text('dismissal_reason').$type<'USER' | 'SCAN'>(),
    sourceReferences: uuid('source_references').array().notNull(),
    loopId: uuid('loop_id').references(() => loops.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'candidate_connection_owner_fk',
      columns: [t.connectionId, t.userId],
      foreignColumns: [sourceConnections.id, sourceConnections.userId],
    }),
    foreignKey({
      name: 'candidate_loop_owner_fk',
      columns: [t.loopId, t.userId],
      foreignColumns: [loops.id, loops.userId],
    }),
    index('candidate_owner_status_created_idx').on(
      t.userId,
      t.status,
      t.createdAt,
    ),
    index('candidate_status_created_idx').on(t.status, t.createdAt),
    check(
      'accepted_candidate_has_loop',
      sql`(${t.status} IN ('ACCEPTED', 'MERGED')) = (${t.loopId} IS NOT NULL)`,
    ),
    check(
      'candidate_review_confidence',
      sql`${t.confidence} IN ('MEDIUM', 'HIGH')`,
    ),
  ],
);
export type SourceConnection = typeof sourceConnections.$inferSelect;
export type ExternalEvent = typeof externalEvents.$inferSelect;
export type LoopCandidate = typeof loopCandidates.$inferSelect;
