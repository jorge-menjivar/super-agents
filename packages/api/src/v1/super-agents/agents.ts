import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext, AppEnv } from '@api/types/hono';
import { parseDatabaseError } from '@api/utils/database-error';
import { emitSSEEvent } from '@api/utils/sse-event-manager';
import { adoptDefaultModels } from '@api/utils/super-agents/skill-creation';
import { zValidator } from '@hono/zod-validator';
import {
  AgentCreateParams,
  AgentQueryParams,
  AgentUpdateParams,
} from '@shared/types/data';
import { Hono } from 'hono';
import { z } from 'zod';

/**
 * Why `reviewer_agent_id` cannot be set as asked, or null when it can. Both
 * schemas refuse the two cases as well; this is the readable answer.
 */
async function reviewerProblem(
  c: AppContext,
  connector: UserDataStorageConnector,
  reviewerId: string | null | undefined,
  agentId?: string,
): Promise<string | null> {
  if (!reviewerId) {
    return null;
  }
  if (reviewerId === agentId) {
    return 'An agent cannot be its own reviewer.';
  }
  const reviewers = await connector.getAgents(c, { id: reviewerId });
  return reviewers.length > 0 ? null : 'The reviewer agent does not exist.';
}

export const agentsRouter = new Hono<AppEnv>()
  .post('/', zValidator('json', AgentCreateParams), async (c) => {
    try {
      const data = c.req.valid('json');
      const connector = c.get('user_data_storage_connector');

      const problem = await reviewerProblem(
        c,
        connector,
        data.reviewer_agent_id,
      );
      if (problem) {
        return c.json({ error: problem }, 400);
      }

      const newAgent = await connector.createAgent(c, data);

      return c.json(newAgent, 201);
    } catch (error) {
      console.error('Error creating agent:', error);
      const errorInfo = parseDatabaseError(error);
      return c.json({ error: errorInfo.message }, errorInfo.statusCode);
    }
  })
  .get('/', zValidator('query', AgentQueryParams), async (c) => {
    try {
      const query = c.req.valid('query');
      const connector = c.get('user_data_storage_connector');

      const agents = await connector.getAgents(c, query);

      return c.json(agents, 200);
    } catch (error) {
      console.error('Error fetching agents:', error);
      const errorInfo = parseDatabaseError(error);
      return c.json({ error: errorInfo.message }, errorInfo.statusCode);
    }
  })
  .patch(
    '/:agentId',
    zValidator('param', z.object({ agentId: z.uuid() })),
    zValidator('json', AgentUpdateParams),
    async (c) => {
      try {
        const { agentId } = c.req.valid('param');
        const data = c.req.valid('json');
        const connector = c.get('user_data_storage_connector');

        const problem = await reviewerProblem(
          c,
          connector,
          data.reviewer_agent_id,
          agentId,
        );
        if (problem) {
          return c.json({ error: problem }, 400);
        }

        const updatedAgent = await connector.updateAgent(c, agentId, data);

        // Emit SSE event for agent update
        emitSSEEvent('agent:updated', {
          agentId: updatedAgent.id,
        });

        return c.json(updatedAgent, 200);
      } catch (error) {
        console.error('Error updating agent:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .delete(
    '/:agentId',
    zValidator('param', z.object({ agentId: z.uuid() })),
    async (c) => {
      try {
        const { agentId } = c.req.valid('param');
        const connector = c.get('user_data_storage_connector');

        await connector.deleteAgent(c, agentId);

        return c.body(null, 204);
      } catch (error) {
        console.error('Error deleting agent:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .get(
    '/:agentId/skills',
    zValidator(
      'param',
      z.object({
        agentId: z.uuid(),
      }),
    ),
    async (c) => {
      try {
        const { agentId } = c.req.valid('param');
        const connector = c.get('user_data_storage_connector');

        const skills = await connector.getSkills(c, { agent_id: agentId });

        return c.json(skills, 200);
      } catch (error) {
        console.error('Error fetching skills:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  // The agent's default models: what a skill the gateway creates for it
  // starts with. Same shape as the skill's own model routes.
  .get(
    '/:agentId/models',
    zValidator('param', z.object({ agentId: z.uuid() })),
    async (c) => {
      try {
        const { agentId } = c.req.valid('param');
        const connector = c.get('user_data_storage_connector');

        const models = await connector.getAgentModels(c, agentId);

        return c.json(models, 200);
      } catch (error) {
        console.error('Error fetching agent models:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .post(
    '/:agentId/models',
    zValidator('param', z.object({ agentId: z.uuid() })),
    zValidator('json', z.object({ modelIds: z.array(z.uuid()) })),
    async (c) => {
      try {
        const { agentId } = c.req.valid('param');
        const { modelIds } = c.req.valid('json');
        const connector = c.get('user_data_storage_connector');

        const agents = await connector.getAgents(c, { id: agentId });
        if (agents.length === 0) {
          return c.json({ error: 'Agent not found' }, 404);
        }

        await connector.addModelsToAgent(c, agentId, modelIds);
        // The skills the gateway created while the agent had no defaults
        // have been waiting for exactly these.
        await adoptDefaultModels(c, connector, agents[0], modelIds);

        return c.json({ success: true }, 201);
      } catch (error) {
        console.error('Error adding models to agent:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .delete(
    '/:agentId/models',
    zValidator('param', z.object({ agentId: z.uuid() })),
    zValidator(
      'query',
      z.object({
        ids: z
          .string()
          .or(z.array(z.string()))
          .transform((val) =>
            typeof val === 'string'
              ? val.split(',').map((id) => id.trim())
              : val,
          ),
      }),
    ),
    async (c) => {
      try {
        const { agentId } = c.req.valid('param');
        const { ids } = c.req.valid('query');
        const connector = c.get('user_data_storage_connector');

        await connector.removeModelsFromAgent(c, agentId, ids);

        return c.json({ success: true }, 200);
      } catch (error) {
        console.error('Error removing models from agent:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  // Where the agent's requests go when the caller names only the agent: one
  // row per skill the router has met. Read-only; the router writes them.
  .get(
    '/:agentId/skill-routings',
    zValidator('param', z.object({ agentId: z.uuid() })),
    async (c) => {
      try {
        const { agentId } = c.req.valid('param');
        const connector = c.get('user_data_storage_connector');

        const routings = await connector.getSkillRoutings(c, {
          agent_id: agentId,
        });

        return c.json(routings, 200);
      } catch (error) {
        console.error('Error fetching agent skill routings:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .get(
    '/:agentId/evaluation-runs',
    zValidator('param', z.object({ agentId: z.uuid() })),
    zValidator(
      'query',
      z.object({
        log_id: z.uuid().optional(),
        created_after: z.string().datetime().optional(),
        created_before: z.string().datetime().optional(),
      }),
    ),
    async (c) => {
      try {
        const { agentId } = c.req.valid('param');
        const { log_id, created_after, created_before } = c.req.valid('query');
        const connector = c.get('user_data_storage_connector');

        const evaluationRuns =
          await connector.getSkillOptimizationEvaluationRuns(c, {
            agent_id: agentId,
            ...(log_id && { log_id }),
            ...(created_after && { created_after }),
            ...(created_before && { created_before }),
          });

        return c.json(evaluationRuns);
      } catch (error) {
        console.error('Error getting evaluation runs:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .post(
    '/:agentId/evaluation-scores-by-time-bucket',
    zValidator('param', z.object({ agentId: z.uuid() })),
    zValidator(
      'json',
      z.object({
        interval_minutes: z.number().min(1).max(1440),
        start_time: z.string().datetime(),
        end_time: z.string().datetime(),
      }),
    ),
    async (c) => {
      try {
        const { agentId } = c.req.valid('param');
        const { interval_minutes, start_time, end_time } = c.req.valid('json');
        const connector = c.get('user_data_storage_connector');

        const scores = await connector.getEvaluationScoresByTimeBucket(c, {
          agent_id: agentId,
          interval_minutes,
          start_time,
          end_time,
        });

        return c.json(scores);
      } catch (error) {
        console.error('Error getting evaluation scores by time bucket:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  );
