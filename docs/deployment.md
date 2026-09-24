# Deploying loopend

This release supports Observe/Monitor with human approval and human-only closure. A passing build is not public-launch approval. Google review, real provider credentials, transactional email recovery/verification, published policies, and a real-mailbox smoke test remain external launch requirements.

## Topology and prerequisites

Run two independent processes from the same release: Next.js web behind an HTTPS reverse proxy, and a continuously running Node worker. Both share PostgreSQL 16+. Use maintained Node 24+ and the pinned pnpm version. The worker polls PostgreSQL, claims with row locks, drains active work on SIGTERM, and closes its pool. Allow at least 300 seconds for graceful shutdown. Restart it on nonzero exit. Size connection limits for five connections per process plus release/operations headroom.

Loop Scan requests only enqueue persisted work on the connection. The worker handles scans and monitoring fairly in each pass. Scan execution retains the existing 180-second lease and 120-second network deadline; crashes are reclaimable, bounded to three claims. Expected provider failures finish with a safe error and require an explicit user retry. Monitoring retains its renewable 90-second job leases, 25-second heartbeat, generation fences, and persisted retry limits. Browser refreshes only read progress; they never execute jobs.

Vercel can host the web process, but the worker needs a separate compute target supporting a persistent process and graceful shutdown. Do not substitute route cron or browser timers. No deployment is performed automatically by this repository. No container artifacts are required by this topology. For a Vercel web deployment, installing the CLI with `npm i -g vercel` is strongly recommended for `vercel env pull`, `vercel deploy`, and `vercel logs`; it is not required for other hosts.

## Environment contract

All values are server-only. Never prefix them with `NEXT_PUBLIC_`. Both processes require the integration/database values below; `BETTER_AUTH_SECRET` is web-only and should not be injected into the worker.

| Variable                      | Contract                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                | PostgreSQL URL, runtime role; use TLS according to the database provider. Pooled URLs are supported (`prepare: false`).                    |
| `APP_URL`                     | Exact canonical HTTPS origin, no trailing slash, path, credentials, query or fragment.                                                     |
| `BETTER_AUTH_SECRET`          | Web only. At least 32 characters, varied characters, no known example/test prefix. Generate random bytes; validation cannot prove entropy. |
| `GOOGLE_CLIENT_ID`            | Web application OAuth client ID.                                                                                                           |
| `GOOGLE_CLIENT_SECRET`        | Matching client secret.                                                                                                                    |
| `SOURCE_TOKEN_ENCRYPTION_KEY` | Exactly 32 random bytes encoded as canonical padded base64, independent of auth secret.                                                    |
| `LOOP_SCAN_AI_API_KEY`        | Real provider credential with access to the chosen model.                                                                                  |
| `LOOP_SCAN_AI_BASE_URL`       | HTTPS OpenAI-compatible API root, e.g. `https://ai-gateway.vercel.sh/v1`. No embedded credentials/query.                                   |
| `LOOP_SCAN_AI_MODEL`          | Explicit structured-output-capable model identifier from that provider; no default model.                                                  |

Generate each secret independently with `openssl rand -base64 32`. Store in your host secret manager, not shell history, logs, images or source control. Keep the encryption key stable and backed up separately: replacing it makes old token ciphertext unreadable and requires reconnecting Gmail. Rotating the auth secret invalidates signed sessions.

Release only: `MIGRATION_DATABASE_URL` is a direct schema-owner connection. `db:migrate` falls back to `DATABASE_URL` only if it is absent/empty. Do not give migration credentials to web or worker. `PORT` selects the web port. Production commands enforce `NODE_ENV=production`; `LOOPEND_DEPLOYMENT=production` also enforces the contract for custom launchers.

Local only: `.env.local`, a distinct loopback `TEST_DATABASE_URL` whose database name contains a `test` segment, and optionally `LOOPEND_DEPLOYMENT=local` for running a production build over loopback HTTP. That mode rejects remote app/database hosts and does not bypass authentication. Gmail/AI may be absent for local manual Loops. Run local migrations with `pnpm db:migrate:local`, local worker with `pnpm worker:local`. Tests never use real Gmail/AI and refuse remote databases, production mode, and matching runtime/migration database names.

## Database release

1. Take an encrypted backup and verify restore access. Record the running release, schema version, encryption key version, and backup expiry policy.
2. Stop/drain the old worker and gate writes during this upgrade. Migrations 0000–0010 are unchanged. New 0011 adds OAuth replay state and durable scan dispatch; 0012 adds authenticated account erasure, an expired-job lease index, and schema readiness marker.
3. Install with `pnpm install --frozen-lockfile`; run `pnpm db:migrate` with release credentials. A session advisory lock serializes release migrations. A failure exits nonzero with a safe log. Do not start traffic or workers until it succeeds.
4. Grant the runtime role the permissions below, build with `pnpm build`, roll out web and worker from the same revision, and check readiness. Build does not need live service credentials. The web start command validates configuration before listening; hosted launchers that bypass it must run `pnpm config:check web` as a deployment gate.
5. Run the mailbox checklist below with a dedicated test account before general traffic.

