# Repository Guidelines

This file provides guidance to AI assistants when working with code in this repository.

## Project Structure & Module Organization

This is a **TypeScript monorepo** using pnpm workspaces with three packages:

```
packages/
├── web/           # Vite + TanStack Router SPA (React 19)
│   └── src/
│       ├── routes/        # TanStack Router file-based routes
│       ├── components/    # React components
│       ├── providers/     # React context providers
│       ├── hooks/         # Custom React hooks
│       └── api/           # API client functions
├── api/           # Hono API server (Node.js)
│   └── src/
│       ├── api/           # API routes
│       ├── ai-providers/  # AI provider integrations (40+)
│       ├── connectors/    # Database connectors
│       └── middlewares/   # Hono middlewares
└── shared/        # Shared types, Zod schemas, utilities
    └── src/
        ├── types/         # TypeScript types
        └── utils/         # Shared utilities
```

Other directories:
- **`tests/`**: Vitest suites mirroring packages (client, server, shared)
- **`examples/`**: Example implementations
- **`supabase/`**: Local dev DB config, migrations, `seed.sql`
- **`docker/`**: Docker configuration files

**Key path aliases**:
- `@web/*` - Web package (`packages/web/src/*`)
- `@api/*` or `@server/*` - API package (`packages/api/src/*`)
- `@shared/*` - Shared package (`packages/shared/src/*`)

## Essential Commands

**You must run these commands after modifying any file to ensure code quality:**
```bash
pnpm typecheck  # TypeScript type checking (uses Turborepo) - REQUIRED
pnpm check      # Biome linting and formatting - REQUIRED
pnpm check:fix  # Auto-fix linting and formatting issues
```

### Development Commands
```bash
# Installation and setup
pnpm install

# Database
#
# `pnpm dev` needs neither of these: it uses an embedded SQLite database at
# `.local-data/dev.db`, created on the first request. Supabase is only needed
# to develop against that backend.
supabase start  # Start local Supabase database
supabase stop   # Stop local database

# Development server (runs both web and API via Turborepo)
pnpm dev             # Start all dev servers in parallel
pnpm dev:web         # Start only web dev server (Vite on port 3000)
pnpm dev:api         # Start only API dev server (Node + SQLite, free port)
pnpm dev:api:worker  # The same API on workerd; no `file:` database there
LIBSQL_URL= pnpm dev # Develop against Supabase instead of SQLite

# Testing
pnpm test                      # Run all tests (excludes in-depth integration tests)
pnpm test path/to/test.ts      # Run specific test file
pnpm test:watch                # Run tests in watch mode

# In-depth integration tests (slower, more comprehensive)
INCLUDE_IN_DEPTH=true pnpm test

# End-to-end tests (Playwright, against the built app)
pnpm exec playwright install chromium  # first run only
pnpm test:e2e          # build, then drive the real server and dashboard (libSQL)
pnpm test:e2e:all      # the above, plus the contract specs against Supabase
pnpm test:e2e:ui       # interactive runner (skips the build)
pnpm test:e2e:report   # open the report from the last run

# Coverage (unit tests only; the e2e suite runs a built bundle out-of-process)
pnpm test:coverage     # writes coverage/index.html and coverage/lcov.info

# Runtime checks (also run in CI; both are slow, so they are not part of `pnpm test`)
pnpm verify:worker     # Bundle and boot the API on workerd
pnpm verify:container  # Build the all-in-one image and smoke test it (needs Docker)

# Build (uses Turborepo with caching)
pnpm build      # Build all packages
pnpm build:web  # Build only web package
pnpm build:api  # Build only API package

# Code quality
pnpm lint       # Run linter
pnpm format     # Check formatting
pnpm format:fix # Auto-fix formatting

# API testing. Always port 3000 -- Vite proxies /v1 on to the API, whose own
# port is chosen at runtime and is not an address to send requests to.
curl "http://localhost:3000/v1/endpoint" -H "Authorization: Bearer super-agents"
```

