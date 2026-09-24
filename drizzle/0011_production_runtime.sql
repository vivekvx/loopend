CREATE TABLE "gmail_oauth_states" (
	"hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_connections" ADD COLUMN "scan_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_connections" ADD COLUMN "scan_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gmail_oauth_states" ADD CONSTRAINT "gmail_oauth_states_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gmail_oauth_expiry_idx" ON "gmail_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "source_scan_queue_idx" ON "source_connections" USING btree ("scan_requested_at") WHERE "source_connections"."scan_requested_at" IS NOT NULL;