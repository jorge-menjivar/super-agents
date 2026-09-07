/**
 * SQLite schema for the libSQL backend.
 *
 * This is a translation of `supabase/migrations/`, not a replay of it. Those
 * four migrations describe how the Postgres schema arrived at its current
 * shape; a new backend only needs the shape itself, so this is one consolidated
 * migration. While the app has no deployments to migrate, schema changes are
 * folded into the existing entries in place -- here and in
 * `supabase/migrations/` alike -- rather than appended.
 *
 * Statements are listed individually rather than as one blob because the
 * migration runner submits them through `client.batch(..., 'write')`, which is
 * transactional. Splitting a blob on `;` would break the trigger bodies.
 *
 * Type mapping from Postgres:
 *
 * | Postgres                  | SQLite            | Handled by                    |
 * | ------------------------- | ----------------- | ----------------------------- |
 * | `UUID` + `uuid_generate_v4` | `TEXT`          | ids generated in TS           |
 * | `JSONB`                   | `TEXT`            | `toJsonColumn` / `fromJson`   |
 * | `TIMESTAMPTZ`             | `TEXT` (ISO-8601) | `nowIso` and the triggers     |
 * | `BIGINT`                  | `INTEGER`         | SQLite INTEGER is 64-bit      |
 * | `FLOAT`                   | `REAL`            | direct                        |
 * | `BOOLEAN`                 | `INTEGER` (0/1)   | `toBoolColumn` / `fromBool`   |
 * | `TEXT[]` / `FLOAT[]`      | `TEXT` (JSON)     | `toJsonColumn` / `fromJson`   |
 * | `ENUM`                    | `TEXT` + `CHECK`  | the CHECK constraints below   |
 *
 * Row-level security has no SQLite equivalent and is intentionally dropped: the
 * Postgres policies all grant unrestricted access to the service role, which is
 * the only role the API ever connects as.
 */

export interface LibsqlMigration {
  /** Sort key and primary key in `schema_migrations`. */
  version: string;
  statements: string[];
}

/** Written by the updated_at triggers; matches `Date.prototype.toISOString`. */
const NOW_ISO = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Postgres sets `updated_at` on every UPDATE via `update_updated_at_column`. */
const updatedAtTrigger = (table: string): string => `
CREATE TRIGGER IF NOT EXISTS ${table}_updated_at
AFTER UPDATE ON ${table}
FOR EACH ROW
BEGIN
  UPDATE ${table} SET updated_at = ${NOW_ISO} WHERE rowid = NEW.rowid;
END`;

