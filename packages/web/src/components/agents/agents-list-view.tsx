'use client';

import { botttsNeutral } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import type { Agent } from '@shared/types/data';
import { AgentStatusIndicator } from '@web/components/agents/agent-status-indicator';
import { Button } from '@web/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@web/components/ui/card';
import { Input } from '@web/components/ui/input';
import { PageHeader } from '@web/components/ui/page-header';
import { Skeleton } from '@web/components/ui/skeleton';
import { usePermissiveNavigate } from '@web/hooks/use-permissive-navigate';
import { useAgents } from '@web/providers/agents';
import { buttonLike } from '@web/utils/ui/button-like';
import { PlusIcon, SearchIcon } from 'lucide-react';
import { nanoid } from 'nanoid';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';

const createAgentAvatar = (agentName: string) => {
  const svg = createAvatar(botttsNeutral, {
    seed: agentName,
    size: 64,
    backgroundColor: [
      '00acc1',
      '039be5',
      '1e88e5',
      '43a047',
      '546e7a',
      '5e35b1',
      '6d4c41',
      '757575',
      '7cb342',
      '8e24aa',
      'c0ca33',
      'd81b60',
      'e53935',
      'f4511e',
      'fb8c00',
      'fdd835',
      'ffb300',
      '00897b',
      '3949ab',
    ],
  }).toString();
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

export function AgentsListView(): ReactElement {
  const navigate = usePermissiveNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const { agents, isLoading } = useAgents();

  const filteredAgents = useMemo(() => {
    if (!searchQuery) return agents;
    return agents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        agent.description?.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [agents, searchQuery]);

  const handleAgentSelect = (agent: Agent) => {
    navigate({ to: `/agents/${encodeURIComponent(agent.name)}` });
  };

  const handleCreateAgent = () => {
    navigate({ to: '/agents/create' });
  };

  return (
    <>
      <PageHeader
        title="Agents"
        description="Manage your AI agents"
        showBackButton={false}
        actions={
          <Button onClick={handleCreateAgent}>
            <PlusIcon className="h-4 w-4 mr-2" />
            Create Agent
          </Button>
        }
      />
      <div className="p-6 space-y-6">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search agents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5 gap-4">
            {Array.from({ length: 6 }).map(() => (
              <Card key={nanoid()}>
                <CardHeader>
                  <Skeleton className="h-12 w-12 rounded-lg" />
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="text-center py-12">
            <h3 className="text-lg font-semibold mb-2">No agents found</h3>
            <p className="text-muted-foreground mb-4">
              {searchQuery
                ? 'No agents match your search criteria.'
                : "You don't have any agents yet."}
            </p>
            {!searchQuery && (
              <Button onClick={handleCreateAgent}>
                <PlusIcon className="h-4 w-4 mr-2" />
                Create your first agent
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5 gap-4">
            {filteredAgents.map((agent) => {
              return (
                <Card
                  key={agent.id}
                  {...buttonLike({
                    onActivate: () => handleAgentSelect(agent),
                    label: `${agent.name} agent`,
                    className:
                      'cursor-pointer hover:shadow-lg hover:border-primary/50 transition-all',
                  })}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start gap-3 mb-2">
                      <img
                        src={createAgentAvatar(agent.name)}
                        alt={`${agent.name} avatar`}
                        width={48}
                        height={48}
                        className="rounded-lg shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base truncate leading-normal mb-1">
                          {agent.name}
                        </CardTitle>
                        <AgentStatusIndicator
                          agent={agent}
                          variant="badge"
                          tooltipSide="top"
                        />
                      </div>
                    </div>
                    <CardDescription className="line-clamp-3 text-sm">
                      {agent.description || 'No description available'}
                    </CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