## Architecture

### Web Application (packages/web)
- **Framework**: Vite + TanStack Router (SPA mode)
- **Routing**: File-based routing in `src/routes/`
  - `_main.tsx` - Layout wrapper with sidebar
  - `$paramName` - Dynamic route parameters
  - `.index.tsx` - Index routes for parent paths
- **Auto-generated**: `routeTree.gen.ts` (do not edit, in .gitignore)

### API Server (packages/api)
- **Framework**: Hono web framework
- **Entry**: `src/server.ts` (Node.js) or `src/index.ts` (Cloudflare Workers)
- **Routes**: `src/api/v1/`

#### The API runs on two runtimes

`pnpm dev:api` runs the Node entrypoint (`src/server.ts`), which is also what
the Docker image runs; `src/index.ts` is the Cloudflare Workers entrypoint, and
anything reachable from it has to work on both.

Development runs on Node because a Worker has no filesystem: on workerd
`@libsql/client` resolves to its HTTP-only build, so an embedded `file:`
database cannot be opened there at all. A Workers deployment needs a remote
libSQL (Turso) or Supabase instead.

**So day-to-day development no longer exercises workerd.** Run
`pnpm dev:api:worker` before merging anything that touches the Workers path.
In practice:

- **No module-scope I/O, timers, or randomness.** Workers reject these outright
  — `utils/sse-event-manager.ts` starts its ping interval on first use for this
  reason. Prefer a first-request flag over doing work at import time.
- **Node-only packages have to stay off the Workers path.** A driver with native
  bindings fails to bundle. Where a package ships a Workers build (`/web` entry
  or a `workerd` export condition), use it.
- **`node:` builtins are the quiet case.** Wrangler's unenv layer substitutes a
  stub, so the import resolves and the Worker boots — it throws only when the
  stub is called. Neither CI check catches this, and since development moved to
  Node, neither does `pnpm dev`; review does.

`pnpm verify:worker` bundles and boots the Worker, and runs in CI.

**The Workers runtime types are generated, not a dependency.**
`packages/api/worker-configuration.d.ts` comes from `wrangler types`, run in
`packages/api`, and is committed. It replaces `@cloudflare/workers-types`,
which Wrangler now supersedes and which cannot be used here anyway: from v5 it
declares `Buffer`, `process` and `global` itself, and those collide with
`@types/node`, which the Node entrypoint needs. The generated file omits them
because `wrangler.toml` sets `nodejs_compat_v2`. Regenerate it after changing
`wrangler.toml`.

### Request Flow
```
Development:  Browser (:3000) → Vite proxy → API (a free port)
Production:   Browser (:3000) → Hono (:3000)
```

In development the browser only ever talks to Vite, which proxies `/v1/*` on to
the API. The API's port is not fixed: it takes whatever the operating system
has free and publishes it to `.local-data/api-port`, which Vite reads per
request. Nothing has to be configured, and no other project on the machine can
collide with it. `PORT` pins it if you need a stable address.

In production there is no proxy: a single Hono process serves both. Because the
API carries a `/v1` base path, `/v1/*` reaches the API routes and every other
path falls through to the dashboard's static build. See `packages/api/src/server.ts`.

## API Structure (Hono-based)

Key API endpoints:
- `/v1/chat/completions` - OpenAI-compatible chat API
- `/v1/super-agents/agents` - Agent management
- `/v1/super-agents/evaluations` - Dataset and evaluation management
- `/v1/super-agents/observability/logs` - Request logging