const initialSchema: LibsqlMigration = {
  version: '0001_initial_schema',
  statements: [
    // ---------------------------------------------------------------- agents
    `CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      auto_create_skills INTEGER NOT NULL DEFAULT 1 CHECK (auto_create_skills IN (0, 1)),
      skill_match_threshold REAL NOT NULL DEFAULT 0.8,
      max_auto_created_skills INTEGER NOT NULL DEFAULT 10,
      skill_arbiter_model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
      skill_arbiter_timeout_ms INTEGER CHECK (skill_arbiter_timeout_ms IS NULL OR skill_arbiter_timeout_ms > 0),
      reviewer_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      review_fail_closed INTEGER NOT NULL DEFAULT 0 CHECK (review_fail_closed IN (0, 1)),
      review_expose_reason INTEGER NOT NULL DEFAULT 0 CHECK (review_expose_reason IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      CHECK (reviewer_agent_id IS NULL OR reviewer_agent_id <> id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agents_reviewer_agent_id ON agents(reviewer_agent_id)`,
    updatedAtTrigger('agents'),
    // Postgres enforces this through `validate_agent_model_types`.
    `CREATE TRIGGER IF NOT EXISTS agents_validate_model_types_insert
    BEFORE INSERT ON agents
    FOR EACH ROW
    WHEN NEW.skill_arbiter_model_id IS NOT NULL
    BEGIN
      SELECT CASE WHEN (SELECT model_type FROM models WHERE id = NEW.skill_arbiter_model_id) IS NOT 'text'
        THEN RAISE(ABORT, 'skill_arbiter_model_id must reference a text model') END;
    END`,
    `CREATE TRIGGER IF NOT EXISTS agents_validate_model_types_update
    BEFORE UPDATE ON agents
    FOR EACH ROW
    WHEN NEW.skill_arbiter_model_id IS NOT NULL
    BEGIN
      SELECT CASE WHEN (SELECT model_type FROM models WHERE id = NEW.skill_arbiter_model_id) IS NOT 'text'
        THEN RAISE(ABORT, 'skill_arbiter_model_id must reference a text model') END;
    END`,

    // --------------------------------------------------------- ai_providers
    `CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      ai_provider TEXT NOT NULL,
      name TEXT NOT NULL,
      api_key TEXT,
      custom_fields TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      UNIQUE (ai_provider, name)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ai_providers_ai_provider ON ai_providers(ai_provider)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_providers_name ON ai_providers(name)`,
    updatedAtTrigger('ai_providers'),

    // --------------------------------------------------------------- models
    `CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      ai_provider_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      model_type TEXT NOT NULL DEFAULT 'text' CHECK (model_type IN ('text', 'embed')),
      embedding_dimensions INTEGER,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      FOREIGN KEY (ai_provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE,
      UNIQUE (ai_provider_id, model_name),
      CONSTRAINT embedding_dimensions_only_for_embed CHECK (
        (model_type = 'embed' AND embedding_dimensions IS NOT NULL) OR
        (model_type = 'text' AND embedding_dimensions IS NULL)
      )
    )`,
    `CREATE INDEX IF NOT EXISTS idx_models_ai_provider_id ON models(ai_provider_id)`,
    `CREATE INDEX IF NOT EXISTS idx_models_model_name ON models(model_name)`,
    updatedAtTrigger('models'),

    // --------------------------------------------------------------- skills
    `CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      optimize INTEGER NOT NULL DEFAULT 1 CHECK (optimize IN (0, 1)),
      configuration_count INTEGER NOT NULL DEFAULT 3,
      clustering_interval INTEGER NOT NULL DEFAULT 15,
      reflection_min_requests_per_arm INTEGER NOT NULL DEFAULT 2,
      exploration_temperature REAL NOT NULL DEFAULT 1.0,
      total_requests INTEGER NOT NULL DEFAULT 0,
      allowed_template_variables TEXT NOT NULL DEFAULT '[]',
      auto_created INTEGER NOT NULL DEFAULT 0 CHECK (auto_created IN (0, 1)),
      seed_system_prompt TEXT,
      last_clustering_at TEXT,
      last_clustering_log_start_time INTEGER,
      evaluations_regenerated_at TEXT,
      evaluation_lock_acquired_at TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      UNIQUE (agent_id, name)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_skills_agent_id ON skills(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name)`,
    `CREATE INDEX IF NOT EXISTS idx_skills_evaluation_lock ON skills(evaluation_lock_acquired_at)
      WHERE evaluation_lock_acquired_at IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_skills_last_clustering ON skills(last_clustering_at)
      WHERE last_clustering_at IS NOT NULL`,
    updatedAtTrigger('skills'),

    // ------------------------------------------- skill_optimization_clusters
    `CREATE TABLE IF NOT EXISTS skill_optimization_clusters (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      name TEXT NOT NULL,
      total_steps INTEGER NOT NULL DEFAULT 0,
      observability_total_requests INTEGER NOT NULL DEFAULT 0,
      centroid TEXT NOT NULL,
      embedding_model_id TEXT,
      reflection_lock_acquired_at TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      FOREIGN KEY (embedding_model_id) REFERENCES models(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_clusters_name ON skill_optimization_clusters(name)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_clusters_agent_id ON skill_optimization_clusters(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_clusters_skill_id ON skill_optimization_clusters(skill_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_clusters_embedding_model_id ON skill_optimization_clusters(embedding_model_id)`,
    `CREATE INDEX IF NOT EXISTS idx_clusters_reflection_lock ON skill_optimization_clusters(reflection_lock_acquired_at)
      WHERE reflection_lock_acquired_at IS NOT NULL`,

    // ----------------------------------------------------------- skill_routing
    // Where an agent's requests go when the caller names only the agent: one
    // row per skill, a running mean of the intent embeddings it has served.
    // The FK to models cascades because a centroid from one embedding model
    // means nothing under another; the row is re-seeded on the next request.
    `CREATE TABLE IF NOT EXISTS skill_routing (
      skill_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      centroid TEXT NOT NULL,
      conversation_centroid TEXT,
      embedding_model_id TEXT NOT NULL,
      sample_count INTEGER NOT NULL DEFAULT 0,
      conversation_sample_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (embedding_model_id) REFERENCES models(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_skill_routing_agent_id ON skill_routing(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_routing_embedding_model_id ON skill_routing(embedding_model_id)`,
    updatedAtTrigger('skill_routing'),
    updatedAtTrigger('skill_optimization_clusters'),

    // -------------------------------------------------- skill_creation_leases
    // Serialises the skills the gateway creates for one agent: the request
    // creating one holds the lease and looks at the skills again first, so
    // concurrent first requests do not each create a skill. NULL while free;
    // a lease past its time counts as free, in case its holder died. `holder`
    // is a token the claimant coins, so it releases only its own lease.
    `CREATE TABLE IF NOT EXISTS skill_creation_leases (
      agent_id TEXT PRIMARY KEY,
      holder TEXT,
      lease_until TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )`,

    // ---------------------------------------------------------------- tools
    `CREATE TABLE IF NOT EXISTS tools (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      hash TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      raw_data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      UNIQUE (agent_id, hash)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tools_agent_id ON tools(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tools_hash ON tools(hash)`,
    `CREATE INDEX IF NOT EXISTS idx_tools_type ON tools(type)`,
    `CREATE INDEX IF NOT EXISTS idx_tools_name ON tools(name)`,
    updatedAtTrigger('tools'),

    // ----------------------------------------------------------------- logs
    `CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      cluster_id TEXT,
      method TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH')),
      endpoint TEXT NOT NULL,
      function_name TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      first_token_time INTEGER,
      base_sa_config TEXT NOT NULL,
      -- Null while the request is still running. The row is written when the
      -- request arrives rather than when it finishes, so that work in
      -- progress is visible and a request that fails before reaching a
      -- provider -- or never finishes at all -- still leaves a trace.
      -- A NULL end_time is what "still running" means.
      status INTEGER,
      end_time INTEGER,
      duration INTEGER,
      ai_provider TEXT,
      model TEXT,
      ai_provider_request_log TEXT,
      hook_logs TEXT NOT NULL,
      metadata TEXT NOT NULL,
      embedding TEXT DEFAULT NULL,
      original_system_prompt TEXT,
      cache_status TEXT CHECK (
        cache_status IS NULL OR
        cache_status IN ('HIT', 'SEMANTIC_HIT', 'MISS', 'SEMANTIC_MISS', 'REFRESH', 'DISABLED')
      ),
      -- Why it failed, when it failed before a provider answered. A failure
      -- the provider reported is in ai_provider_request_log instead.
      error TEXT,
      trace_id TEXT,
      parent_span_id TEXT,
      span_id TEXT,
      span_name TEXT,
      app_id TEXT,
      external_user_id TEXT,
      external_user_human_name TEXT,
      user_metadata TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      FOREIGN KEY (cluster_id) REFERENCES skill_optimization_clusters(id) ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_logs_agent_id ON logs(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_skill_id ON logs(skill_id)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_start_time ON logs(start_time)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_end_time ON logs(end_time)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_app_id ON logs(app_id)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_span_id ON logs(span_id)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_parent_span_id ON logs(parent_span_id)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_status ON logs(status)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_method ON logs(method)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_cache_status ON logs(cache_status)`,

    // ------------------------------------------------------------ feedbacks
    `CREATE TABLE IF NOT EXISTS feedbacks (
      id TEXT PRIMARY KEY,
      log_id TEXT NOT NULL,
      score REAL CHECK (score >= 0 AND score <= 1),
      feedback TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_feedbacks_log_id ON feedbacks(log_id)`,

    // ---------------------------------------------------- improved_responses
    `CREATE TABLE IF NOT EXISTS improved_responses (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      log_id TEXT NOT NULL,
      original_response_body TEXT NOT NULL,
      improved_response_body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_improved_responses_agent_id ON improved_responses(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_improved_responses_skill_id ON improved_responses(skill_id)`,
    `CREATE INDEX IF NOT EXISTS idx_improved_responses_log_id ON improved_responses(log_id)`,
    updatedAtTrigger('improved_responses'),

    // ---------------------------------------------------------------- cache
    `CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_cache_expires_at ON cache(expires_at)`,

    // --------------------------------------------------------- skill_models
    `CREATE TABLE IF NOT EXISTS skill_models (
      skill_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      PRIMARY KEY (skill_id, model_id),
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_skill_models_skill_id ON skill_models(skill_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_models_model_id ON skill_models(model_id)`,

    // --------------------------------------------------------- agent_models
    // The models a skill the gateway creates for the agent starts with.
    `CREATE TABLE IF NOT EXISTS agent_models (
      agent_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      PRIMARY KEY (agent_id, model_id),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_models_agent_id ON agent_models(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_models_model_id ON agent_models(model_id)`,

    // ----------------------------------------------- skill_optimization_arms
    `CREATE TABLE IF NOT EXISTS skill_optimization_arms (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      cluster_id TEXT NOT NULL,
      name TEXT NOT NULL,
      params TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      FOREIGN KEY (cluster_id) REFERENCES skill_optimization_clusters(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_arms_name ON skill_optimization_arms(name)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_arms_agent_id ON skill_optimization_arms(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_arms_skill_id ON skill_optimization_arms(skill_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_arms_cluster_id ON skill_optimization_arms(cluster_id)`,
    updatedAtTrigger('skill_optimization_arms'),

    // ---------------------------------------- skill_optimization_evaluations
    `CREATE TABLE IF NOT EXISTS skill_optimization_evaluations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      evaluation_method TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '{}',
      weight REAL NOT NULL DEFAULT 1.0,
      model_id TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
      UNIQUE (agent_id, skill_id, evaluation_method),
      CHECK (weight > 0)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_evaluations_agent_id ON skill_optimization_evaluations(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_evaluations_evaluation_method ON skill_optimization_evaluations(evaluation_method)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_evaluations_model_id ON skill_optimization_evaluations(model_id)`,
    updatedAtTrigger('skill_optimization_evaluations'),

    // ----------------------------------------- skill_optimization_arm_stats
    `CREATE TABLE IF NOT EXISTS skill_optimization_arm_stats (
      arm_id TEXT NOT NULL,
      evaluation_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      cluster_id TEXT NOT NULL,
      n INTEGER NOT NULL DEFAULT 0,
      mean REAL NOT NULL DEFAULT 0,
      n2 REAL NOT NULL DEFAULT 0,
      total_reward REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      PRIMARY KEY (arm_id, evaluation_id),
      FOREIGN KEY (arm_id) REFERENCES skill_optimization_arms(id) ON DELETE CASCADE,
      FOREIGN KEY (evaluation_id) REFERENCES skill_optimization_evaluations(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      FOREIGN KEY (cluster_id) REFERENCES skill_optimization_clusters(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_arm_stats_arm_id ON skill_optimization_arm_stats(arm_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_arm_stats_evaluation_id ON skill_optimization_arm_stats(evaluation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_arm_stats_skill_id ON skill_optimization_arm_stats(skill_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_arm_stats_cluster_id ON skill_optimization_arm_stats(cluster_id)`,
    updatedAtTrigger('skill_optimization_arm_stats'),

    // ------------------------------- skill_optimization_evaluation_runs
    `CREATE TABLE IF NOT EXISTS skill_optimization_evaluation_runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      cluster_id TEXT,
      log_id TEXT NOT NULL,
      results TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      FOREIGN KEY (cluster_id) REFERENCES skill_optimization_clusters(id) ON DELETE SET NULL,
      FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_evaluation_runs_agent_id ON skill_optimization_evaluation_runs(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_evaluation_runs_skill_id ON skill_optimization_evaluation_runs(skill_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_evaluation_runs_log_id ON skill_optimization_evaluation_runs(log_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_optimization_evaluation_runs_created_at ON skill_optimization_evaluation_runs(created_at)`,

    // --------------------------------------------------------- skill_events
    `CREATE TABLE IF NOT EXISTS skill_events (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      cluster_id TEXT,
      event_type TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      FOREIGN KEY (cluster_id) REFERENCES skill_optimization_clusters(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_skill_events_skill_id ON skill_events(skill_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_events_cluster_id ON skill_events(cluster_id) WHERE cluster_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_skill_events_type ON skill_events(event_type)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_events_created_at ON skill_events(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_events_skill_type_time ON skill_events(skill_id, event_type, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_events_cluster_time ON skill_events(cluster_id, created_at DESC) WHERE cluster_id IS NOT NULL`,

    // ------------------------------------------------------ system_settings
    // Postgres enforces the singleton with a unique index on the constant
    // expression `(true)`. SQLite cannot index a constant, so a pinned column
    // carries the same guarantee.
    //
    // The model ids are columns because the constraints on them do real work:
    // a model a setting names cannot be deleted, and the triggers below keep
    // an embedding model out of a text slot. Everything else -- timeouts,
    // the judge's token budget, developer mode -- is a JSON document typed by
    // `SystemSettingsOptions`, whose defaults fill whatever a row lacks, so a
    // new setting is a schema change there and not here.
    `CREATE TABLE IF NOT EXISTS system_settings (
      id TEXT PRIMARY KEY,
      singleton INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (singleton = 1),
      system_prompt_reflection_model_id TEXT REFERENCES models(id) ON DELETE RESTRICT,
      evaluation_generation_model_id TEXT REFERENCES models(id) ON DELETE RESTRICT,
      embedding_model_id TEXT REFERENCES models(id) ON DELETE RESTRICT,
      judge_model_id TEXT REFERENCES models(id) ON DELETE RESTRICT,
      skill_arbiter_model_id TEXT REFERENCES models(id) ON DELETE RESTRICT,
      intent_compaction_model_id TEXT REFERENCES models(id) ON DELETE RESTRICT,
      options TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    )`,
    updatedAtTrigger('system_settings'),

    // ------------------------------------------------- model type integrity
    // Postgres enforces these through `validate_system_settings_model_types`,
    // `validate_evaluation_model_type` and
    // `prevent_model_type_change_if_referenced`. Without them the libSQL
    // backend would accept configurations the Postgres one rejects.
    `CREATE TRIGGER IF NOT EXISTS system_settings_validate_model_types_insert
    BEFORE INSERT ON system_settings
    FOR EACH ROW
    BEGIN
      SELECT CASE WHEN NEW.system_prompt_reflection_model_id IS NOT NULL
        AND (SELECT model_type FROM models WHERE id = NEW.system_prompt_reflection_model_id) IS NOT 'text'
        THEN RAISE(ABORT, 'system_prompt_reflection_model_id must reference a text model') END;
      SELECT CASE WHEN NEW.evaluation_generation_model_id IS NOT NULL
        AND (SELECT model_type FROM models WHERE id = NEW.evaluation_generation_model_id) IS NOT 'text'
        THEN RAISE(ABORT, 'evaluation_generation_model_id must reference a text model') END;
      SELECT CASE WHEN NEW.judge_model_id IS NOT NULL
        AND (SELECT model_type FROM models WHERE id = NEW.judge_model_id) IS NOT 'text'
        THEN RAISE(ABORT, 'judge_model_id must reference a text model') END;
      SELECT CASE WHEN NEW.skill_arbiter_model_id IS NOT NULL
        AND (SELECT model_type FROM models WHERE id = NEW.skill_arbiter_model_id) IS NOT 'text'
        THEN RAISE(ABORT, 'skill_arbiter_model_id must reference a text model') END;
      SELECT CASE WHEN NEW.intent_compaction_model_id IS NOT NULL
        AND (SELECT model_type FROM models WHERE id = NEW.intent_compaction_model_id) IS NOT 'text'
        THEN RAISE(ABORT, 'intent_compaction_model_id must reference a text model') END;
      SELECT CASE WHEN NEW.embedding_model_id IS NOT NULL
        AND (SELECT model_type FROM models WHERE id = NEW.embedding_model_id) IS NOT 'embed'
        THEN RAISE(ABORT, 'embedding_model_id must reference an embed model') END;
    END`,
    `CREATE TRIGGER IF NOT EXISTS system_settings_validate_model_types_update
    BEFORE UPDATE ON system_settings
    FOR EACH ROW
    BEGIN
      SELECT CASE WHEN NEW.system_prompt_reflection_model_id IS NOT NULL
        AND (SELECT model_type FROM models WHERE id = NEW.system_prompt_reflection_model_id) IS NOT 'text'
        THEN RAISE(ABORT, 'system_prompt_reflection_model_id must reference a text model') END;
      SELECT CASE WHEN NEW.evaluation_generation_model_id IS NOT NULL
        AND (SELECT model_type FROM models WHERE id = NEW.evaluation_generation_model_id) IS NOT 'text'
        THEN RAISE(ABORT, 'evaluation_generation_model_id must reference a text model') END;
      SELECT CASE WHEN NEW.judge_model_id IS NOT NULL
        AND (SELECT model_type FROM models WHERE id = NEW.judge_model_id) IS NOT 'text'
        THEN RAISE(ABORT, 'judge_model_id must reference a text model') END;
      SELECT CASE WHEN NEW.skill_arbiter_model_id IS NOT NULL
        AND (SELECT model_type FROM models WHERE id = NEW.skill_arbiter_model_id) IS NOT 'text'
        THEN RAISE(ABORT, 'skill_arbiter_model_id must reference a text model') END;
      SELECT CASE WHEN NEW.intent_compaction_model_id IS NOT NULL
        AND (SELECT model_type FROM models WHERE id = NEW.intent_compaction_model_id) IS NOT 'text'
        THEN RAISE(ABORT, 'intent_compaction_model_id must reference a text model') END;
      SELECT CASE WHEN NEW.embedding_model_id IS NOT NULL
        AND (SELECT model_type FROM models WHERE id = NEW.embedding_model_id) IS NOT 'embed'
        THEN RAISE(ABORT, 'embedding_model_id must reference an embed model') END;
    END`,
    `CREATE TRIGGER IF NOT EXISTS evaluations_validate_model_type_insert
    BEFORE INSERT ON skill_optimization_evaluations
    FOR EACH ROW
    WHEN NEW.model_id IS NOT NULL
    BEGIN
      SELECT CASE WHEN (SELECT model_type FROM models WHERE id = NEW.model_id) IS NOT 'text'
        THEN RAISE(ABORT, 'evaluation model_id must reference a text model') END;
    END`,
    `CREATE TRIGGER IF NOT EXISTS evaluations_validate_model_type_update
    BEFORE UPDATE ON skill_optimization_evaluations
    FOR EACH ROW
    WHEN NEW.model_id IS NOT NULL
    BEGIN
      SELECT CASE WHEN (SELECT model_type FROM models WHERE id = NEW.model_id) IS NOT 'text'
        THEN RAISE(ABORT, 'evaluation model_id must reference a text model') END;
    END`,
    `CREATE TRIGGER IF NOT EXISTS models_prevent_type_change_if_referenced
    BEFORE UPDATE OF model_type ON models
    FOR EACH ROW
    WHEN NEW.model_type IS NOT OLD.model_type
    BEGIN
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM system_settings
        WHERE system_prompt_reflection_model_id = NEW.id
           OR evaluation_generation_model_id = NEW.id
           OR judge_model_id = NEW.id
           OR skill_arbiter_model_id = NEW.id
           OR intent_compaction_model_id = NEW.id
           OR embedding_model_id = NEW.id
      ) OR EXISTS (
        SELECT 1 FROM agents WHERE skill_arbiter_model_id = NEW.id
      ) OR EXISTS (
        SELECT 1 FROM skill_optimization_evaluations WHERE model_id = NEW.id
      ) OR EXISTS (
        SELECT 1 FROM skill_optimization_clusters WHERE embedding_model_id = NEW.id
      ) OR EXISTS (
        SELECT 1 FROM skill_routing WHERE embedding_model_id = NEW.id
      ) THEN RAISE(ABORT, 'cannot change model_type while the model is referenced') END;
    END`,

    // ------------------------------------------------------- reporting views
    // Postgres reaches into the `results` array with
    // `CROSS JOIN LATERAL jsonb_array_elements`; `json_each` is the SQLite
    // equivalent. The Postgres version uses `LEFT JOIN ... AND e.weight IS NOT
    // NULL`, which is an inner join in effect, so this joins directly.
    `CREATE VIEW IF NOT EXISTS logs_with_eval_scores AS
    SELECT
      l.*,
      (
        SELECT SUM(CAST(json_extract(result.value, '$.score') AS REAL) * e.weight)
               / NULLIF(SUM(e.weight), 0)
        FROM skill_optimization_evaluation_runs er,
             json_each(er.results) AS result
        JOIN skill_optimization_evaluations e
          ON e.id = json_extract(result.value, '$.evaluation_id')
        WHERE er.log_id = l.id
          AND json_extract(result.value, '$.score') IS NOT NULL
      ) AS avg_eval_score,
      (
        SELECT COUNT(*)
        FROM skill_optimization_evaluation_runs er
        WHERE er.log_id = l.id
      ) AS eval_run_count
    FROM logs l`,

    `CREATE VIEW IF NOT EXISTS evaluation_runs_with_scores AS
    SELECT
      er.id,
      er.agent_id,
      er.skill_id,
      er.cluster_id,
      er.log_id,
      er.created_at,
      (
        SELECT SUM(CAST(json_extract(result.value, '$.score') AS REAL) * e.weight)
               / NULLIF(SUM(e.weight), 0)
        FROM json_each(er.results) AS result
        JOIN skill_optimization_evaluations e
          ON e.id = json_extract(result.value, '$.evaluation_id')
      ) AS avg_score,
      (
        SELECT json_group_object(
                 e.evaluation_method,
                 CAST(json_extract(result.value, '$.score') AS REAL)
               )
        FROM json_each(er.results) AS result
        JOIN skill_optimization_evaluations e
          ON e.id = json_extract(result.value, '$.evaluation_id')
      ) AS scores_by_evaluation
    FROM skill_optimization_evaluation_runs er`,
  ],
};

