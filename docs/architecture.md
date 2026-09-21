# Architecture

Loopend is a Next.js App Router modular monolith on the Node runtime, with strict TypeScript, Tailwind CSS, PostgreSQL, Drizzle, and Zod. The web app and durable worker are two entry points into the same codebase and database; there is no separate service boundary.

## Boundaries

- `src/domain/loops.ts`: schemas, completion invariants, state labels, attention calculation.
- `src/domain/scan.ts`: provider-neutral detector contract, strict output schema, confidence filtering, source/date grounding, safe errors, scan limits.
- `src/server/integrations`: Gmail OAuth/API adapter, bounded responses, message normalization, token encryption, connection lifecycle.
- `src/server/scan`: configuration, AI adapter, orchestration, candidate persistence/promotion, authenticated actions. Network boundaries are injected for tests and future workers.
- `src/server/db`: lazy pooled PostgreSQL client and Drizzle schema.
- `src/server/loops/service.ts`: commands and queries, independent of React and Next request APIs. It owns user and agent Loop transitions, event history, monitoring policy, and scheduling commands.
- `src/server/agent`: durable-job claim/store, provider-neutral structured evaluator, and worker orchestration. It has no HTTP endpoint.
- `src/server/loops/actions.ts`: authenticated Server Actions, boundary validation, safe user errors, revalidation, redirects.
- `src/server/auth.ts` and `src/server/auth/config.ts`: lazy Better Auth instance and database-validated session boundary; no custom password hashing/session signing.
- `src/app`: server-rendered routes; small form components handle pending and validation states.
- `src/components/marketing`: static first render and optional dynamically imported graphics.

## Persistence and concurrency

`loops` is the current materialized state. `loop_events` is an append-only history with UUID identity, monotonic database sequence, typed event name, source, actor, JSON payload, occurrence time, and recording time. The timeline orders by recording sequence so delayed external events do not silently reorder the audit trail. Occurrence time remains available for future event-specific views.

Commands lock the Loop row with `FOR UPDATE`, compare an optimistic version, validate state invariants, then update the row and append events in one transaction. Stale submissions return a refresh instruction. Simultaneous completion submits produce one verified outcome. Updates capture before/after snapshots in their event payload.

A PostgreSQL trigger rejects event UPDATE and DELETE. A CHECK constraint requires CLOSED and `closed_at` to agree. The service rejects all mutations to closed Loops. The database owner can bypass database protections, so production should use a least-privileged runtime role and a separate migration role. Do not grant the runtime role schema ownership or TRUNCATE.

Versioned migrations are committed in `drizzle/`; `db:migrate` uses Drizzle’s migration journal. `db:generate` emits schema migrations. The immutable-event trigger is a custom migration. `db:seed <user-id>` is explicit, requires an existing account, rejects production mode, and skips that owner’s existing example titles. It never deletes records.

## Authentication and ownership

Better Auth 1.7 provides maintained email/password authentication with its Drizzle PostgreSQL adapter. Library-owned scrypt password hashing, database-backed sessions, cookie signing, CSRF/origin checks, and rate limiting replace APP_PASSWORD and SESSION_SECRET completely. No hosted identity service or second database is required. Authentication has no Google provider and account linking is disabled; Gmail is a separate data authorization flow.

`auth_users`, `auth_accounts`, `auth_sessions`, `auth_verifications`, and `auth_rate_limits` use the library schema. UUID defaults support adapter-generated inserts. Passwords require 12–128 characters. Sessions last seven days, with daily renewal through library interactions. Cookies are HttpOnly, SameSite=Lax, and Secure in production. Cookie caching is disabled: protected server reads validate against the database, so logout immediately invalidates a copied cookie. Successful sign-in/signup and logout use full navigation to discard the previous identity's client route cache.

