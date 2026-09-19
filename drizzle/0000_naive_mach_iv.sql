CREATE TYPE "public"."loop_status" AS ENUM('OPEN', 'WAITING', 'NEEDS_USER', 'AGENT_WORKING', 'VERIFYING', 'CLOSED');--> statement-breakpoint
CREATE TABLE "loop_events" (
	"sequence" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "loop_events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"loop_id" uuid NOT NULL,
	"type" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"actor" text DEFAULT 'user' NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loop_events_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "loops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"desired_outcome" text NOT NULL,
	"status" "loop_status" DEFAULT 'OPEN' NOT NULL,
	"waiting_on" text DEFAULT '' NOT NULL,
	"expected_by" date,
	"next_action" text DEFAULT '' NOT NULL,
	"verification_condition" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "closed_timestamp_matches_state" CHECK (("loops"."status" = 'CLOSED') = ("loops"."closed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "loop_events" ADD CONSTRAINT "loop_events_loop_id_loops_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."loops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loop_events_loop_sequence_idx" ON "loop_events" USING btree ("loop_id","sequence");--> statement-breakpoint
CREATE INDEX "loops_status_updated_idx" ON "loops" USING btree ("status","updated_at");