-- Migration: System settings, model types, and related schema changes
-- This consolidated migration includes:
-- 1. system_settings table for configuring internal operation models
-- 2. model_type enum and columns on models table
-- 3. Validation functions for model types in system_settings
-- 4. model_id column on skill_optimization_evaluations
-- 5. developer_mode setting
-- 6. embedding_model_id on skill_optimization_clusters

-- ============================================================================
-- PART 1: Create system_settings table (singleton - only one row allowed)
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  -- Model settings for internal operations
  -- ON DELETE RESTRICT prevents deleting models that are in use by settings
  system_prompt_reflection_model_id UUID REFERENCES models(id) ON DELETE RESTRICT,
  evaluation_generation_model_id UUID REFERENCES models(id) ON DELETE RESTRICT,
  embedding_model_id UUID REFERENCES models(id) ON DELETE RESTRICT,
  judge_model_id UUID REFERENCES models(id) ON DELETE RESTRICT,
  -- The skill arbiter: the model that decides whether a request no skill
  -- matches closely is a new kind of job (NULL defers to the reflection model)
  skill_arbiter_model_id UUID REFERENCES models(id) ON DELETE RESTRICT,
  -- Intent compaction: the model that summarises a system prompt too long to
  -- embed whole before routing embeds it (NULL defers to the reflection model)
  intent_compaction_model_id UUID REFERENCES models(id) ON DELETE RESTRICT,
  -- Everything that needs no column of its own: the timeout beside each
  -- model, the judge's token budget, developer mode. The model ids are
  -- columns because the database does real work for them (the RESTRICT above,
  -- the type triggers below); nothing in the database interprets these, so
  -- they are one JSON document typed by `SystemSettingsOptions` in shared,
  -- whose defaults fill whatever a row lacks. Adding a setting is a change
  -- there and to the form, not to this table.
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add updated_at trigger
CREATE TRIGGER system_settings_updated_at
  BEFORE UPDATE ON system_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Ensure only one row can exist (singleton pattern)
CREATE UNIQUE INDEX system_settings_singleton ON system_settings ((true));

-- Insert default row with NULL values (will use env var fallback until configured)
INSERT INTO system_settings (id) VALUES (extensions.uuid_generate_v4());

-- Add RLS policies
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on system_settings"
  ON system_settings
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- PART 2: Add model_type and embedding_dimensions columns to models table
-- ============================================================================

-- Create enum type for model types
CREATE TYPE model_type AS ENUM ('text', 'embed');

-- Add model_type column with default 'text'
ALTER TABLE models
ADD COLUMN model_type model_type NOT NULL DEFAULT 'text';

-- Add embedding_dimensions column (only relevant for embed models)
ALTER TABLE models
ADD COLUMN embedding_dimensions INTEGER NULL;

-- Add check constraint: embedding_dimensions should only be set for embed models
ALTER TABLE models
ADD CONSTRAINT embedding_dimensions_only_for_embed
CHECK (
  (model_type = 'embed' AND embedding_dimensions IS NOT NULL) OR
  (model_type = 'text' AND embedding_dimensions IS NULL)
);

-- ============================================================================
-- PART 3: Validation functions for model types
-- ============================================================================

-- Create a function to validate model type
CREATE OR REPLACE FUNCTION check_model_type(model_id UUID, expected_type public.model_type)
RETURNS BOOLEAN AS $$
DECLARE
  actual_type public.model_type;
BEGIN
  IF model_id IS NULL THEN
    RETURN TRUE;
  END IF;

  SELECT m.model_type INTO actual_type FROM public.models m WHERE m.id = model_id;

  IF actual_type IS NULL THEN
    RETURN FALSE; -- Model doesn't exist
  END IF;

  RETURN actual_type = expected_type;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = '';

-- Create trigger function to validate system_settings model types
CREATE OR REPLACE FUNCTION validate_system_settings_model_types()
RETURNS TRIGGER AS $$
BEGIN
  -- Validate embedding_model_id must be an embed model
  IF NOT public.check_model_type(NEW.embedding_model_id, 'embed') THEN
    RAISE EXCEPTION 'embedding_model_id must reference an embed model';
  END IF;

  -- Validate system_prompt_reflection_model_id must be a text model
  IF NOT public.check_model_type(NEW.system_prompt_reflection_model_id, 'text') THEN
    RAISE EXCEPTION 'system_prompt_reflection_model_id must reference a text model';
  END IF;

  -- Validate evaluation_generation_model_id must be a text model
  IF NOT public.check_model_type(NEW.evaluation_generation_model_id, 'text') THEN
    RAISE EXCEPTION 'evaluation_generation_model_id must reference a text model';
  END IF;

  -- Validate judge_model_id must be a text model
  IF NOT public.check_model_type(NEW.judge_model_id, 'text') THEN
    RAISE EXCEPTION 'judge_model_id must reference a text model';
  END IF;

  -- Validate skill_arbiter_model_id must be a text model
  IF NOT public.check_model_type(NEW.skill_arbiter_model_id, 'text') THEN
    RAISE EXCEPTION 'skill_arbiter_model_id must reference a text model';
  END IF;

  -- Validate intent_compaction_model_id must be a text model
  IF NOT public.check_model_type(NEW.intent_compaction_model_id, 'text') THEN
    RAISE EXCEPTION 'intent_compaction_model_id must reference a text model';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- Create trigger on system_settings