The gateway endpoints (`/v1/chat/completions`, `/v1/completions`, `/v1/responses`,
`/v1/embeddings`) are also mounted under
`/v1/agents/:agent_name/skills/:skill_name/...` and `/v1/agents/:agent_name/...`.
The first names the agent and skill in the path instead of in the `sa-config`
header, which makes the header optional. The second names only the agent and
leaves the skill to `routeRequestToSkill` (`utils/super-agents/skill-routing.ts`):
it embeds the request's intent in two halves (see
`@shared/utils/request-intent`) -- identity (system prompt and tool names,
what a tool sends unchanged on every request) and conversation (its last few
messages, which change turn by turn) -- and scores each skill's two
`skill_routing` centroids as `0.6 * identity + 0.4 * conversation`, weights
renormalised when a half is missing, seeding a centroid from the skill's
description the first time it meets one. A system prompt too long to embed
whole is compacted first by the `compact-intent` internal skill
(`utils/super-agents/intent-compaction.ts`, cached per distinct prompt,
truncation as the fallback). When the agent has `auto_create_skills` on (the
default), a request scoring below the agent's `skill_match_threshold` goes to
the arbiter -- the `route-or-create` internal skill
(`utils/super-agents/skill-arbiter.ts`), because embeddings cannot tell a new
kind of job from familiar work on unfamiliar material: an existing-skill
verdict routes there and teaches its centroids, no verdict routes to the
closest skill and creates nothing, and a new-job verdict -- or any request to
an agent without skills, no arbiter asked -- becomes a new skill through
`createSkillForRequest` (`utils/super-agents/skill-creation.ts`): named by the
`describe-skill` internal skill, given the agent's default models
(`agent_models`), and seeded with the caller's system prompt
(`skills.seed_system_prompt`), which `handleGenerateArms` uses verbatim so the
skill starts as a pass-through. `max_auto_created_skills` caps this per agent.
The arbiter's model and per-attempt timeout are system settings
(`skill_arbiter_model_id`, the reflection model when unset, and
`options.skill_arbiter.timeout_ms`), which an agent overrides with its own
`skill_arbiter_model_id` and `skill_arbiter_timeout_ms` columns; an agent that
names its own model still arbitrates under the system's
`options.skill_arbiter.reasoning_effort`, since it overrides which model
answers rather than how hard it may think. The arbiter is asked under the
skill-creation lease, so the lease stretches by twice the timeout to cover
it.
Creating happens under the agent's `skill_creation_leases` row
(`withSkillCreationLease`), after a second look at the skills, so concurrent
first requests produce one skill rather than one each. Intent embeddings are
cached per process (`utils/super-agents/intent-embeddings.ts`) and a centroid
absorbs each distinct part once -- identity rarely, conversations nearly every
request, which is how skills follow their traffic as it evolves; requests that
*name* their skill teach the router too (`learnSkillIntent`, after the
response, at most once a minute per skill), which is how skills that were
always named get centroids that reflect their traffic. `commonVariablesMiddleware` merges the
path names into the config (the path wins over the header) and route matching
is done against the canonical path.

**Hono Syntax**: Always use chained method syntax for proper type inference:
```typescript
// Use this pattern:
const app = new Hono<AppEnv>().get().post().fetch();

// Instead of:
const app = new Hono<AppEnv>();
app.get();
app.post();
app.fetch();
```

## Database Integration

Uses **connector pattern** for data access:
- Abstract interfaces in `packages/api/src/types/connector.ts`:
  `UserDataStorageConnector`, `LogsStorageConnector`, `CacheStorageConnector`
- All CRUD operations use Zod schema validation

### Backends

| Backend | Location | Status |
| --- | --- | --- |
| Supabase / PostgREST | `packages/api/src/connectors/supabase/` | complete; what the app uses |
| libSQL | `packages/api/src/connectors/libsql/` | complete |

**Selection** lives in `packages/api/src/connectors/index.ts`. Setting
`LIBSQL_URL` chooses libSQL; leaving it unset keeps Supabase, which is what
every existing deployment does. The URL scheme carries the rest of the
decision — `file:` is an embedded database, `libsql://` or `https://` is a
remote one.

The choice is made **per request**, not at module load, because on Workers
there is no environment until a request arrives. That is why the three storage
middlewares take a resolver rather than a connector.

