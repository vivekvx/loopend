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
} from 'drizzle-orm/pg-core';
import { statuses } from '../../domain/loops';

export const loopStatus = pgEnum('loop_status', statuses);
export const loops = pgTable(
  'loops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
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