CREATE TRIGGER system_settings_model_type_validation
  BEFORE INSERT OR UPDATE ON system_settings
  FOR EACH ROW
  EXECUTE FUNCTION validate_system_settings_model_types();

-- Also prevent changing a model's type if it's referenced in system_settings
CREATE OR REPLACE FUNCTION prevent_model_type_change_if_referenced()
RETURNS TRIGGER AS $$
BEGIN
  -- Only check if model_type is being changed
  IF OLD.model_type = NEW.model_type THEN
    RETURN NEW;
  END IF;

  -- Check if this model is referenced in system_settings
  IF EXISTS (
    SELECT 1 FROM public.system_settings
    WHERE embedding_model_id = NEW.id
       OR system_prompt_reflection_model_id = NEW.id
       OR evaluation_generation_model_id = NEW.id
       OR judge_model_id = NEW.id
       OR skill_arbiter_model_id = NEW.id
       OR intent_compaction_model_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Cannot change model_type for a model that is referenced in system_settings';
  END IF;

  -- A model an agent named for itself has to stay a text model too
  IF EXISTS (
    SELECT 1 FROM public.agents
    WHERE skill_arbiter_model_id = NEW.id
       OR intent_compaction_model_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Cannot change model_type for a model that an agent asks for itself';
  END IF;

  -- Skill routing centroids only mean something under the model that computed them
  IF EXISTS (
    SELECT 1 FROM public.skill_routing
    WHERE embedding_model_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Cannot change model_type for a model that skill routing centroids were computed with';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- Create trigger on models
CREATE TRIGGER models_prevent_type_change_if_referenced
  BEFORE UPDATE ON models
  FOR EACH ROW
  EXECUTE FUNCTION prevent_model_type_change_if_referenced();

-- ============================================================================
-- PART 4: Add model_id to skill_optimization_evaluations table
-- ============================================================================

-- Add model_id column (nullable for backwards compatibility, but should be set for new evaluations)
-- CASCADE delete: if the model is deleted, evaluations using it are also deleted
ALTER TABLE skill_optimization_evaluations
ADD COLUMN model_id UUID REFERENCES models(id) ON DELETE CASCADE;

-- Create index for model_id
CREATE INDEX idx_skill_optimization_evaluations_model_id ON skill_optimization_evaluations(model_id);

-- Create trigger function to validate model type is 'text' for evaluations
CREATE OR REPLACE FUNCTION validate_evaluation_model_type()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow NULL model_id
  IF NEW.model_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Validate model_id must be a text model
  IF NOT public.check_model_type(NEW.model_id, 'text') THEN
    RAISE EXCEPTION 'evaluation model_id must reference a text model';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- Create trigger on skill_optimization_evaluations
CREATE TRIGGER skill_optimization_evaluations_model_type_validation
  BEFORE INSERT OR UPDATE ON skill_optimization_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION validate_evaluation_model_type();

COMMENT ON COLUMN skill_optimization_evaluations.model_id IS 'The model used to run this evaluation. Must be a text model.';

-- ============================================================================
-- PART 5: Add embedding_model_id to skill_optimization_clusters
-- ============================================================================

-- Each cluster stores a reference to the embedding model used for its centroids
-- This allows clusters to have different embedding dimensions
ALTER TABLE skill_optimization_clusters
ADD COLUMN IF NOT EXISTS embedding_model_id UUID REFERENCES models(id) ON DELETE CASCADE;

-- Add index for the foreign key
CREATE INDEX IF NOT EXISTS idx_skill_optimization_clusters_embedding_model_id
ON skill_optimization_clusters(embedding_model_id);

COMMENT ON COLUMN skill_optimization_clusters.embedding_model_id IS 'The embedding model used for computing centroids in this cluster';

-- ============================================================================
-- PART 6: Skill routing
-- ============================================================================

-- Where an agent's requests go when the caller names only the agent
-- (`/v1/agents/:agent_name/chat/completions`). One row per skill: a running
-- mean of the intent embeddings of the requests it has served, seeded from its
-- description. The FK to models cascades because a centroid from one embedding
-- model means nothing under another; the row is re-seeded on the next request.
CREATE TABLE IF NOT EXISTS skill_routing (
  skill_id UUID PRIMARY KEY REFERENCES skills(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  centroid FLOAT[] NOT NULL,
  conversation_centroid FLOAT[],
  embedding_model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  sample_count INTEGER NOT NULL DEFAULT 0,
  conversation_sample_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_skill_routing_updated_at BEFORE UPDATE ON skill_routing
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_skill_routing_agent_id ON skill_routing(agent_id);
CREATE INDEX IF NOT EXISTS idx_skill_routing_embedding_model_id ON skill_routing(embedding_model_id);

ALTER TABLE skill_routing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on skill_routing"
  ON skill_routing
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE skill_routing IS 'Per-skill running mean of request intent embeddings, used to pick a skill when a request names only the agent';

-- Serialises the skills the gateway creates for one agent. A request that
-- resembles none of the agent's skills takes the lease before creating one and
-- looks at the skills again once it holds it, so concurrent first requests do
-- not each create a skill. `lease_until` is NULL while the lease is free, and
-- a lease past its time counts as free, in case its holder died. `holder` is a
-- token the claimant coins, which is how it tells that the claim was its own
-- and how it releases only its own lease.
CREATE TABLE IF NOT EXISTS skill_creation_leases (
  agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  holder TEXT,
  lease_until TIMESTAMPTZ
);

ALTER TABLE skill_creation_leases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on skill_creation_leases"
  ON skill_creation_leases
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE skill_creation_leases IS 'Per-agent lease held by the request creating a skill, so concurrent requests do not each create one';

-- ============================================================================
-- PART 7: Per-agent overrides for the models asked on its behalf
-- ============================================================================

-- An agent may choose its own arbiter and compaction models, and a timeout
-- for each; NULL means the system setting applies. A deleted model falls back
-- rather than blocking the delete, unlike the system settings, which RESTRICT.
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS skill_arbiter_model_id UUID REFERENCES models(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS skill_arbiter_timeout_ms INTEGER CHECK (skill_arbiter_timeout_ms IS NULL OR skill_arbiter_timeout_ms > 0),
ADD COLUMN IF NOT EXISTS intent_compaction_model_id UUID REFERENCES models(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS intent_compaction_timeout_ms INTEGER CHECK (intent_compaction_timeout_ms IS NULL OR intent_compaction_timeout_ms > 0),
ADD COLUMN IF NOT EXISTS intent_compaction_reasoning_effort TEXT CHECK (intent_compaction_reasoning_effort IS NULL OR intent_compaction_reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high'));

CREATE INDEX IF NOT EXISTS idx_agents_skill_arbiter_model_id ON agents(skill_arbiter_model_id);
CREATE INDEX IF NOT EXISTS idx_agents_intent_compaction_model_id ON agents(intent_compaction_model_id);

COMMENT ON COLUMN agents.skill_arbiter_model_id IS 'The model the skill arbiter asks for this agent; NULL means the system setting';
COMMENT ON COLUMN agents.skill_arbiter_timeout_ms IS 'How long one arbiter attempt may take for this agent, in milliseconds; NULL means the system setting';
COMMENT ON COLUMN agents.intent_compaction_model_id IS 'The model that compacts an over-long system prompt before this agent routes by it; NULL means the system setting';
COMMENT ON COLUMN agents.intent_compaction_timeout_ms IS 'How long one compaction attempt may take for this agent, in milliseconds; NULL means the system setting';
COMMENT ON COLUMN agents.intent_compaction_reasoning_effort IS 'How hard the compaction model may think for this agent; NULL means the system setting';

CREATE OR REPLACE FUNCTION validate_agent_model_types()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT public.check_model_type(NEW.skill_arbiter_model_id, 'text') THEN
    RAISE EXCEPTION 'skill_arbiter_model_id must reference a text model';
  END IF;

  IF NOT public.check_model_type(NEW.intent_compaction_model_id, 'text') THEN
    RAISE EXCEPTION 'intent_compaction_model_id must reference a text model';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

CREATE TRIGGER agents_model_type_validation
  BEFORE INSERT OR UPDATE ON agents
  FOR EACH ROW
  EXECUTE FUNCTION validate_agent_model_types();