`requireWorkspace()` returns the authenticated user/session. All request-boundary commands derive the user ID from this result, never FormData/query parameters. `loopService(db, userId)`, `scanStore(db, userId)`, `loopScanService(db, userId, dependencies)`, and connection helpers require an explicit trusted user ID. Queries, locks, updates, lease acquisition/refresh/failure, disconnect, and promotion include owner predicates. Missing and foreign IDs return the same unavailable/not-found responses. There is no development bypass. Server layouts are an additional check, not the data authorization boundary.

Loops, source connections, external events, and candidates have NOT NULL `user_id` foreign keys. Composite foreign keys ensure external events and candidates share their connection's owner, and promoted candidates share their Loop's owner. A deferred evidence trigger enforces every candidate source reference belongs to its owner and connection. Ownership cannot change between real users. External evidence identity cannot be reassigned or deleted while referenced. Immutable timeline events belong transitively to their Loop through its required foreign key; their records are never rewritten to add ownership. Promotion validates source ownership through the existing Loop service and commits exactly once under the candidate lock.

The provider/account unique reservation remains global deliberately: an OAuth callback may reconnect only the same owner's record. Conditional upsert prevents races/takeovers, including after disconnect. This reservation is not a login identity. Gmail's encrypted state includes both initiating `userId` and `sessionId`; the callback validates them before Google calls and rechecks the session before saving. Existing account-bound token encryption remains unchanged.

### Security and deployment

Set a high-entropy `BETTER_AUTH_SECRET` (at least 32 characters) and canonical `APP_URL` in every environment. Generate a secret with `openssl rand -base64 32`; never use test fixtures. HTTPS is required except for local loopback development/tests. Old workspace-password cookies grant no access. Public landing rendering/builds need no auth secret; auth/app requests fail closed without configuration.

Better Auth's database limiter persists across instances: sign-in is capped at 10 attempts/minute, signup at 5/minute, with a general 100/minute limit per request key. Deploy behind a trusted reverse proxy that overwrites forwarded client-IP headers and blocks direct backend access; IP rate limits are not trustworthy if clients can spoof those headers. Apply edge abuse/bot controls for a public launch. The app binds to loopback by default. Error UI is generic and never echoes provider errors/passwords. Auth logger payloads are disabled. Existing application errors likewise avoid sensitive payloads.

Only the configured origin is trusted. App navigation destinations are fixed; Better Auth rejects off-origin callback URLs. Next Server Actions retain their same-origin protection. Configure HTTPS/HSTS at the hosting proxy, preserve the app's anti-framing/nosniff headers, and redact OAuth callback queries and sensitive request bodies from infrastructure logs. Keep migration credentials separate; runtime must not own tables, disable triggers, or run TRUNCATE. Service-scoped authorization is the tenant boundary, with relational constraints as defense in depth; this is not PostgreSQL RLS.

Email verification and password-reset delivery are not configured in this minimum email/password release. Email is a login identifier, never authorization to matching Gmail or legacy data. No social provider/linking or email-based automatic data claiming is enabled. Add verified-email/recovery delivery through the library before offering those capabilities. Authentication records and backups are sensitive even though passwords are hashed and Gmail tokens are encrypted.

### Existing-data migration

Stop the old application/writes, back up PostgreSQL, and run migrations before deploying the new application:

- `0005_old_thor_girl`: adds auth tables and owner columns, backfills existing data to reserved owner `00000000-0000-0000-0000-000000000000`, then removes all owner defaults. Adds indexes and composite owner foreign keys (deferrable for controlled legacy transfer).
- `0006_ownership_guards`: blocks credentials/sessions for quarantine, makes real ownership immutable, validates candidate evidence, and protects referenced source identity.
- `0007_shallow_ikaris`: adds PostgreSQL UUID defaults required by auth adapter inserts.

The reserved owner is a non-login quarantine principal with no password or session. No newly registered user can access its records. IDs, closed states, event history, token ciphertext, candidate decisions, and provenance survive. The old `access_limits` table remains inert; no shared-password path reads it.

After reviewing who actually owns the historical data, create the intended account and run the operator-only command:

