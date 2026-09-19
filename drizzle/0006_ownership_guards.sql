-- Custom SQL migration file, put your code below! --
-- Quarantine is a data owner, never an authentication principal.
ALTER TABLE auth_accounts ADD CONSTRAINT no_legacy_credentials CHECK (user_id <> '00000000-0000-0000-0000-000000000000');
--> statement-breakpoint
ALTER TABLE auth_sessions ADD CONSTRAINT no_legacy_sessions CHECK (user_id <> '00000000-0000-0000-0000-000000000000');
--> statement-breakpoint
CREATE FUNCTION guard_data_owner() RETURNS trigger AS $$
BEGIN
  IF OLD.user_id <> NEW.user_id AND OLD.user_id <> '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION 'Data ownership cannot be reassigned.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER loops_owner_immutable BEFORE UPDATE OF user_id ON loops FOR EACH ROW EXECUTE FUNCTION guard_data_owner();
--> statement-breakpoint
CREATE TRIGGER sources_owner_immutable BEFORE UPDATE OF user_id ON source_connections FOR EACH ROW EXECUTE FUNCTION guard_data_owner();
--> statement-breakpoint
CREATE TRIGGER external_owner_immutable BEFORE UPDATE OF user_id ON external_events FOR EACH ROW EXECUTE FUNCTION guard_data_owner();
--> statement-breakpoint
CREATE TRIGGER candidates_owner_immutable BEFORE UPDATE OF user_id ON loop_candidates FOR EACH ROW EXECUTE FUNCTION guard_data_owner();
--> statement-breakpoint
CREATE FUNCTION guard_candidate_evidence() RETURNS trigger AS $$
DECLARE candidate loop_candidates;
BEGIN
  SELECT * INTO candidate FROM loop_candidates WHERE id = NEW.id;
  IF cardinality(candidate.source_references) < 1 OR EXISTS (
    SELECT 1 FROM unnest(candidate.source_references) AS source_id
    WHERE NOT EXISTS (SELECT 1 FROM external_events e WHERE e.id = source_id AND e.user_id = candidate.user_id AND e.connection_id = candidate.connection_id)
  ) THEN RAISE EXCEPTION 'Candidate evidence must belong to its owner and connection.'; END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER candidate_evidence_owner AFTER INSERT OR UPDATE ON loop_candidates DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_candidate_evidence();
--> statement-breakpoint
CREATE FUNCTION guard_external_identity() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM loop_candidates WHERE OLD.id = ANY(source_references)) THEN
      RAISE EXCEPTION 'Referenced evidence cannot be deleted.';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.id <> NEW.id OR OLD.connection_id <> NEW.connection_id THEN
    RAISE EXCEPTION 'Evidence identity cannot be reassigned.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER external_identity_immutable BEFORE UPDATE OR DELETE ON external_events FOR EACH ROW EXECUTE FUNCTION guard_external_identity();