/**
 * Mirrors `supabase/migrations/20260826000000_feedbacks_updated_at.sql`.
 *
 * `Feedback` is `.strict()` and requires `updated_at`, and
 * `FeedbackCreateParams` generates one on every create, but the table never had
 * the column on either backend. Appended rather than folded into the initial
 * schema so the two backends' migration histories stay in step.
 */
const feedbacksUpdatedAt: LibsqlMigration = {
  version: '0002_feedbacks_updated_at',
  statements: [
    `ALTER TABLE feedbacks
      ADD COLUMN updated_at TEXT NOT NULL DEFAULT (${NOW_ISO})`,
    updatedAtTrigger('feedbacks'),
  ],
};

/**
 * The Postgres initial migration seeds the singleton settings row, and
 * `getSystemSettings` returns `settings[0]` assuming it is there. The initial
 * libSQL migration created the table but not the row.
 *
 * The id is fixed rather than generated: the row is a singleton whose id is
 * never referenced by anything, and a constant keeps the migration
 * deterministic (SQLite has no uuid function).
 */
const defaultSystemSettings: LibsqlMigration = {
  version: '0003_default_system_settings',
  statements: [
    `INSERT OR IGNORE INTO system_settings (id, singleton)
     VALUES ('00000000-0000-4000-8000-000000000001', 1)`,
  ],
};

export const libsqlMigrations: LibsqlMigration[] = [
  initialSchema,
  feedbacksUpdatedAt,
  defaultSystemSettings,
];
