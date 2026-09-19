# Architecture

Loopend is a Next.js App Router modular monolith on the Node runtime, with strict TypeScript, Tailwind CSS, PostgreSQL, Drizzle, and Zod. No separate API service or worker is needed for the current product.

## Boundaries

- `src/domain/loops.ts`: schemas, completion invariants, state labels, attention calculation.
- `src/domain/scan.ts`: provider-neutral detector contract, strict output schema, confidence filtering, source/date grounding, safe errors, scan limits.
- `src/server/integrations`: Gmail OAuth/API adapter, bounded responses, message normalization, token encryption, connection lifecycle.
- `src/server/scan`: configuration, AI adapter, orchestration, candidate persistence/promotion, authenticated actions. Network boundaries are injected for tests and future workers.
- `src/server/db`: lazy pooled PostgreSQL client and Drizzle schema.
- `src/server/loops/service.ts`: commands and queries, independent of React and Next request APIs. Future ingestion and workers can call this boundary.
- `src/server/loops/actions.ts`: authenticated Server Actions, boundary validation, safe user errors, revalidation, redirects.
- `src/server/auth.ts`: private-workspace password gate, signed expiring HTTP-only cookies, persistent login throttling.
- `src/app`: server-rendered routes; small form components handle pending and validation states.
- `src/components/marketing`: static first render and optional dynamically imported graphics.

## Persistence and concurrency

`loops` is the current materialized state. `loop_events` is an append-only history with UUID identity, monotonic database sequence, typed event name, source, actor, JSON payload, occurrence time, and recording time. The timeline orders by recording sequence so delayed external events do not silently reorder the audit trail. Occurrence time remains available for future event-specific views.

Commands lock the Loop row with `FOR UPDATE`, compare an optimistic version, validate state invariants, then update the row and append events in one transaction. Stale submissions return a refresh instruction. Simultaneous completion submits produce one verified outcome. Updates capture before/after snapshots in their event payload.

A PostgreSQL trigger rejects event UPDATE and DELETE. A CHECK constraint requires CLOSED and `closed_at` to agree. The service rejects all mutations to closed Loops. The database owner can bypass database protections, so production should use a least-privileged runtime role and a separate migration role. Do not grant the runtime role schema ownership or TRUNCATE.

Versioned migrations are committed in `drizzle/`; `db:migrate` uses Drizzle’s migration journal. `db:generate` emits schema migrations. The immutable-event trigger is a custom migration. `db:seed` is explicit, rejects production mode, and skips existing example titles. It never deletes records.

## Private workspace

This foundation is a single personal workspace, not multi-user authentication. In development, unset APP_PASSWORD allows local use; dev and start bind to loopback. Production fails closed unless APP_PASSWORD has at least 12 characters and SESSION_SECRET at least 32. Set both with strong randomly generated values and serve over HTTPS. Cookies are signed, expire in seven days, use HttpOnly/SameSite=Lax, and are Secure in production. Rotating either secret invalidates sessions. A database-backed global limit allows 15 login attempts per minute across instances. Next Server Actions enforce same-origin mutation requests.

Before supporting multiple people, introduce an authenticated workspace identity, ownership keys on Loops/events, and scoped repository queries. Do not make this app public with shared data by removing the gate.

## Graphics

Heading, navigation, CTA, fallback orbit, fragments, and story copy render immediately. A narrow client component checks `prefers-reduced-motion` before importing the graphics chunk. Three.js `WebGPURenderer` initializes WebGPU and automatically uses its built-in WebGL2 backend if WebGPU is unavailable. If neither backend initializes, the CSS orbit remains. A live preference change disposes animation resources. GSAP ScrollTrigger organizes fragments, advances story state, and closes the diagram circle through scrolling. Offscreen/hidden hero frames are skipped. Cleanup disposes geometry, materials, renderer, observers, and ScrollTriggers.

## Extension points

Gmail ingestion uses the boundaries below without a separate service, queue, or workflow engine. The existing Loop service still owns Loop transitions. Add a transactional outbox and durable worker when external actions are introduced; never perform network side effects inside database transactions. Model verification evidence and action authority explicitly before allowing an agent to close Loops.

## Loop Scan pipeline

Gmail → External Event → Detector → Candidate → Human approval → Loop