libSQL migrations run on the first request that touches storage
(`ensureStorageReady`); Postgres is migrated by the `migrations` compose
service. Single-container deployment: see `docker-compose.libsql.yml`.

Its schema (`connectors/libsql/schema.ts`) is a translation of
`supabase/migrations/`, not a replay: one consolidated migration describing the
current shape. Notable differences, all deliberate:

- **No stored procedures.** SQLite has none, so the five RPCs the API calls
  become explicit transactions in `connectors/libsql/user-data.ts`, and
  `get_evaluation_scores_by_time_bucket` becomes `connectors/libsql/time-bucket.ts`.
- **NULL stays NULL.** PostgREST serialises a NULL column as JSON `null` and
  the Zod schemas use `.nullable()`, so row decoding preserves null rather than
  mapping it to `undefined`.
- **Updates re-select instead of using `RETURNING`.** SQLite computes RETURNING
  before AFTER triggers run, so it would return a stale `updated_at`.
- **`libsql` is external to the esbuild bundle.** It loads a platform-specific
  native addon through a runtime require, so `packages/api/build.js` excludes it
  and the Docker images install it in the runner stage. Bundling it produces an
  image that fails at boot with `Cannot find module '@libsql/linux-x64-gnu'`.
- **Row-level security is dropped.** The Postgres policies grant unrestricted
  access to the service role, which is the only role the API connects as.
- **`PRAGMA foreign_keys = ON` per connection.** SQLite leaves foreign keys
  unenforced by default, so without it no `ON DELETE CASCADE` would fire.
- **Types are narrower.** `JSONB`, `TIMESTAMPTZ`, `BOOLEAN`, `TEXT[]` and
  `FLOAT[]` all collapse onto TEXT/INTEGER/REAL; `connectors/libsql/rows.ts`
  owns the conversions and the mapping table is documented in `schema.ts`.

Database management:
- Postgres migrations: `supabase/migrations/`
- libSQL migrations: `libsqlMigrations` in `connectors/libsql/schema.ts`
- The app has no deployments to migrate yet, so schema changes are made to
  the existing migrations in place, on both backends, rather than appended
  as new ones. That will change once there are users.
- Because of that, a local database can be older than the migration that
  created it. libSQL records a fingerprint of each applied migration's
  statements (`connectors/libsql/migrate.ts`) and refuses a database whose
  applied migration has changed, with a `StaleMigrationError` on the first
  request that says what to do: delete `.local-data/dev.db` and let the next
  request recreate it. For Supabase, `supabase db reset`.
- Seed data: `supabase/seed.sql`
- Start/stop: `supabase start|stop`

System settings (`system_settings`, a singleton row) keep only the model ids
as columns, because the database does real work for those: `ON DELETE
RESTRICT`, and triggers that keep an embedding model out of a text slot.
Everything else -- the timeout beside each model, the judge's token budget,
developer mode -- lives in the `options` JSON column, typed by
`SystemSettingsOptions` in `@shared/types/data/system-settings` with a default
on every field, so a row written before a field existed reads as the default.
Adding a setting is a change to that schema and the settings form, not to
either backend's schema. A PATCH sends the fields it changes; the connectors
merge them over the stored options (`mergeSystemSettingsOptions`).

Every role served by a text model -- all of them but embedding, which is one
forward pass with nothing to think about -- carries a nullable
`reasoning_effort` beside its timeout, and the judge additionally carries its
completion budget (`max_tokens`). `resolveSystemSettingsModel` returns a
role's effort alongside its model and timeout, so every internal call sends
it; null sends nothing and leaves the model at its own default, and the
gateway drops the parameter for models that reject it. The roles are set
independently because they ask for different work: writing a system prompt
can be worth the thinking, while naming a skill or scoring a turn is an
answer someone is waiting for.

The judge's two settings work together. A thinking model spends the budget
reasoning before it writes a word, and one that runs out stops on `length`
with an empty answer -- reported as `budget_exhausted` and *not* retried,
since the identical request under the identical budget fails the identical
way. Raising the budget or lowering the effort is what fixes it.