```sh
pnpm db:claim-legacy <existing-user-id> --confirm-legacy-transfer
```

This explicitly transfers **all quarantined data** in one transaction, with an advisory lock and deferred owner constraints. It never changes immutable timeline events; their owner follows the parent Loop. It is repeat-safe and refuses unknown target users. It is not exposed to HTTP, and must not be used on a mixed-owner historical dataset. For mixed data, retain quarantine and perform a separately reviewed, record-specific migration. Production transfer requires an operator decision and backup; it never happens automatically. Settings does not expose this operation. To find the intended ID, an operator can query `auth_users` by the known email without reading credential/session tables.

Local development also requires signup. Optional `pnpm db:seed <user-id>` creates examples for that existing account only. No account/password is seeded automatically. A generated secret in the ignored local env file is a development convenience, not committed configuration.

## Graphics

Heading, navigation, CTA, fallback orbit, fragments, and story copy render immediately. A narrow client component checks `prefers-reduced-motion` before importing the graphics chunk. Three.js `WebGPURenderer` initializes WebGPU and automatically uses its built-in WebGL2 backend if WebGPU is unavailable. If neither backend initializes, the CSS orbit remains. A live preference change disposes animation resources. GSAP ScrollTrigger organizes fragments, advances story state, and closes the diagram circle through scrolling. Offscreen/hidden hero frames are skipped. Cleanup disposes geometry, materials, renderer, observers, and ScrollTriggers.

## Durable monitoring runtime

Loop → monitoring policy → durable scheduled job → worker claim → source observation → structured evaluation → Loop transition → reschedule or wait for user

`loops` stores the monitoring policy: enabled flag, source type, OBSERVE_ONLY action mode, Gmail connection/conversation, cadence, next/last check, latest user-facing observation, and a monotonic monitoring generation. Gmail provenance is copied from an accepted candidate to the Loop while monitoring is paused, so a later enable operation can prove the source belongs to the same user.

`agent_jobs` is PostgreSQL-backed and owns wake-ups. A worker claims one due job in a short transaction with `FOR UPDATE SKIP LOCKED`, assigns a 90-second lease, and increments its attempt counter. Jobs carry the owner, Loop, monitoring generation, run time, idempotency key, lease, and result marker. A crash leaves the job reclaimable after its lease. Result application locks the job and Loop together, confirms the lease, owner, generation, enabled policy, and compatible state, then writes the immutable observation, Loop state, next job, and completed result marker in one transaction. Duplicate delivery therefore cannot apply an observation twice; a changed policy generation cancels stale work.

The worker does not hold a database transaction while decrypting a token, fetching Gmail, refreshing a token, or calling the evaluator. It asks Gmail only for `threads/{linked conversation}`; it never runs a mailbox scan for a scheduled Loop. New normalized messages are deduplicated as source events before semantic evaluation. The evaluator receives only Loop outcome/verification context, existing conversation evidence, new evidence, and the previous short observation. Its strict Zod output is validated against persisted evidence IDs before service application.

Deterministic handling comes first: disabled, closed, stale, and incompatible jobs cancel; a future expected window is deferred; no new message reschedules without an AI call; disconnected or revoked Gmail moves the Loop to NEEDS_USER. Semantic decisions map to WAITING, VERIFYING, or NEEDS_USER. No agent path can write CLOSED. Temporary source/model/storage failures retry with 30-second exponential backoff capped at one hour and five attempts. A permanent Gmail auth failure stops retries, clears the encrypted token through the existing connection status path, and surfaces NEEDS_USER. Repeated failures likewise surface NEEDS_USER with audit history.

Run the worker separately from the web process:

```sh
pnpm dev
pnpm worker
```

`pnpm worker:once` claims and drains a small local batch then exits. Deploy one or more worker processes with the same database and server-only Gmail/AI environment variables; lease locking makes concurrent workers safe. There is intentionally no public worker route or in-memory timer.