- `source_connections` identifies provider/account and connection status, authenticated encrypted tokens, timestamps, last scan result, and a fenced scan lease. Account identity survives disconnect for stable deduplication.
- `external_events` normalizes source evidence independently of Gmail UI: provider message/conversation IDs, timestamp, sender, subject, excerpt, metadata, and a unique connection/message hash. Only cited events retain text; other events keep trace identifiers and direction.
- `loop_candidates` stores structured suggestions, references to external event UUIDs, confidence, status, version, and optional promoted Loop ID. A unique connection/conversation hash prevents duplicates. USER dismissals remain suppressed; SCAN dismissals can be re-evaluated. ACCEPTED/MERGED require a Loop reference.

Scanning acquires a 180-second database lease atomically, with a 30-second cooldown after successful scans. The orchestrator performs network work outside transactions with a 120-second overall timeout, bounded response sizes, request deadlines, and cancellation. It fetches at most 50 unique recent message IDs across bounded pagination (30 days, excluding spam/trash/promotions/social), then normalizes MIME content and skips bulk mail. It does not download attachment bodies through attachment endpoints or crawl entire threads/mailboxes.

The detector receives only normalized useful text and minimal metadata; Gmail identifiers become opaque conversation references. It returns zero or more strict structured objects. The OpenAI-compatible adapter is the only model-provider-specific boundary. Zod rejects unknown fields, invalid structures, arbitrary prose, refusals, and truncation. Application validation checks evidence membership, limits a suggestion to one conversation, discards LOW confidence, and only accepts dates grounded by deterministic extraction. Email content is explicitly treated as untrusted data, never instructions. These safeguards constrain output; they do not guarantee semantic correctness, so human approval is mandatory.

Persistence locks and checks the connection lease before writing events/candidates and finishing the scan. Disconnect/reconnect fences stale writers. Refresh-token updates are also lease-fenced. Successful re-evaluation refreshes or withdraws pending suggestions, but cannot overwrite accepted/ignored decisions. Failed scans preserve prior suggestions and record only a safe error code.

Acceptance locks the candidate, checks status/version/evidence, and calls `loopService(tx).create` inside the same transaction (nested savepoint). Creation and candidate acceptance commit together. The Loop gets `loop.created` and immutable `source.accepted` provenance events. Repeated acceptance returns its existing Loop ID; simultaneous requests cannot create duplicates. No AI output calls the Loop service directly.

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

Only `https://www.googleapis.com/auth/gmail.readonly` is requested. Gmail’s profile API supplies account identity; no send/delete/modify or additional profile scopes are needed. OAuth uses PKCE S256 and random state bound to an authenticated, encrypted, HTTP-only, SameSite=Lax cookie with a ten-minute lifetime. The callback requires workspace authentication, validates state/expiry, and consumes the cookie. Tokens are encrypted with AES-256-GCM and account-specific associated data. Changing the encryption key requires reconnecting accounts unless an explicit key-rotation migration is provided. Expired access tokens refresh server-side; revoked grants become NEEDS_REAUTH with local tokens erased.

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
pnpm db:seed # optional realistic development records
pnpm dev
```

Edit `.env.local` for your database username/password if needed. Use `DATABASE_URL` for the app and a different `TEST_DATABASE_URL` for tests. No production secrets are committed. `pnpm test` applies migrations to the test database; browser tests use that database on a separate production server at port 3100, so run `pnpm build` first. Browser credentials are test-only fixtures and must never be deployed. Test records remain only in the isolated test database.

Scan tests mock the Google and AI HTTP boundaries, not persistence. Real PostgreSQL tests cover deduplication, sticky ignores, invalid output, confidence filtering, lease fencing, and concurrent/repeated promotion. Browser tests cover missing configuration, inspectable evidence, acceptance provenance, ignoring, and callback forgery, alongside the existing lifecycle, auth, graphics fallback, and reduced-motion suite. No automated test needs a Gmail account or paid model call.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm format:check
```

For production, set DATABASE_URL, APP_PASSWORD, and SESSION_SECRET; run migrations as a release step, then `pnpm build && pnpm start`. Never seed production. The build needs no live database because workspace pages render on request. Hosting should provide PostgreSQL backups, TLS, secret management, and request logs. No deployment is created automatically.

If deploying to Vercel, install its CLI (`npm i -g vercel`) for `vercel env pull`, `vercel deploy`, and `vercel logs`. The app uses ordinary PostgreSQL connections and can use a managed provider’s pooled URL. Keep migration credentials separate and use the provider’s direct URL for migrations where required.