A single evaluation may override the judge's budget and effort through its
own `params` (`connectors/evaluations/judge-overrides.ts`), which win over
system settings as the more specific answer. Both are optional with no
default, and that is load-bearing: absent means inherit, so an evaluation
with no opinion keeps following the settings as they change.

Core data models:
- `Agent` - AI agent configurations
- `Dataset`/`Log` - Training/evaluation data with many-to-many relationships
- `EvaluationRun`/`LogOutput` - Model evaluation system
- `Feedback`/`ImprovedResponse` - User feedback loop

Database management:
- Migrations: `supabase/migrations/`
- Seed data: `supabase/seed.sql`
- Start/stop: `supabase start|stop`

## Coding Style & Naming Conventions

- **Language**: TypeScript, React 19, Vite, TanStack Router
- **Formatting via Biome**: 2-space indent, LF, single quotes, semicolons, import organize
  - Auto-fix: `pnpm check:fix` or `pnpm format:fix`
- **Files**: kebab-case for filenames (e.g., `add-logs-dialog.tsx`)
- **Components**: PascalCase exports
- **Paths**: prefer `@web`, `@api`, `@shared` over long relative paths

## Testing Guidelines

**Unit and component tests** — Vitest (jsdom) + Testing Library
- **Location**: beside the code they cover, inside `packages/`
- **Naming**: `*.test.ts` or `*.test.tsx`
- **Run**: `pnpm test` (CI mode) or `pnpm test:watch` (dev)
- **Coverage**: see below

**Coverage** — Vitest + v8, published to GitHub Pages
- `pnpm test:coverage` writes `coverage/` (browsable `index.html`, `lcov.info`)
- The `coverage-pages` CI job publishes the report on every push to `main`, and
  writes `coverage/coverage.json` — a shields.io *endpoint* payload — beside it,
  which is what the README badge reads. No Gist, no token, no third-party service
- **The number is unit coverage only.** The e2e suite runs a built bundle in a
  separate process, so v8 cannot instrument it; a well-covered end-to-end path
  still reads as 0% here. Judge gateway and storage coverage from `e2e/`, not
  from this figure
- `coverage.exclude` in `vitest.config.ts` drops dependencies, examples, build
  output and vendored `components/ui/**`. Without it the figure is inflated by
  roughly thirty points, because `node_modules` counts as fully covered

**End-to-end tests** — Playwright, in `e2e/` (see `e2e/README.md`)
- **Run**: `pnpm test:e2e`; browsers install with `pnpm exec playwright install chromium`
- **What runs**: the built single-process server (`packages/api/dist/server.js`)
  on a throwaway libSQL file, so no Postgres, PostgREST or Docker is involved
- **Gateway**: `e2e/contract/gateway.spec.ts` drives `/v1/chat/completions`
  against `scripts/start-stub-provider.mjs`, a stub OpenAI-compatible provider.
  It covers proxying, streaming, caching and retries, and records what the
  gateway forwarded so the built request can be asserted. Tests key their
  traffic by a unique model name, since one stub serves the whole run
- **Parity**: `e2e/contract/` runs against *both* storage backends —
  `pnpm test:e2e:all` adds a Supabase pass (Postgres + PostgREST via compose,
  either docker or podman). This is the check that the hand-written type
  conversions in `connectors/libsql/rows.ts` match Postgres: JSONB, TIMESTAMPTZ,
  BOOLEAN, TEXT[], NULL handling, AFTER UPDATE triggers and ON DELETE CASCADE.
  Put a spec in `contract/` only if it must hold on both backends
- **Why it exists**: static serving, the SPA fallback, the `/v1` 404 boundary
  and the native `libsql` addon only execute in the built server — none of them
  run under `pnpm dev` or in the Vitest suites
- **It cannot use `pnpm dev`**: that runs the API on workerd, where
  `@libsql/client` resolves to its HTTP-only build and a `file:` database
  cannot be opened
