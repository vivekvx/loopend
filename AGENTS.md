# Working on loopend

- Read `docs/product.md` and `docs/architecture.md` before changing domain behavior. Use current code as implementation truth.
- A Loop represents an expected real-world outcome, not a todo. An action never implies completion.
- Keep business rules in `src/domain` and transactional operations in `src/server/loops/service.ts`. React renders and submits commands.
- All application reads and mutations derive identity from `requireWorkspace()` (Better Auth's database session). Pass that user ID to every Loop/Scan service. Never authorize using browser-supplied user IDs or emails. There is no development auth bypass.
- Preserve immutable ownership, composite owner foreign keys, and evidence guards. Legacy data remains quarantined until an explicit operator transfer; never claim it during signup. Timeline ownership follows its Loop without rewriting events.
- Authentication and Gmail authorization are separate. Gmail state must match both the initiating user and session. A provider/account reservation cannot be taken over by another user, even after disconnect.
- Validate every command with Zod. Lock the Loop and compare its version before mutations. Append events and update the Loop in the same transaction.
- Events are append-only. Never rewrite activity history. Only the explicit verification command can close a Loop, from `VERIFYING`, with evidence and confirmation.
- Detector output is untrusted: validate strict schemas and evidence references. Candidates are not Loops; only human approval may promote one through the existing Loop service in the candidate transaction.
- Preserve scan leases, provider dedupe keys, sticky human decisions, and idempotent row-locked acceptance. Keep network calls outside database transactions.
- Gmail is read-only. Encrypt tokens, never log email/model/token payloads, and mock network boundaries in tests. Disconnect must erase local tokens even if remote revocation fails.
- Monitoring jobs are durable database records. Claim them with `SKIP LOCKED`, renew only the exact owned lease while work runs, and stop applying results when renewal fails. Never hold a transaction across Gmail or model calls. Fence every monitoring write and final application with the job lease, Loop owner, and monitoring generation so stale or duplicate delivery cannot change a Loop. Retry exhaustion comes from the persisted, bounded `maxAttempts` value.
- Agent observations may move a monitored Loop to WAITING, VERIFYING, or NEEDS_USER through `loopService`; they may never close it. Keep agent events append-only and evidence references owner-scoped.
- Monitoring may temporarily retain only a bounded recent evidence window. Preserve trace/dedupe metadata for observed mail, accepted provenance, and cited evidence; minimize uncited excerpts after each decision.
- Use server components by default. Load Three.js and GSAP dynamically; retain static content and reduced-motion support.
- Use the existing semantic CSS tokens, lowercase brand, accessible labels, visible focus, and quiet editorial layout.
- Seeds are explicit development commands; never supply fallback UI data when the database fails. Never run tests against the development or production database.
- Before handing off behavior changes, run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and relevant `pnpm test:e2e` tests.
- If an `almanac/` wiki is added, consult its README for subsystem context and keep it read-only during ordinary coding work.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
