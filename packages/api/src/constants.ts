import type { AppContext } from '@api/types/hono';
import type { ChatCompletionRequestBody } from '@shared/types/api/routes/chat-completions-api/request';

const DUMMY_JWT_SECRET = 'default-dev-jwt-secret';
/**
 * Base URL the API uses to call *itself*.
 *
 * The internal skills (judging, embedding, prompt generation) are ordinary
 * gateway requests that the server sends back to its own `/v1`, so this has to
 * name the port it is actually listening on. Deriving it from `PORT` rather
 * than hardcoding one keeps the all-in-one image (3000), the gateway-only image
 * (8787) and `wrangler dev` (8787) all correct without configuration.
 *
 * Getting this wrong is invisible: every internal call fails to connect, each
 * caller swallows the error, and optimization simply stops happening while
 * ordinary requests carry on being served.
 */
export const getApiUrl = (c: AppContext) =>
  c.env.API_URL ?? `http://localhost:${c.env.PORT ?? 8787}`;

export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 1 week in seconds

/**
 * Algorithm for the dashboard session JWT.
 *
 * `sign` defaults to this, but `verify` and the `jwt` middleware require it to
 * be named since Hono 4.13: a verifier that accepts whatever `alg` the token
 * header claims is the classic algorithm-confusion hole. All three sites read
 * it from here so they cannot drift apart.
 */
export const AUTH_JWT_ALG = 'HS256' as const;

/**
 * Supabase URL for local development.
 *
 * Using default Supabase URL for local development.
 *
 * @see https://supabase.com/docs/guides/local-development
 */
const getSupabaseUrl = (c: AppContext): string | undefined =>
  c.env.SUPABASE_URL ??
  (c.env.NODE_ENV !== 'production' ? 'http://127.0.0.1:54321' : undefined);

/**
 * PostgREST URL.
 *
 * For Supabase, we simply need to add /rest/v1 to the Supabase URL.
 */
export const getPostgrestUrl = (c: AppContext) => {
  const postgrestUrl = c.env.POSTGREST_URL;
  if (postgrestUrl) {
    return postgrestUrl;
  }
  const supabaseUrl = getSupabaseUrl(c);
  if (supabaseUrl) {
    return `${supabaseUrl}/rest/v1`;
  }
  throw new Error(
    'POSTGREST_URL environment variable is required in production.',
  );
};

/**
 * libSQL database URL.
 *
 * `file:` points at an embedded SQLite database, which is what the
 * single-container deployment uses; `libsql://` or `https://` points at a
 * remote database (Turso), which is what a Workers deployment or any
 * multi-instance deployment needs.
 */
export const getLibsqlUrl = (c: AppContext): string | undefined =>
  // Optional access: these two are read on every request by the storage
  // middleware, including from apps constructed without bindings, where
  // `c.env` is undefined.
  c.env?.LIBSQL_URL;

/** Auth token for a remote libSQL database. Unused by `file:` databases. */
export const getLibsqlAuthToken = (c: AppContext): string | undefined =>
  c.env?.LIBSQL_AUTH_TOKEN;

/**
 * How long a cached response stays valid, in seconds.
 *
 * `CacheStorageConnector.setCache` takes no TTL, so the backend decides.
 */
export const CACHE_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Supabase Secret key
 */
export const getSupabaseSecretKey = (c: AppContext): string | undefined => {
  const key = c.env.SUPABASE_SECRET_KEY;

  if (key) {
    return key;
  } else if (c.env.NODE_ENV !== 'production') {
    // Default to development key used by supabase
    return 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
  }
};

/**
 * PostgREST Service Role.
 *
 * This is the key used to authenticate requests to the PostgREST API.
 * For Supabase, this is the same as its secret key.
 */
export const getPostgrestServiceRoleKey = (c: AppContext): string => {
  const key = c.env.POSTGREST_SERVICE_ROLE_KEY ?? getSupabaseSecretKey(c);

  if (key) {
    return key;
  }

  throw new Error(
    'POSTGREST_SERVICE_ROLE_KEY environment variable is required in production. Set it to a strong, random secret.',
  );
};

export const getAccessPassword = (c: AppContext): string | undefined =>
  c.env.ACCESS_PASSWORD;

export const getAuthJwtSecret = (c: AppContext): string => {
  const secret = c.env.AUTH_JWT_SECRET;
  if (!secret && c.env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_JWT_SECRET environment variable is required in production. Set it to a strong, random secret.',
    );
  }

  return secret ?? DUMMY_JWT_SECRET;
};

/**
 * Bearer token for API authentication.
 *
 * If not set, API requests without JWT authentication will be allowed through.
 * Set this to require Bearer token authentication for API access.
 */
/**
 * The key the server sends when it calls its own `/v1` -- the internal
 * skills, and an agent reviewing another's responses. The bearer token when
 * one is configured, since those calls are authenticated like any client's.
 * Without one, authentication is skipped and the value only has to exist:
 * the OpenAI SDK refuses to construct a client with no key at all.
 */
export const getInternalApiKey = (c: AppContext): string =>
  getBearerToken(c) ?? 'none';

export const getBearerToken = (c: AppContext): string | undefined =>
  c.env.BEARER_TOKEN;

/**
 * Encryption key for AI provider API keys.
 *
 * You should absolutely change this in production!
 */
export const getAiProviderApiKeyEncryptionKey = (c: AppContext): string => {
  const key = c.env.AI_PROVIDER_API_KEY_ENCRYPTION_KEY;
  if (key) {
    return key;
  } else if (c.env.NODE_ENV !== 'production') {
    return 'default-32-byte-key-change-in-prod';
  }

  throw new Error(
    'AI_PROVIDER_API_KEY_ENCRYPTION_KEY environment variable is required in production. Set it to a strong, random secret.',
  );
};

/**
 * Origins allowed to make credentialed cross-origin requests to the API.
 *
 * `WEB_APP_URL` accepts a comma-separated list. The Docker deployment serves the
 * dashboard and proxies `/v1/*` from the same nginx origin, and Vite proxies the
 * same paths in development, so CORS only matters when the dashboard is hosted
 * separately — hence the empty production default rather than a permissive one.
 */
export const getAllowedOrigins = (c: AppContext): string[] => {
  const webAppUrl = c.env.WEB_APP_URL;
  if (webAppUrl) {
    return webAppUrl
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  if (c.env.NODE_ENV === 'production') {
    return [];
  }

  return [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8787',
  ];
};

/**
 * Special skills that super-agents uses internally. We auto generate these if they don't exist.
 */
export const SA_SKILLS = [
  'judge',
  'extract-task-and-outcome',
  'create-evaluations',
  'system-prompt-seeding',
  'system-prompt-seeding-with-context',
  'system-prompt-reflection',
  'embedding',
  'describe-skill',
  'route-or-create',
  'compact-intent',
];

/**
 * Request parameters every internal skill call carries.
 *
 * Internal skills are one-shot: a judge call, an evaluation generation, a
 * reflection, each with a prompt no later request shares. OpenAI's GPT-5.6
 * models cache the prompt implicitly and bill the write at 1.25x the input
 * price, so each call was paying to cache a prefix nothing would read back.
 * Explicit mode caches only the blocks marked with a breakpoint, and none are
 * marked, so nothing is written. The gateway drops the option for the models
 * that reject it (`dropUnsupportedParameters`) and forwards it only where a
 * provider's config lists it, so sending it unconditionally is safe.
 */
export const SA_SKILL_REQUEST_PARAMS = {
  prompt_cache_options: { mode: 'explicit' },
} as const satisfies Pick<ChatCompletionRequestBody, 'prompt_cache_options'>;
