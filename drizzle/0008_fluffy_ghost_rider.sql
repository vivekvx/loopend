CREATE TYPE "public"."agent_job_status" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."monitoring_mode" AS ENUM('OBSERVE_ONLY');--> statement-breakpoint
CREATE TYPE "public"."monitoring_source" AS ENUM('MANUAL', 'GMAIL_CONVERSATION');--> statement-breakpoint
CREATE TABLE "agent_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"loop_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"kind" text DEFAULT 'OBSERVE_GMAIL_CONVERSATION' NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "agent_job_status" DEFAULT 'PENDING' NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"result_applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "monitoring_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "monitoring_source" "monitoring_source" DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "monitoring_mode" "monitoring_mode" DEFAULT 'OBSERVE_ONLY' NOT NULL;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "monitoring_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "monitoring_conversation_id" text;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "monitoring_cadence_hours" integer DEFAULT 72 NOT NULL;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "monitoring_next_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "monitoring_last_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "monitoring_last_observation" text;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "monitoring_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_loop_id_loops_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."loops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_job_loop_owner_fk" FOREIGN KEY ("loop_id","user_id") REFERENCES "public"."loops"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loops" ADD CONSTRAINT "loops_monitoring_connection_owner_fk" FOREIGN KEY ("monitoring_connection_id","user_id") REFERENCES "public"."source_connections"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_jobs_due_idx" ON "agent_jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "agent_jobs_owner_loop_idx" ON "agent_jobs" USING btree ("user_id","loop_id");
