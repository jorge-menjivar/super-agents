import { initializeModelCapabilities } from '@api/ai-providers/initialize-capabilities';
import {
  resolveCacheConnector,
  resolveLogsConnector,
  resolveUserDataConnector,
} from '@api/connectors';
// import { argumentCorrectnessEvaluationConnector } from '@api/connectors/evaluations/argument-correctness';
import { conversationCompletenessEvaluationConnector } from '@api/connectors/evaluations/conversation-completeness';
import { knowledgeRetentionEvaluationConnector } from '@api/connectors/evaluations/knowledge-retention';
import { latencyEvaluationConnector } from '@api/connectors/evaluations/latency/latency';
// import { roleAdherenceEvaluationConnector } from '@api/connectors/evaluations/role-adherence';
import { taskCompletionEvaluationConnector } from '@api/connectors/evaluations/task-completion';
import { toolCorrectnessEvaluationConnector } from '@api/connectors/evaluations/tool-correctness';
import { turnRelevancyEvaluationConnector } from '@api/connectors/evaluations/turn-relevancy';
import { agentHooksConnector } from '@api/connectors/hooks/agent';
import { getAllowedOrigins } from '@api/constants';
import { agentAndSkillMiddleware } from '@api/middlewares/agent-and-skill';
import { authenticatedMiddleware } from '@api/middlewares/auth';
import { cacheMiddleware } from '@api/middlewares/cache';
import { evaluationMethodConnectors } from '@api/middlewares/evaluations';
import { hooksMiddleware } from '@api/middlewares/hooks';
import { logsMiddleware } from '@api/middlewares/logs';
import { saConfigurationInjectorMiddleware } from '@api/middlewares/super-agents-configuration';
import { toolMiddleware } from '@api/middlewares/tool';
import { userDataMiddleware } from '@api/middlewares/user-data';
import { commonVariablesMiddleware } from '@api/middlewares/variables';
import type { AppContext, AppEnv, AppHono } from '@api/types/hono';
import { chatRouter } from '@api/v1/chat';
import { completionsRouter } from '@api/v1/completions';
import { embeddingsRouter } from '@api/v1/embeddings';
import { responsesRouter } from '@api/v1/responses';
import { superAgentsRouter } from '@api/v1/super-agents';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createFactory } from 'hono/factory';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';

const factory = createFactory<AppEnv>();

/** Path prefix that scopes a gateway request to an agent and one of its skills. */
const AGENT_SKILL_BASE_PATH = '/agents/:agent_name/skills/:skill_name';
/** Path prefix that scopes a gateway request to an agent, leaving the skill to the gateway. */
const AGENT_BASE_PATH = '/agents/:agent_name';

// Lazy initialization of model capabilities (Cloudflare Workers can't do this at module load time)
let modelCapabilitiesInitialized = false;

const app: AppHono = new Hono<AppEnv>().basePath('/v1');

// Initialize model capabilities on first request
app.use('*', async (_c, next) => {
  if (!modelCapabilitiesInitialized) {
    initializeModelCapabilities();
    modelCapabilitiesInitialized = true;
  }
  await next();
});

app.get('/', (c) => c.text('Super Agents'));

app.use('*', logger());

// CORS middleware for cross-origin requests from the web app
app.use(
  '*',
  cors({
    // `origin` receives the request context, so the allowed list is resolved
    // per request rather than captured at module load.
    origin: (origin, c) =>
      getAllowedOrigins(c as AppContext).includes(origin) ? origin : null,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'sa-config'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

// Use prettyJSON middleware for all routes
app.use('*', prettyJSON());

// Keep this middleware before the other middlewares
// so that the common variables are available to the other middlewares
app.use('*', commonVariablesMiddleware);

// Keep this middleware before agent and skill middleware
// Use user data middleware for all routes
app.use('*', userDataMiddleware(factory, resolveUserDataConnector));

// Use logs middleware for all routes
// Runs skill optimizer after processing logs
app.use('*', logsMiddleware(factory, resolveLogsConnector));

// Use hooks middleware for all routes
app.use('*', hooksMiddleware(factory, [agentHooksConnector]));

// Use evaluation middleware for all routes
app.use(
  '*',
  evaluationMethodConnectors(factory, [
    // argumentCorrectnessEvaluationConnector,
    conversationCompletenessEvaluationConnector,
    knowledgeRetentionEvaluationConnector,
    latencyEvaluationConnector,
    // roleAdherenceEvaluationConnector,
    taskCompletionEvaluationConnector,
    toolCorrectnessEvaluationConnector,
    turnRelevancyEvaluationConnector,
  ]),
);

// Use cache middleware for all routes
app.use('*', cacheMiddleware(factory, resolveCacheConnector));

// Use authenticated middleware for all routes
app.use('*', authenticatedMiddleware(factory));

// Use agent and skill middleware for all routes
app.use('*', agentAndSkillMiddleware);

// Use Super Agents configuration injector middleware for all routes
app.use('*', saConfigurationInjectorMiddleware);

// Use tool middleware for all routes
app.use(toolMiddleware);

app.route('/chat', chatRouter);
app.route('/completions', completionsRouter);
app.route('/responses', responsesRouter);
app.route('/embeddings', embeddingsRouter);

// The same endpoints scoped to an agent and a skill through the path, so that
// OpenAI-compatible clients can point their base URL at a single skill instead
// of sending the names in the `sa-config` header.
app.route(`${AGENT_SKILL_BASE_PATH}/chat`, chatRouter);
app.route(`${AGENT_SKILL_BASE_PATH}/completions`, completionsRouter);
app.route(`${AGENT_SKILL_BASE_PATH}/responses`, responsesRouter);
app.route(`${AGENT_SKILL_BASE_PATH}/embeddings`, embeddingsRouter);
// And to an agent alone, with the skill picked per request by
// `agentAndSkillMiddleware`.
app.route(`${AGENT_BASE_PATH}/chat`, chatRouter);
app.route(`${AGENT_BASE_PATH}/completions`, completionsRouter);
app.route(`${AGENT_BASE_PATH}/responses`, responsesRouter);
app.route(`${AGENT_BASE_PATH}/embeddings`, embeddingsRouter);
const superAgentsRoute = app.route('/super-agents', superAgentsRouter);

export type SuperAgentsRoute = typeof superAgentsRoute;

// Export the app for Cloudflare Workers
export default app;
