ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_max_attempts_range" CHECK ("agent_jobs"."max_attempts" BETWEEN 1 AND 10);
