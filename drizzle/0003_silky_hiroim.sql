CREATE TYPE "public"."loop_candidate_status" AS ENUM('PENDING', 'ACCEPTED', 'DISMISSED', 'MERGED');--> statement-breakpoint
CREATE TYPE "public"."source_connection_status" AS ENUM('CONNECTED', 'NEEDS_REAUTH', 'DISCONNECTED');--> statement-breakpoint
CREATE TABLE "external_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"message_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"sender" text NOT NULL,
	"subject" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"content" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "loop_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"conversation_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"desired_outcome" text NOT NULL,
	"waiting_on" text NOT NULL,
	"expected_by" date,
	"next_action" text,
	"verification_condition" text NOT NULL,
	"confidence" text NOT NULL,
	"reason" text NOT NULL,
	"status" "loop_candidate_status" DEFAULT 'PENDING' NOT NULL,
	"source_references" uuid[] NOT NULL,
	"loop_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loop_candidates_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "accepted_candidate_has_loop" CHECK (("loop_candidates"."status" IN ('ACCEPTED', 'MERGED')) = ("loop_candidates"."loop_id" IS NOT NULL)),
	CONSTRAINT "candidate_review_confidence" CHECK ("loop_candidates"."confidence" IN ('MEDIUM', 'HIGH'))
);
--> statement-breakpoint
CREATE TABLE "source_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"account_id" text NOT NULL,
	"account_email" text NOT NULL,
	"status" "source_connection_status" DEFAULT 'CONNECTED' NOT NULL,
	"token_ciphertext" text,
	"metadata" jsonb DEFAULT '{"scopes":[]}'::jsonb NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"last_scan_at" timestamp with time zone,
	"last_scan_count" integer DEFAULT 0 NOT NULL,
	"last_scan_error" text,
	"scan_lease_id" uuid,
	"scan_lease_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_connection_id_source_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."source_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_candidates" ADD CONSTRAINT "loop_candidates_connection_id_source_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."source_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_candidates" ADD CONSTRAINT "loop_candidates_loop_id_loops_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."loops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_connection_conversation_idx" ON "external_events" USING btree ("connection_id","conversation_id");--> statement-breakpoint
CREATE INDEX "candidate_status_created_idx" ON "loop_candidates" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_provider_account_unique" ON "source_connections" USING btree ("provider","account_id");