Provision `loopend_runtime` as a login role using your provider's secret tools. The migration role owns the schema, tables and erasure function. Run these grants as that owner, replacing the role name if necessary:

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO loopend_runtime;
GRANT SELECT, INSERT, UPDATE ON
  loops, loop_events, source_connections, external_events, loop_candidates,
  agent_jobs, auth_users, auth_accounts, auth_sessions, auth_verifications,
  auth_rate_limits TO loopend_runtime;
REVOKE UPDATE ON loop_events FROM loopend_runtime;
GRANT DELETE ON auth_sessions, auth_accounts, auth_verifications,
  auth_rate_limits TO loopend_runtime;
GRANT SELECT, INSERT, DELETE ON gmail_oauth_states TO loopend_runtime;
GRANT SELECT ON runtime_schema TO loopend_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO loopend_runtime;
GRANT EXECUTE ON FUNCTION erase_loopend_account(text, text) TO loopend_runtime;
```

Do not grant runtime schema ownership, membership in the migration role, TRUNCATE, trigger changes, or direct event UPDATE/DELETE. Existing ownership indexes cover dashboard/candidate queries; connection/conversation indexes cover evidence; due-job and expired-lease indexes cover claims. Candidate review batches its evidence query rather than fetching per candidate. No unrelated query architecture was replaced.

Migrations are forward-only. On failure, keep traffic gated, inspect safe migration logs and database status, and restore the backup or ship a reviewed forward fix. Do not remove journal rows or edit applied SQL to force success. A code rollback must be compatible with the new schema; the pre-0011 web can still perform scans in requests, so do not resume it alongside the new scan worker. After any restore, reapply recorded account erasures before traffic: restoring a backup must not resurrect deleted private data or sessions.

## Process commands and health

```sh
pnpm config:check web
pnpm config:check worker
pnpm db:migrate
pnpm build
pnpm start
# Separate long-running process, same release/environment:
pnpm worker
# Bounded operator drain, up to eight scan/monitor passes:
pnpm worker:once
pnpm diagnostics
```

`GET /api/health/live` returns only `{ "status": "alive" }`. `GET /api/health/ready` validates configuration, database access, schema version 12, required columns, and enabled integrity triggers; it returns 200/ready or 503/unavailable, with no exception details and no caching. Database connection/statement deadlines bound outages. It does not contact Google/AI, and readiness does not prove those services or the worker are healthy. The worker performs the same schema check before claims and exits nonzero on setup/database failure. Supervise its process; alert on repeated restarts, failed jobs and overdue work. Delayed checks/scans have calm UI feedback.

`pnpm smoke:local` creates and removes a disposable loopback database, validates both process configurations, runs fresh/repeat migrations, starts the production web server, checks health, and drains an empty worker queue without contacting Google or AI. It requires a prior `pnpm build` and local CREATEDB permission. The release test additionally needs CREATEROLE for its restricted-runtime check; these privileges belong only to local test operators, never production runtime.

`pnpm diagnostics` prints only configuration/database readiness and aggregate connection/queue counts. Structured application logs contain event names, safe error codes, short job IDs, attempt counts and durations. Never collect email content, credentials, model prompts or provider response bodies. Disable SQL parameter logging and redact auth bodies, cookies and OAuth callback query strings at the proxy, database, tracing and hosting layers. Application logging cannot redact infrastructure logs for you.

## Authentication and transport

Better Auth uses database sessions, HttpOnly cookies, SameSite=Lax, Secure cookies in production, one trusted canonical origin, persistent rate limiting, and session revocation on logout. Social providers/linking and development auth bypasses are absent. The proxy must overwrite trusted forwarded IP headers and prevent direct backend access so rate limits cannot be spoofed. Set HSTS at the TLS proxy after validating HTTPS (include subdomains only if all are HTTPS). Preserve CSP, frame denial, nosniff, referrer and permissions headers.

CSP uses a fresh script nonce per request and no production `unsafe-eval`. Pages render dynamically and must not be cached across users/nonces. Inline styles are allowed for existing GSAP/Three/layout styling. OAuth form navigation allows only the app and Google's consent origin. No third-party script permissions were added.

Email is currently an unverified login identifier. Sign-in and form errors are generic; signup success versus duplicate rejection can still reveal registration while immediate email/password signup is enabled. Complete verification delivery and reassess enumeration before public launch. Password reset and email verification delivery remain disabled: no fake mailer or recovery link is shown. Before public launch, integrate a real transactional provider with Better Auth's `emailAndPassword.sendResetPassword` and `emailVerification.sendVerificationEmail`, configure domain delivery/authentication, expiry/rate limits and enumeration-safe responses, and test actual delivery and recovery. Until then, restrict testing to informed operators who understand there is no self-service password recovery.

## Gmail and AI setup

Create a Google Cloud project, enable Gmail API, configure OAuth consent branding/audience and test users, then create a Web application OAuth client. Register exactly `https://YOUR_ORIGIN/api/gmail/callback`. Use that same origin in the browser. Only `https://www.googleapis.com/auth/gmail.readonly` is requested. Consent uses PKCE S256, random state encrypted in an HttpOnly cookie, a ten-minute expiry, and a single-use database hash bound to both initiating user and session. Token rotation is encrypted with AES-256-GCM and fenced before storage. Disconnect commits local erasure even when Google revocation fails. A reservation cannot be reassigned after disconnect.

