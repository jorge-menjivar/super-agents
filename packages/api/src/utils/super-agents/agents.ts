import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import type { Agent } from '@shared/types/data/agent';

export async function getAgent(
  c: AppContext,
  userDataStorageConnector: UserDataStorageConnector,
  agentName: string,
): Promise<Agent | null> {
  const agents = await userDataStorageConnector.getAgents(c, {
    name: agentName,
  });
  if (agents.length > 0) {
    return agents[0];
  } else {
    if (agentName === 'super-agents') {
      // Auto create the super-agents agent if it doesn't exist
      const newAgent = await userDataStorageConnector.createAgent(c, {
        name: agentName,
        description: 'The Super Agents internal agent',
        metadata: {},
        // Its skills are the internal ones, named explicitly by every call.
        auto_create_skills: false,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 0,
        review_fail_closed: false,
        review_expose_reason: false,
      });
      return newAgent;
    }
    return null;
  }
}
