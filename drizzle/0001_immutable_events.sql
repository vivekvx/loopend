-- Custom SQL migration file, put your code below! --
CREATE FUNCTION reject_loop_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Loop events are immutable; append a new event instead.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER loop_events_immutable
BEFORE UPDATE OR DELETE ON loop_events
FOR EACH ROW EXECUTE FUNCTION reject_loop_event_mutation();
