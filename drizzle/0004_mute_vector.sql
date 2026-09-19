ALTER TABLE "loop_candidates" ADD COLUMN "dismissal_reason" text;
--> statement-breakpoint
UPDATE "loop_candidates" SET "dismissal_reason" = 'USER' WHERE "status" = 'DISMISSED';