## Extension points

Gmail ingestion uses the boundaries below without a separate service, queue, or workflow engine. The existing Loop service still owns Loop transitions. Future action modes must model authority and verification evidence explicitly; they must not reuse OBSERVE_ONLY as permission to perform external side effects.

## Loop Scan pipeline

Gmail → External Event → Detector → Candidate → Human approval → Loop

- `source_connections` identifies provider/account and connection status, authenticated encrypted tokens, timestamps, last scan result, and a fenced scan lease. Account identity survives disconnect for stable deduplication.
- `external_events` normalizes source evidence independently of Gmail UI: provider message/conversation IDs, timestamp, sender, subject, excerpt, metadata, and a unique connection/message hash. Only cited events retain text; other events keep trace identifiers and direction.
- `loop_candidates` stores structured suggestions, references to external event UUIDs, confidence, status, version, and optional promoted Loop ID. A unique connection/conversation hash prevents duplicates. USER dismissals remain suppressed; SCAN dismissals can be re-evaluated. ACCEPTED/MERGED require a Loop reference.

Scanning acquires a 180-second database lease atomically, with a 30-second cooldown after successful scans. The orchestrator performs network work outside transactions with a 120-second overall timeout, bounded response sizes, request deadlines, and cancellation. It fetches at most 50 unique recent message IDs across bounded pagination (30 days, excluding spam/trash/promotions/social), then normalizes MIME content and skips bulk mail. It does not download attachment bodies through attachment endpoints or crawl entire threads/mailboxes.

The detector receives only normalized useful text and minimal metadata; Gmail identifiers become opaque conversation references. It returns zero or more strict structured objects. The OpenAI-compatible adapter is the only model-provider-specific boundary. Zod rejects unknown fields, invalid structures, arbitrary prose, refusals, and truncation. Application validation checks evidence membership, limits a suggestion to one conversation, discards LOW confidence, and only accepts dates grounded by deterministic extraction. Email content is explicitly treated as untrusted data, never instructions. These safeguards constrain output; they do not guarantee semantic correctness, so human approval is mandatory.

Persistence locks and checks the connection lease before writing events/candidates and finishing the scan. Disconnect/reconnect fences stale writers. Refresh-token updates are also lease-fenced. Successful re-evaluation refreshes or withdraws pending suggestions, but cannot overwrite accepted/ignored decisions. Failed scans preserve prior suggestions and record only a safe error code.

Acceptance locks the candidate, checks status/version/evidence, and calls `loopService(tx, userId).create` inside the same transaction (nested savepoint). Creation and candidate acceptance commit together. The Loop gets `loop.created` and immutable `source.accepted` provenance events. Repeated acceptance returns its existing Loop ID; simultaneous requests cannot create duplicates. No AI output calls the Loop service directly.

### Gmail and AI setup

1. Enable the Gmail API in a Google Cloud project and configure the OAuth consent screen. For testing, add the intended Google account as a test user.
2. Create a Web application OAuth client. Register exactly `APP_URL/api/gmail/callback` as an authorized redirect URI. Open Loopend using that same origin (`localhost` and `127.0.0.1` are different). Production requires HTTPS.
3. Set the server-side values in `.env.local` (or your host’s secret manager), restart, enter Loop Scan, connect, then scan.

| Variable                      | Purpose                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `APP_URL`                     | Canonical origin, e.g. `http://localhost:3000`; no path or trailing slash             |
| `GOOGLE_CLIENT_ID`            | Google Web application OAuth client ID                                                |
| `GOOGLE_CLIENT_SECRET`        | Google OAuth client secret                                                            |
| `SOURCE_TOKEN_ENCRYPTION_KEY` | 32 random bytes encoded as base64; generate with `openssl rand -base64 32`            |
| `LOOP_SCAN_AI_API_KEY`        | Configured AI provider credential; absent means a supported setup state               |
| `LOOP_SCAN_AI_BASE_URL`       | HTTPS OpenAI-compatible API root; defaults to `https://ai-gateway.vercel.sh/v1`       |
| `LOOP_SCAN_AI_MODEL`          | Structured-output-capable model ID; defaults to `openai/gpt-4.1-mini` for the gateway |