- Agent names are unique per deployment and projects run in parallel, so coin
  names with `uniqueAgentName()` rather than sharing fixture rows; local runs
  reuse a server, so no test may assume an empty database

### Testing Patterns

**Mock Strategy**: Always mock the full connector in tests:
```typescript
const mockUserDataStorageConnector: unknown = {
  getAgents: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  // ... all other connector methods
};
```

**Client API Tests**: Mock the entire API module:
```typescript
vi.mock('@web/api/v1/super-agents/agents', () => ({
  getAgents: vi.fn().mockImplementation(async (params) => {
    const response = await mockGet({ query: params });
    if (!response.ok) throw new Error('Failed to fetch agents');
    return response.json();
  }),
}));
```

**Server API Tests**: Use Hono testClient with middleware injection:
```typescript
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    c.set('user_data_storage_connector', mockConnector);
    await next();
  })
  .route('/', routerUnderTest);

const client = testClient(app);
```

## AI Provider System

The application supports 40+ AI providers through a unified interface. Each provider implements:
- `chat-complete` - Chat completions
- `complete` - Text completions
- `embed` - Embeddings
- `image-generate` - Image generation

Provider implementations are in `packages/api/src/ai-providers/[provider]/`.

## Authentication

- **API**: Hono middleware with Bearer token validation (`Authorization: Bearer super-agents`)
- **Dashboard**: Client-side authentication (when ACCESS_PASSWORD is set)

## Docker Deployment

```bash
docker compose up  # Start all services
```

Services:
- **postgres**: PostgreSQL database
- **migrations**: one-shot migration runner
- **postgrest**: PostgREST API for database access
- **super-agents**: Hono API + dashboard in one process (port 3000)

The `super-agents` container serves both halves itself — no nginx:
1. `/v1/*` routes to the API
2. Static files from the Vite build are served from `./public`
3. Unmatched paths fall back to `index.html` for SPA routing

Two images are published:
- `ghcr.io/idkhub-com/super-agents` — API + dashboard (used by compose)
- `ghcr.io/idkhub-com/super-agents-api` — API only, for gateway-only deployments

Set `SERVE_DASHBOARD=false` to run the all-in-one image as a gateway only.

## Agent Validation & Readiness

- **Agent Requirements**: An agent that creates skills automatically
  (`auto_create_skills`, the default) is "ready" when it has default models,
  skills or not -- its first request creates its first skill, and skills
  created without default models cannot serve. Adding default models later
  equips the automatic skills created without them (`adoptDefaultModels`),
  and generates the evaluations they are missing -- creation generates them
  in the background, which fails when system settings have no models yet.
  An agent that keeps its skills is ready when it has at least one
- **Skill Requirements**: All skills must meet the following to be considered "ready":
  - At least one model must be configured
  - If optimization is enabled, at least one evaluation must be configured
- **Validation Logic**:
  - Agent validation: `packages/shared/src/utils/agent-validation.ts`
  - Skill validation: `packages/shared/src/utils/skill-validation.ts`

## Internal Skill Calls

The internal skills in `SA_SKILLS` are not a separate code path: each one is a
normal gateway request that the server sends to its own `/v1`, carrying an
`sa-config` header that names `super-agents` as the agent and the internal skill
by name. Two consequences worth remembering:

- **`API_URL` must point at this process.** See the environment notes above.
- **The target has to carry the provider's `custom_host`.** Internal skills
  resolve a model through system settings, and `resolveSystemSettingsModel`
  returns the provider's configured host alongside the model and key. Without
  it a self-hosted provider is sent to its vendor default — Ollama to
  `http://localhost:11434` — regardless of what the user configured.

Both failures are quiet: the call cannot connect, the caller logs and continues,
and optimization simply never happens. `e2e/contract/optimizer.spec.ts` covers
the whole path against the stub provider.

