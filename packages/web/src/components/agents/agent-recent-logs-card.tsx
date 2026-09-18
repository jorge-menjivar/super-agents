'use client';

import { LogTagBadge } from '@web/components/agents/log-cells';
import { RecentLogsTable } from '@web/components/agents/recent-logs-table';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@web/components/ui/card';
import { Skeleton } from '@web/components/ui/skeleton';
import { usePermissiveNavigate } from '@web/hooks/use-permissive-navigate';
import { useRecentLogs } from '@web/hooks/use-recent-logs';
import { useAgents } from '@web/providers/agents';
import { useSkills } from '@web/providers/skills';
import { FileTextIcon } from 'lucide-react';
import { nanoid } from 'nanoid';
import type { ReactElement } from 'react';

/**
 * The agent dashboard's counterpart of the skill dashboard's "Recent
 * requests" card: the agent's latest logs across all of its skills, opening
 * the agent-wide logs page.
 */
export function AgentRecentLogsCard(): ReactElement | null {
  const navigate = usePermissiveNavigate();
  const { selectedAgent } = useAgents();
  const { skills } = useSkills();
  const { logs: recentLogs, isLoading } = useRecentLogs({
    agentId: selectedAgent?.id,
  });

  if (!selectedAgent) {
    return null;
  }

  return (
    <Card
      className="cursor-pointer hover:shadow-lg hover:border-primary/50 transition-all"
      onClick={() =>
        navigate({
          to: `/agents/${encodeURIComponent(selectedAgent.name)}/logs`,
        })
      }
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base font-medium">Logs</CardTitle>
          <CardDescription>Recent requests across all skills</CardDescription>
        </div>
        <FileTextIcon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-1">
            {Array.from({ length: 5 }).map(() => (
              <Skeleton key={nanoid()} className="h-8 w-full" />
            ))}
          </div>
        ) : recentLogs.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No logs available</p>
        ) : (
          <div className="m-4 border rounded-lg overflow-hidden">
            <RecentLogsTable
              logs={recentLogs}
              context={{
                header: 'Skill',
                render: (log) => (
                  <LogTagBadge
                    value={
                      skills.find((skill) => skill.id === log.skill_id)?.name
                    }
                    missing={
                      log.skill_id === null && log.end_time === null
                        ? 'routing…'
                        : '—'
                    }
                  />
                ),
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
