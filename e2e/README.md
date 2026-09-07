# End-to-end tests

Playwright tests that drive the real application: the built Hono server against
a real database, with a real browser against the built dashboard. The storage
contract runs twice — once per backend — so the libSQL and Supabase connectors
are held to the same behaviour.

```sh
pnpm test:e2e          # build, then run against libSQL (no containers needed)
pnpm test:e2e:all      # the above, plus the contract specs against Supabase
pnpm test:e2e:ui       # interactive runner (skips the build)
pnpm test:e2e:report   # open the report from the last run
```

`test:e2e:all` needs a container runtime — it starts Postgres and PostgREST
through `scripts/e2e-postgres.sh`, which works with either `docker compose` or
`podman compose`. Stop them again with `pnpm test:e2e:postgres down`.

First run only:

```sh
pnpm exec playwright install chromium
```

## What this covers that the unit tests don't

The Vitest suites mock the storage connector and render components in jsdom, so
several seams have no coverage there by construction:

- **Static serving and the SPA fallback.** Both live in `server.ts` and run in
  neither `pnpm dev` (Vite serves the dashboard) nor the unit tests.
- **The `/v1` 404 boundary.** `commonVariablesMiddleware` skips
  `/v1/super-agents/*`, so without the explicit guard that subtree would answer
  a mistyped endpoint with `index.html` and a 200.
- **The libSQL backend as it actually ships.** The bundle leaves `libsql`
  external because of its native addon, migrations run on the first request,
  and Zod schemas round-trip through real HTTP rather than a test client.
- **The dashboard against a real API**, including that it renders without
  console errors — a React crash still returns HTTP 200.

Constraint translation is one concrete example: a duplicate agent name returned
`500` on libSQL until these tests ran, because `parseDatabaseError` only knew
PostgreSQL's lowercase `unique constraint` and SQLite shouts `UNIQUE constraint
failed`.

## How it runs

`scripts/start-e2e-server.mjs` boots `packages/api/dist/server.js` — the same
single process the published image runs — pointed at a throwaway libSQL file
under `.e2e-data/`. Migrations run on the first request, so deleting the file
is a full reset, and that half of the suite needs no Postgres, no PostgREST and
no container runtime at all. Only the Supabase parity pass does.

It has to be the built server rather than `pnpm dev`, which is a Vite/API
pair: Vite serves the dashboard and proxies `/v1` away, so the static serving,
the SPA fallback and the `/v1` 404 boundary above never execute there. They
exist only in `server.ts`.

Three servers run, because two things are fixed per process and decided from
the environment — the storage backend and whether the dashboard needs a login:

| Project             | Port | Backend  | Covers                              |
| ------------------- | ---- | -------- | ----------------------------------- |
| `api`               | 3100 | libSQL   | server shape: routing, SPA fallback, headers |
| `contract:libsql`   | 3100 | libSQL   | the storage contract and the gateway |
| `contract:supabase` | 3102 | Supabase | the same specs, other connector     |
| `dashboard`         | 3100 | libSQL   | the dashboard in Chromium           |
| `auth`              | 3101 | libSQL   | the login flow                      |

A stub AI provider runs alongside them on port 3103.

Neither `api` nor the two `contract` projects launches a browser — they use
Playwright's `request` fixture only, which is what keeps the whole suite at a
few seconds.

## The parity pass

`e2e/contract/` is the directory that runs twice, once per storage backend.
That is the highest-value part of this suite. libSQL and Supabase are two
implementations of one interface, and Postgres and SQLite disagree about nearly
every type the schema uses — `JSONB`, `TIMESTAMPTZ`, `BOOLEAN`, `TEXT[]` and
`FLOAT[]` all collapse onto TEXT/INTEGER/REAL, and `connectors/libsql/rows.ts`
converts them back by hand.

`types.spec.ts` exercises exactly those conversions: JSON round-trips, booleans
(including `false`), floats, string arrays (including empty), NULL staying
`null` rather than becoming `undefined`, `updated_at` advancing past its AFTER
UPDATE trigger, and `ON DELETE CASCADE` firing — which on SQLite depends on
`PRAGMA foreign_keys = ON` being set per connection.

Running one suite against both connectors is what proves the translation is
faithful rather than merely self-consistent. A test that only ever runs against
libSQL cannot tell the difference.

When `E2E_POSTGREST_URL` is unset the Supabase project is not registered, and
the config says so on stderr rather than skipping quietly.

## The stub provider

`scripts/start-stub-provider.mjs` imitates an OpenAI-compatible provider so the
gateway has something to proxy to. Pointing at a real provider would need API
keys, cost money on every run, and answer differently each time.

The `ollama` provider is the shape being imitated because it is
OpenAI-compatible, requires no API key, and honours `custom_host` — so
`gateway.spec.ts` names it in `sa-config` and points it at the stub. No AI
provider or model records are needed in the database.

Beyond answering, the stub **records what the gateway actually sent**. That is
the only way to assert on the request the gateway builds — the model it
resolved, the parameters it injected — because none of it appears in the
response the client receives. It also injects failures on demand, which is how
the retry tests work.

Everything is keyed by model name. One stub process serves the whole run, so
tests coin a unique model with `uniqueModelName()` the way they coin agent
names, and never see each other's traffic.

```
GET  /__control/requests?model=NAME   what the gateway sent
POST /__control/fail                  {model, times, status}
POST /__control/fence                 {model} -- structured output inside a markdown fence
POST /__control/reply                 {model, content} -- answer with this; a list, in order
POST /__control/reset                 {model}
```

The stub also answers **structured output**: when a request carries a
`response_format` JSON schema it synthesises the smallest conforming value
rather than echoing text. That is what makes the internal skills testable —
prompt seeding, evaluation generation and judging all parse their replies
against the schema they sent, so an echo would fail. String fields come back as
`stub: <property>`, which is how `optimizer.spec.ts` can tell a generated prompt
apart from anything the system produced itself.

Cache behaviour is asserted by **counting provider calls**, not by reading a
response header — no header distinguishes a hit from a miss, and the call count
is the behaviour that actually matters. That test is the end-to-end half of the
fix in #237, and it fails against the pre-fix connector.

## Writing tests

Agent names are unique across a deployment and the projects run in parallel, so
coin one per test with `uniqueAgentName()` from `fixtures/agents.ts` rather than
sharing a fixture row. Locally the servers are reused between runs
(`reuseExistingServer`), so no test may assume an empty database; CI always
boots its own. The Supabase database is not reset between runs either, which is
the same constraint from the other direction.

Put a spec in `contract/` when it is about what the storage layer must do, and
in `api/` when it is about the server's own shape. Anything in `contract/` runs
against both backends, so it must not assume a particular one.

Clean up through `deleteAgent()` in a `finally` block — it swallows its own
failures so a teardown error can't mask the real assertion.