Every internal call also spreads `SA_SKILL_REQUEST_PARAMS` (`constants.ts`)
into its request body: `prompt_cache_options: { mode: 'explicit' }`, which on
OpenAI's GPT-5.6 models stops a billed cache write that no later request would
read, since each call's prompt is its own. The gateway drops the parameter for
the models that reject it (`dropUnsupportedParameters`, from the capability
table) and forwards it only where a provider's config lists it.

## Hooks and Response Review

A hook is a check the gateway runs beside a request: an *input* hook before the
provider is asked, an *output* hook once it has answered and before the client
hears. Hooks arrive in `sa_config.hooks` (`@shared/types/middleware/hooks`),
run in `middlewares/hooks.ts`, and their results are kept on the log row
(`hook_logs`). A hook's provider implements `HooksConnector`
(`types/connector.ts`) and is handed the request, the response and the status
(`HookInput`); the connectors are registered in `v1/index.ts`. Only the
`agent` provider is implemented -- `http` and `llm` are declared types with
no connector, and a hook naming one is recorded as failed. So is a hook whose
provider throws, or one that reports it could not judge. **Hooks fail open
by default:** a failed hook denies nothing, and its `result.error` on the
hook log is the only record that the request went unreviewed. A hook with
`fail_closed: true` denies instead, with the same error on the log -- for a
check that matters more than availability. On an agent,
`review_fail_closed` sets it for the reviewer hook.

A hook that denies turns the answer into a 446 (`HookDenialResponseBody`):
an `error` shaped like any other gateway error, whose `message` says which
hook withheld the request or the response and, only when that hook has
`expose_reason: true`, why -- the hook's `reason`, or the error that closed
it, repeated in `error.reason`. **Denials are unexplained by default**,
because a reviewer's reason tends to quote what it objected to, and a
client told exactly why is a client shown how to rephrase; on an agent,
`review_expose_reason` turns it on for the reviewer hook. The hook log
itself never reaches the client: it names the reviewer and carries every
hook's reason, and is read from the log row. A hook that sets
`response_body_override` has the client receive that body instead
(`utils/hooks.ts`). Retrying on a 446 (`retry.on_status_codes`) asks the
provider again. The `hook_results` block the handler merges into an allowed
response does not reach the client either: the body is re-parsed against
its response schema on the way out, which strips it.

**The `agent` provider** (`connectors/hooks/agent.ts`) makes another agent on
the deployment the reviewer. The review is an ordinary gateway request to
`/v1/agents/<reviewer>` (or `.../skills/<skill>`), so the reviewer's policy
is its skill's system prompt, evolved and evaluated like any other skill's,
and every review is a log of its own under the reviewed request's trace. The
reviewer is shown the client's request and the response as material and
answers with a verdict -- `allow`, `deny`, or `replace` with text of its own,
which rewrites every choice and drops any tool call. An answer that is not a
verdict fails open, with the error on the hook log.

**Configured on the agent, not in the header.** `agents.reviewer_agent_id`
names the reviewer of every response the agent gives; `reviewerHookFor`
(`utils/super-agents/reviewer.ts`) turns it into a blocking output hook in
`saConfigurationInjectorMiddleware`, server-side, so no client header can
leave it out. Both schemas refuse an agent as its own reviewer and forget a
deleted one (`ON DELETE SET NULL`). The request the gateway sends a reviewer
carries `reviewing_trace_id`, and a request carrying it gets no reviewer hook
of its own: a review is never reviewed, which is what keeps two agents that
review each other from looping.

**Streams are held.** A blocking output hook has to see the whole response
before the client does, so a stream it would review is served whole -- the
provider is asked without `stream`, the hooks judge the JSON -- and what they
allow is streamed to the client at the end, all at once
(`utils/held-stream.ts`). A denial reaches a streaming client as the same
446 JSON error. Only chat and text completions are held; a streaming
Responses API request is not reviewed today.

## Skill Optimization System

### System Prompt Evolution

System prompts evolve through two distinct phases:

