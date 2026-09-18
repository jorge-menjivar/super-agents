'use client';

import { isSkillReady } from '@shared/utils/skill-validation';
import { Button } from '@web/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@web/components/ui/card';
import { Skeleton } from '@web/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@web/components/ui/tooltip';
import { usePermissiveNavigate } from '@web/hooks/use-permissive-navigate';
import { useRecentSkills } from '@web/hooks/use-recent-skills';
import { useAgentSkillReadiness } from '@web/hooks/use-skill-readiness';
import { useAgents } from '@web/providers/agents';
import { useNavigation } from '@web/providers/navigation';
import { createSkillAvatar } from '@web/utils/avatars';
import { formatLogTimestamp, formatTimeAgo } from '@web/utils/time';
import { AlertCircle, LayersIcon, PlusIcon } from 'lucide-react';
import { nanoid } from 'nanoid';
import type { ReactElement } from 'react';

/**
 * The agent's skills, beside its chart: the five it used most recently, each
 * opening its own dashboard.
 *
 * The skills themselves live on their own page -- fifteen of them under a
 * chart of the same data was what made this one slow -- so what stays here is
 * the part a reader looking at the agent wants without leaving: which skills
 * are actually serving, and when each last did.
 *
 * Nothing here reads the skill rows. The count and the readiness marks come
 * from the readiness answer the sidebar already asked for, and the list from
 * the logs; a skill row carries the system prompt the gateway seeded it with,
 * which is most of a page of skills and nothing this card draws.
 */
export function AgentSkillsCard(): ReactElement | null {
  const { selectedAgent } = useAgents();
  const { navigateToSkillDashboard } = useNavigation();
  const navigate = usePermissiveNavigate();

  const { readiness, isLoading: isLoadingReadiness } = useAgentSkillReadiness(
    selectedAgent?.id,
  );
  const { skills: recentSkills, isLoading: isLoadingRecent } = useRecentSkills(
    selectedAgent?.id,
  );

  if (!selectedAgent) return null;

  const skillsCount = readiness.size;
  const unreadyCount = [...readiness.values()].filter(
    (counts) =>
      !isSkillReady(
        counts.model_count,
        counts.evaluation_count,
        counts.optimize,
      ),
  ).length;

  const viewSkills = () =>
    navigate({
      to: `/agents/${encodeURIComponent(selectedAgent.name)}/skills`,
    });

  const createSkill = () =>
    navigate({
      to: `/agents/${encodeURIComponent(selectedAgent.name)}/skills/create`,
    });

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 mb-2">
          <LayersIcon className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Skills</CardTitle>
        </div>
        <CardDescription>
          {isLoadingReadiness
            ? 'Counting…'
            : skillsCount === 0
              ? selectedAgent.auto_create_skills
                ? 'None yet — the first request to this agent makes one'
                : 'None yet'
              : `${skillsCount} skill${skillsCount === 1 ? '' : 's'}${
                  unreadyCount > 0 ? `, ${unreadyCount} not ready` : ''
                }`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-3">
        {isLoadingRecent ? (
          <div className="space-y-1">
            {Array.from({ length: 5 }).map(() => (
              <Skeleton key={nanoid()} className="h-8 w-full" />
            ))}
          </div>
        ) : recentSkills.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {skillsCount === 0
              ? 'No skills yet.'
              : 'None of these skills has served a request yet.'}
          </p>
        ) : (
          <ul
            className="divide-y rounded-lg border"
            aria-label="Recently used skills"
          >
            {recentSkills.map((skill) => {
              const counts = readiness.get(skill.skill_id);
              const notReady =
                !!counts &&
                !isSkillReady(
                  counts.model_count,
                  counts.evaluation_count,
                  counts.optimize,
                );
              return (
                <li key={skill.skill_id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/50"
                    onClick={() =>
                      navigateToSkillDashboard(selectedAgent.name, skill.name)
                    }
                  >
                    <img
                      src={createSkillAvatar(skill.name)}
                      alt=""
                      width={20}
                      height={20}
                      className="size-5 rounded-sm shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {skill.name}
                    </span>
                    {notReady && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertCircle
                            className="size-3.5 shrink-0 text-orange-500"
                            aria-label={`${skill.name} is not ready`}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          <p>This skill is not ready to serve</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <span
                      className="shrink-0 text-xs text-muted-foreground"
                      title={formatLogTimestamp(skill.last_used_at)}
                    >
                      {formatTimeAgo(skill.last_used_at)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={viewSkills}>
            View skills
          </Button>
          <Button variant="ghost" size="sm" onClick={createSkill}>
            <PlusIcon className="h-4 w-4 mr-2" />
            Create Skill
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