Only `https://www.googleapis.com/auth/gmail.readonly` is requested. Gmail’s profile API supplies account identity; no send/delete/modify or additional profile scopes are needed. OAuth uses PKCE S256 and random state bound to an authenticated, encrypted, HTTP-only, SameSite=Lax cookie with a ten-minute lifetime. The callback requires workspace authentication, validates state/expiry/user/session, and consumes the cookie. Tokens are encrypted with AES-256-GCM and account-specific associated data. Changing the encryption key requires reconnecting accounts unless an explicit key-rotation migration is provided. Expired access tokens refresh server-side; revoked grants become NEEDS_REAUTH with local tokens erased.

Normal application logs never contain email bodies, model payloads, tokens, or provider error responses. Configure infrastructure access-log redaction for OAuth callback query parameters as well. Do not expose source tables or token ciphertext through client components. Backups containing source data are sensitive.

Disconnect commits local token removal and lease invalidation before attempting remote revocation. It retains candidates, cited excerpts, Loop provenance, and decision/dedupe metadata, as disclosed in the UI. No automatic retention purge or erase-all UI exists yet. Full HTML, unnecessary raw headers, attachments, and uncited message bodies are not persisted. Review your AI provider’s retention policy and Google API Services User Data Policy before production use. Public distribution with Gmail’s restricted scope may require Google verification and a security assessment; testing-mode refresh grants can expire after seven days. These are deployment prerequisites, not bypassed by the application.

## Local operation

Requires a maintained Node release (24 LTS recommended; also verified on this machine’s Node 26), pnpm 12, PostgreSQL 16+, and Chrome for browser tests.

```sh
pnpm install
cp .env.example .env.local
createdb loopend_dev
createdb loopend_test
pnpm db:migrate
pnpm db:seed <user-id> # optional, after creating the intended account
pnpm dev
```

Edit `.env.local` for your database username/password if needed. Use `DATABASE_URL` for the app and a different `TEST_DATABASE_URL` for tests. No production secrets are committed. `pnpm test` applies migrations to the test database; browser tests use that database on a separate production server at port 3100, so run `pnpm build` first. Browser identities/passwords are generated for each test through Better Auth; the test signing secret must never be deployed. Test records remain only in the isolated test database.

Scan tests mock the Google and AI HTTP boundaries, not persistence. Real PostgreSQL tests cover deduplication, sticky ignores, invalid output, confidence filtering, lease fencing, and concurrent/repeated promotion. Browser tests cover missing configuration, inspectable evidence, acceptance provenance, ignoring, and callback forgery, alongside the existing lifecycle, auth, graphics fallback, and reduced-motion suite. Isolation tests also exercise real signup/sign-in/logout, copied-cookie revocation, cross-user service access, ownership constraints, and explicit legacy transfer. No automated test needs a Gmail account or paid model call.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm format:check
```

For production, set DATABASE_URL, APP_URL, and BETTER_AUTH_SECRET; run migrations as a release step, then `pnpm build && pnpm start`. Never seed production. The build needs no live database because workspace pages render on request. Hosting should provide PostgreSQL backups, TLS, secret management, and request logs. No deployment is created automatically.

If deploying to Vercel, install its CLI (`npm i -g vercel`) for `vercel env pull`, `vercel deploy`, and `vercel logs`. The app uses ordinary PostgreSQL connections and can use a managed provider’s pooled URL. Keep migration credentials separate and use the provider’s direct URL for migrations where required.

The pnpm workspace config narrowly overrides the legacy Drizzle loader’s esbuild dependency to a patched version and explicitly allows build scripts for esbuild and unrs-resolver. Keep the lockfile and these audited build approvals committed.