1. **Early Regeneration (after 5 skill requests)**:
   - Triggered once per skill when `evaluations_regenerated_at` is undefined
   - Regenerates evaluations with real examples from the first 5 requests
   - An auto-created skill with *no* evaluations (creation's background
     generation can fail) gets them created here from scratch instead
   - Generates new system prompts for ALL arms
   - Resets all cluster `total_steps` to 0

2. **Reflection-based Regeneration (ongoing per cluster)**:
   - Triggered when all arms in a cluster meet the minimum request threshold
   - Uses contrastive examples (high-scoring vs low-scoring logs)
   - Conservative algorithm: best arm never modified

### Internal Skills

The system uses special auto-generated skills in the `super-agents` agent (defined in `SA_SKILLS` constant):
- `system-prompt-seeding`: Initial prompt generation
- `system-prompt-seeding-with-context`: Context-aware generation
- `system-prompt-reflection`: Reflection-based improvements
- `create-evaluations`: Evaluation method generation
- `judge`: Evaluation scoring
- `extract-task-and-outcome`: Task/outcome extraction
- `embedding`: Text embedding generation
- `describe-skill`: Name and description for a skill the gateway creates

## Development Workflow

1. Run `pnpm dev` to start both web and API servers
2. Web app available at `http://localhost:3000`
3. API requests are proxied through port 3000
4. **Always run `pnpm typecheck` and `pnpm check` after changes**
5. Use TypeScript path aliases: `@web/*`, `@api/*`, `@shared/*`

## Commit & Pull Request Guidelines

- **Conventional Commits required**. Examples:
  - `feat(server): add feedback endpoint`
  - `fix(web): handle empty dataset state`
- **Before pushing**: `pnpm typecheck && pnpm check && pnpm test`
- **PRs include**: problem/solution summary, linked issues, screenshots for UI, test notes

## Security & Configuration

- **Secrets**: Never commit secrets; use `.env` for local development
- **Environment variables**:
  - `API_URL` - the URL the API uses to call *itself*. The internal skills
    (judging, embedding, prompt generation) are ordinary gateway requests sent
    back to this server's own `/v1`, so it has to name the port the process is
    listening on. It defaults to `http://localhost:$PORT`, which is correct for
    every packaged deployment; set it explicitly only when the API is reachable
    at some other address (behind a proxy, or on Workers, where `localhost`
    means nothing). Getting it wrong is silent — each internal call fails to
    connect, every caller swallows the error, and optimization stops happening
    while ordinary requests carry on being served
  - `BEARER_TOKEN` - API authentication token
  - `ACCESS_PASSWORD` - Dashboard password (optional)
  - `AUTH_JWT_SECRET` - JWT signing secret for the dashboard session cookie (required in production)
  - `AI_PROVIDER_API_KEY_ENCRYPTION_KEY` - Encryption key for stored AI provider API keys (required in production)
  - `LIBSQL_URL` - libSQL database, and the switch that selects the libSQL
    backend. `file:` for an embedded SQLite file, `libsql://` or `https://`
    for a remote one. Unset means Supabase.
  - Note: tests for the libSQL connector use a temp **file** database, not
    `:memory:` — `client.transaction()` checks out a separate connection, and
    for an in-memory database that is a separate, empty database.
  - `LIBSQL_AUTH_TOKEN` - Auth token for a remote libSQL database. Not used by `file:` databases.
  - `WEB_APP_URL` - Comma-separated origins allowed to make credentialed cross-origin
    requests. Only needed when the dashboard is hosted separately from the API; the
    Docker and Vite setups both proxy `/v1/*` from the same origin.
- **Reading env vars**: Never read `process.env` from request-handling code. Every
  environment value is exposed as a getter in `packages/api/src/constants.ts` that
  takes the Hono context (e.g. `getAccessPassword(c)`), so the same code works on
  Node and Cloudflare Workers. `packages/api/src/server.ts` merges `process.env`
  into `c.env` for the Node entrypoint.