Gmail readonly is a restricted scope. External production distribution may require Google verification and a security assessment, depending on use and data handling. Configure required privacy policy/terms and authorized domains; verify domain ownership where Google requests it. Testing-mode grants commonly expire after seven days for these scopes. Confirm current requirements in Google's console and official documentation before launch; approval is not automatic:

- [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)

The AI contract is POST `BASE_URL/chat/completions` with bearer auth, `messages`, `model`, `response_format.type=json_schema` (strict draft-7 schema), and `max_tokens` (8000 scan, 1600 monitoring). Response must contain a choice with `finish_reason=stop`, no refusal, and JSON text in `message.content`. Responses are bounded to 1 MB; calls time out after 75 seconds and honor parent cancellation. Schemas, evidence membership and date grounding are independently checked. Email is untrusted evidence with no tools or authority to create/close Loops. Invalid/refused/truncated output creates no Loops. Check provider retention/training policies and Google data-use compatibility before sending private excerpts. No real-provider success is implied by mocked tests.

## Account erasure

Settings requires a live authenticated session and exact `DELETE` confirmation. A narrowly scoped SECURITY DEFINER function checks the session token/owner, locks that owner, removes jobs, erases local tokens, candidates, private immutable history, Loops, excerpts, connections, OAuth states and auth records/sessions in one transaction. Ordinary event mutation remains forbidden even if runtime sets the erasure flag itself. Stale workers cannot renew/apply after deletion. Google revocation is attempted after commit; failure leaves no local tokens and directs the user to Google permissions.

Full deletion releases the mailbox reservation because no saved evidence/decisions remain to take over; disconnect alone never releases it. No private operational tombstone is retained in the active database. Backups are not rewritten by the UI: publish a bounded encrypted backup retention period, restrict restore access, and maintain an external erasure ledger for restore reconciliation without retaining email content. Set those operational policies before real-user testing.

## Real-mailbox smoke checklist

Use a dedicated mailbox with harmless test correspondence, informed consent, real Google credentials and a real chosen AI provider. Automated tests must remain mocked.

1. Confirm config/readiness and worker supervision. Sign up at `/sign-up`, sign out, sign in again, and verify a second account cannot open the first account's Loop links.
2. Connect Gmail from Loop Scan. Inspect Google's consent: readonly only. Test denied consent and retry. Confirm Settings shows the connection without exposing tokens.
3. Put a harmless explicit outstanding promise in a recent conversation. Start one scan (at most 50 messages/30 days). Verify the request returns promptly; run `pnpm worker:once` if the continuous worker is stopped. Review the resulting suggestion and its bounded source excerpts.
4. Accept one suggestion. Confirm exactly one OPEN Loop and source provenance; repeat navigation does not duplicate it. Enable monitoring with a first check due now (expected dates may postpone it).
5. Add a harmless new reply to that same conversation, run `pnpm worker:once`, and inspect the observation. No mailbox-wide background scan should occur. Possible success stops at VERIFYING; closure still requires explicit human evidence and confirmation.
6. Inspect evidence using the app and, only if necessary, owner-scoped database counts/lengths. Uncited observed excerpts are minimized after the decision; accepted provenance and cited evidence remain bounded. Never dump bodies, addresses or tokens into terminal logs.
7. Check Gmail Sent/Trash and the original conversation: no message was sent, deleted, labelled or modified. Inspect safe job logs/counts, not payloads. Pause monitoring and confirm further checks stop.
8. Disconnect, confirm local tokens are erased, and test reconnect. For the disposable Loopend account, delete it in Settings and confirm all devices lose access and owned evidence/jobs are gone. If revocation is unconfirmed, remove access in Google permissions.

Before public launch: complete transactional email/recovery, Google review as applicable, policy/domain setup, AI privacy review, backups/restore/erasure procedures, TLS/proxy hardening and the real credential smoke test. These are deployment obligations, not completed by repository tests.
