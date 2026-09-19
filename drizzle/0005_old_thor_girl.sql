CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO auth_users (id, name, email) VALUES ('00000000-0000-0000-0000-000000000000', 'Quarantined legacy data — no login', 'legacy-quarantine@loopend.invalid');
--> statement-breakpoint
ALTER TABLE "external_events" ADD COLUMN "user_id" text DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "loop_candidates" ADD COLUMN "user_id" text DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "user_id" text DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_connections" ADD COLUMN "user_id" text DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_provider_account_unique" ON "auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_email_lower_unique" ON "auth_users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "loops_id_owner_unique" ON "loops" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_id_owner_unique" ON "source_connections" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_events" ADD CONSTRAINT "external_connection_owner_fk" FOREIGN KEY ("connection_id","user_id") REFERENCES "public"."source_connections"("id","user_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "loop_candidates" ADD CONSTRAINT "loop_candidates_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_candidates" ADD CONSTRAINT "candidate_connection_owner_fk" FOREIGN KEY ("connection_id","user_id") REFERENCES "public"."source_connections"("id","user_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "loop_candidates" ADD CONSTRAINT "candidate_loop_owner_fk" FOREIGN KEY ("loop_id","user_id") REFERENCES "public"."loops"("id","user_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "loops" ADD CONSTRAINT "loops_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_connections" ADD CONSTRAINT "source_connections_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_id_owner_connection_unique" ON "external_events" USING btree ("id","user_id","connection_id");--> statement-breakpoint
CREATE INDEX "candidate_owner_status_created_idx" ON "loop_candidates" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "loops_owner_status_updated_idx" ON "loops" USING btree ("user_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "source_owner_idx" ON "source_connections" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "loops" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "source_connections" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "external_events" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "loop_candidates" ALTER COLUMN "user_id" DROP DEFAULT;
