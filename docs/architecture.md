# Architecture

Loopend is a Next.js App Router modular monolith on the Node runtime, with strict TypeScript, Tailwind CSS, PostgreSQL, Drizzle, and Zod. No separate API service or worker is needed for the current product.

## Boundaries

- `src/domain/loops.ts`: schemas, completion invariants, state labels, attention calculation.
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

Add provider adapters under `src/server/integrations` when a real integration is built. Normalize external messages into source/actor/payload events and add provider-event deduplication keys before enabling ingestion. The existing service owns Loop transitions. Add a transactional outbox and durable worker when external actions are introduced; never perform network side effects inside database transactions. Model verification evidence and action authority explicitly before allowing an agent to close Loops. These integrations and workers are intentionally not simulated in the initial product.

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
