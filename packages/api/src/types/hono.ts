import type {
  CacheStorageConnector,
  EvaluationMethodConnector,
  HooksConnector,
  LogsStorageConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { SkillRoutingDecision } from '@api/utils/super-agents/skill-routing';
import type { SuperAgentsRequestData } from '@shared/types/api/request';
import type {
  SuperAgentsConfig,
  SuperAgentsConfigPreProcessed,
} from '@shared/types/api/request/headers';
import type { SuperAgentsResponseBody } from '@shared/types/api/response';
import type { SkillOptimizationArm } from '@shared/types/data';
import type { Agent } from '@shared/types/data/agent';
import type {
  AIProviderRequestLog,
  HookLog,
  LogsClient,
} from '@shared/types/data/log';
import type { Skill } from '@shared/types/data/skill';
import type { EvaluationMethodName } from '@shared/types/evaluations';
import type {
  CacheSettings,
  GetFromCacheResult,
} from '@shared/types/middleware/cache';
import type { Hook, HookType } from '@shared/types/middleware/hooks';
import type { Context, Hono } from 'hono';
import type { JWTPayload } from 'hono/utils/jwt/types';

export interface AppEnv {
  Bindings: {
    ACCESS_PASSWORD?: string;
    AI_PROVIDER_API_KEY_ENCRYPTION_KEY?: string;
    API_URL?: string;
    AUTH_JWT_SECRET?: string;
    BEARER_TOKEN?: string;
    LIBSQL_AUTH_TOKEN?: string;
    LIBSQL_URL?: string;
    /** Set by the Node entrypoint; absent on Workers. */
    PORT?: string;
    NODE_ENV?: string;
    POSTGREST_SERVICE_ROLE_KEY?: string;
    POSTGREST_URL?: string;
    SUPABASE_SECRET_KEY?: string;
    SUPABASE_URL?: string;
    WEB_APP_URL?: string;
  };
  Variables: {
    /**
     * Set by the `jwt` middleware when the dashboard session cookie
     * authenticated the request; absent for a bearer-token caller. Hono types
     * its own ambient entry as `unknown`, so the shape is named here.
     */
    jwtPayload?: JWTPayload & { sub?: string };
    sa_config: SuperAgentsConfig;
    sa_config_pre_processed: SuperAgentsConfigPreProcessed;
    sa_request_data: SuperAgentsRequestData;
    embedding: number[] | null;
    agent: Agent;
    skill: Skill;
    pulled_arm?: SkillOptimizationArm;
    /** Set when the caller named only the agent and the gateway chose the skill. */
    skill_routing?: SkillRoutingDecision;
    /**
     * Identifies this request to the in-flight registry, so the dashboard can
     * pair the pending row it drew on arrival with the news that the request
     * has finished. Set by the logs middleware before the handler runs.
     */
    log_request_id?: string;
    /** When the request arrived, shared by the row opened then and its completion. */
    log_start_time?: number;
    ai_provider_log?: AIProviderRequestLog;
    hook_logs?: HookLog[];
    first_token_time?: number;
    stream_end_time?: number;
    /**
     * When the provider was asked, and when it had answered, for the attempt
     * whose answer is being served; the log row's own times span the whole
     * request. Set around the provider call, and kept on the provider log.
     */
    provider_start_time?: number;
    provider_end_time?: number;
    stream_end_promise?: Promise<void>;
    accumulated_stream_chunks?: string;
    cache_storage_connector: CacheStorageConnector;
    logs_storage_connector: LogsStorageConnector;
    user_data_storage_connector: UserDataStorageConnector;
    websocket_error?: boolean;
    addLogsClient: (clientId: string, client: LogsClient) => void;
    removeLogsClient: (clientId: string) => void;
    hooks_connectors_map: Record<string, HooksConnector>;
    evaluation_connectors_map: Record<
      EvaluationMethodName,
      EvaluationMethodConnector
    >;

    executeHooks: (
      c: AppContext,
      hookType: HookType,
      statusCode: number | null,
      isStreamingRequest: boolean,
      saRequestData: SuperAgentsRequestData,
      saResponseBody?: SuperAgentsResponseBody,
    ) => Promise<HookLog[]>;
    getAIProviderResponseFromCache: (
      c: AppContext,
      cacheSettings: CacheSettings,
      saRequestData: SuperAgentsRequestData,
    ) => Promise<GetFromCacheResult>;
    getHookResponseFromCache: (
      c: AppContext,
      hook: Hook,
      saRequestData: SuperAgentsRequestData,
      saResponseBody?: SuperAgentsResponseBody,
    ) => Promise<GetFromCacheResult>;
    putHookResponsesInCache: (
      c: AppContext,
      hookLogs: HookLog[],
    ) => Promise<void>;
  };
}

export interface AppContext extends Context<AppEnv> {}

export interface AppHono extends Hono<AppEnv, { [k: string]: never }, '/v1'> {}
