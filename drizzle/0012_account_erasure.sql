-- Erasure is the sole exception to append-only history. Runtime must not own
-- tables/functions, and receives EXECUTE only on the authenticated entry point.
CREATE FUNCTION public.erase_loopend_account(owner_id text, session_token text)
RETURNS TABLE(account_id text, token_ciphertext text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE owner_email text;
BEGIN
  IF owner_id = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION 'Account unavailable';
  END IF;
  SELECT u.email INTO owner_email FROM public.auth_users u WHERE u.id = owner_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.auth_sessions s WHERE s.user_id = owner_id
    AND s.token = session_token AND s.expires_at > now()
  ) THEN RAISE EXCEPTION 'Account unavailable'; END IF;
  DELETE FROM public.agent_jobs WHERE user_id = owner_id;
  PERFORM id FROM public.source_connections WHERE user_id = owner_id FOR UPDATE;
  RETURN QUERY SELECT c.account_id, c.token_ciphertext FROM public.source_connections c WHERE c.user_id = owner_id;
  UPDATE public.source_connections SET token_ciphertext = NULL, status = 'DISCONNECTED',
    scan_lease_id = NULL, scan_lease_until = NULL, scan_requested_at = NULL WHERE user_id = owner_id;
  PERFORM set_config('loopend.erasing_owner', owner_id, true);
  DELETE FROM public.loop_candidates WHERE user_id = owner_id;
  DELETE FROM public.loop_events WHERE loop_id IN (SELECT id FROM public.loops WHERE user_id = owner_id);
  DELETE FROM public.loops WHERE user_id = owner_id;
  DELETE FROM public.external_events WHERE user_id = owner_id;
  DELETE FROM public.source_connections WHERE user_id = owner_id;
  DELETE FROM public.auth_verifications WHERE identifier IN (owner_email, owner_id);
  DELETE FROM public.auth_users WHERE id = owner_id;
  PERFORM set_config('loopend.erasing_owner', '', true);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.erase_loopend_account(text, text) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_loop_event_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_user = (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'public.erase_loopend_account(text,text)'::regprocedure)
    AND EXISTS (SELECT 1 FROM public.loops WHERE id = OLD.loop_id AND user_id = current_setting('loopend.erasing_owner', true))
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Loop events are immutable; append a new event instead.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE INDEX agent_jobs_expired_lease_idx ON public.agent_jobs (lease_until) WHERE status = 'RUNNING';
--> statement-breakpoint
CREATE TABLE public.runtime_schema (version integer PRIMARY KEY);
--> statement-breakpoint
INSERT INTO public.runtime_schema (version) VALUES (12);
