<p align="center">
  <img src="src/app/icon.svg" alt="Loopend mark" width="72" height="72">
</p>

<h1 align="center">loopend</h1>

Loopend helps you keep track of real-world outcomes that are still unfinished.
Record what should happen, see what needs attention, and close a Loop only after you verify the result.

## What it does

- Keep personal Loops for things such as refunds, repairs, applications, and appointments.
- Track context, expected dates, who or what you are waiting on, and the next action.
- Record progress in an append-only timeline and close a Loop with evidence you provide.
- Optionally connect Gmail with read-only access to find unfinished situations for your review.
- Monitor a linked Gmail conversation and record observations; Loopend never sends or changes email and never closes a Loop for you.

## Getting started

### Requirements

- Node.js 24 or newer
- pnpm 12
- PostgreSQL 16 or newer

### Local setup

```sh
pnpm install
cp .env.example .env.local
```

Set `DATABASE_URL` to your local PostgreSQL database and `APP_URL` to the address you will use in your browser. Generate local secrets:

```sh
openssl rand -base64 32
```

Use the generated value for `BETTER_AUTH_SECRET` and generate a separate value for `SOURCE_TOKEN_ENCRYPTION_KEY`. Gmail and AI provider variables are only needed for Loop Scan and monitoring; see [`.env.example`](.env.example) and [deployment guide](docs/deployment.md).

Create the development database if needed, then apply migrations and start the app:

```sh
createdb loopend_dev
pnpm db:migrate:local
pnpm dev --port 1232
```

Open [http://localhost:1232](http://localhost:1232). The development server binds to loopback. Create an account to use the private workspace. For background Gmail scans and monitoring, run the worker in a second terminal:

```sh
pnpm worker:local
```

### Useful commands

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Tests require a separate local test database configured by `TEST_DATABASE_URL`. Never point it at development or production data.

## How it works

Loopend is a Next.js App Router application backed by PostgreSQL. The web app and durable background worker share the same codebase and database. Loops and their history are isolated to the signed-in account; Gmail authorization is a separate, optional connection.

The workflow is **Detect → Understand → Wait → Act → Verify → Close**. A message or action can be progress, but only a person can confirm the outcome and close a Loop. Gmail access is read-only, and any AI-generated suggestions require human review before becoming Loops.

## Project documentation

- [Product overview](docs/product.md)
- [Architecture](docs/architecture.md)
- [Deployment](docs/deployment.md)

## Technology

Next.js, React, TypeScript, PostgreSQL, Drizzle ORM, Better Auth, and Zod.
