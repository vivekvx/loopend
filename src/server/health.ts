import { sql } from 'drizzle-orm';
import type { LoopDatabase } from './loops/service';
import { readConfig, type Environment } from './config';

export async function checkDatabase(db: LoopDatabase) {
  const rows = await db.execute(
    sql`select version from public.runtime_schema where version = 12`,
  );
  if (rows.length !== 1) throw new Error('SCHEMA');
  await db.execute(sql`select c.scan_requested_at, c.scan_attempts, j.max_attempts, s.hash
    from public.source_connections c, public.agent_jobs j, public.gmail_oauth_states s where false`);
  await db.execute(sql`select u.id, s.id, a.id, v.id, r.id, l.id, e.id, c.id
    from public.auth_users u, public.auth_sessions s, public.auth_accounts a,
    public.auth_verifications v, public.auth_rate_limits r, public.loops l,
    public.loop_events e, public.loop_candidates c where false`);
  const privilege = await db.execute(
    sql`select has_function_privilege(current_user, 'public.erase_loopend_account(text,text)', 'EXECUTE') as allowed`,
  );
  if (!privilege[0]?.allowed) throw new Error('SCHEMA');
  const guards =
    await db.execute(sql`select tgname from pg_trigger where not tgisinternal and tgenabled = 'O'
    and tgrelid in ('public.loop_events'::regclass, 'public.loop_candidates'::regclass, 'public.external_events'::regclass)
    and tgname in ('loop_events_immutable', 'candidate_evidence_owner', 'external_identity_immutable')`);
  if (guards.length !== 3) throw new Error('SCHEMA');
}
export async function readiness(
  check: () => Promise<void>,
  env: Environment = process.env,
) {
  try {
    readConfig('web', env);
    await check();
    return { status: 'ready' as const };
  } catch {
    return { status: 'unavailable' as const };
  }
}
