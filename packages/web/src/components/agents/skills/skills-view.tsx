'use client';

import type { SkillSummary } from '@shared/types/data';
import { useQuery } from '@tanstack/react-query';
import { getSkillEvaluationScoresByTimeBucket } from '@web/api/v1/super-agents/skills';
import { SkillPerformanceChart } from '@web/components/agents/skills/skill-performance-chart';
import { SkillStatusIndicator } from '@web/components/agents/skills/skill-status-indicator';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@web/components/ui/card';
import { DateTimePicker } from '@web/components/ui/date-time-picker';
import { Input } from '@web/components/ui/input';
import { PageHeader } from '@web/components/ui/page-header';
import { Skeleton } from '@web/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@web/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@web/components/ui/tooltip';
import { usePermissiveNavigate } from '@web/hooks/use-permissive-navigate';
import { useAgents } from '@web/providers/agents';
import { useNavigation } from '@web/providers/navigation';
import { useSkills } from '@web/providers/skills';
import { createSkillAvatar } from '@web/utils/avatars';
import {
  INTERVAL_CONFIG,
  rememberInterval,
  storedInterval,
  TIME_INTERVALS,
  type TimeInterval,
} from '@web/utils/chart-interval';
import { scoreRangeForWindow } from '@web/utils/chart-window';
import { buttonLike } from '@web/utils/ui/button-like';
import { Clock, PlusIcon, SearchIcon } from 'lucide-react';
import { nanoid } from 'nanoid';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';

/** How the reader last cut time on this page. */
const INTERVAL_KEY = 'agent-performance-interval';

/**
 * An agent's skills, each with the shape of its recent scores.
 *
 * A page of its own rather than the bottom of the agent dashboard: an agent
 * with fifteen skills drew fifteen charts under a chart of the same data, and
 * the reader who came to look at the agent paid for all of them. Here the
 * window controls belong to the cards, so a page of skills is read at
 * whatever grain suits them.
 */
export function SkillsView(): ReactElement {
  const { navigateToSkillDashboard } = useNavigation();
  const { selectedAgent } = useAgents();
  const navigate = usePermissiveNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedInterval, setSelectedInterval] = useState<TimeInterval>(() =>
    storedInterval(INTERVAL_KEY),
  );
  useEffect(() => {
    rememberInterval(INTERVAL_KEY, selectedInterval);
  }, [selectedInterval]);

  const [endTime, setEndTime] = useState<Date>(() => new Date());

  const {
    skills,
    isLoading: isLoadingSkills,
    setQueryParams: setSkillQueryParams,
  } = useSkills();

  useEffect(() => {
    if (!selectedAgent) return;
    setSkillQueryParams({
      agent_id: selectedAgent.id,
      limit: 100,
    });
  }, [selectedAgent, setSkillQueryParams]);

  // Each card's own series, fetched together: one request per skill, which is
  // what a grid of charts costs whatever page it is on.
  const {
    data: skillEvaluationScores = {},
    isLoading: isLoadingSkillEvaluationScores,
  } = useQuery({
    queryKey: [
      'skillEvaluationScores',
      selectedAgent?.id,
      skills.map((s) => s.id).join(','),
      selectedInterval,
      endTime.toISOString(),
    ],
    queryFn: async () => {
      if (!selectedAgent || skills.length === 0) return {};

      const scoresPromises = skills.map(async (skill) => {
        const scores = await getSkillEvaluationScoresByTimeBucket(skill.id, {
          interval_minutes: INTERVAL_CONFIG[selectedInterval].minutes,
          ...scoreRangeForWindow(
            endTime,
            INTERVAL_CONFIG[selectedInterval].hours,
            INTERVAL_CONFIG[selectedInterval].minutes,
          ),
        }).catch(() => []);
        return [skill.id, scores] as const;
      });

      return Object.fromEntries(await Promise.all(scoresPromises));
    },
    enabled: !!selectedAgent && skills.length > 0,
    refetchInterval: 60000,
  });

  const filteredSkills = useMemo(() => {
    const filtered = searchQuery
      ? skills.filter(
          (skill) =>
            skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            skill.description
              ?.toLowerCase()
              .includes(searchQuery.toLowerCase()),
        )
      : skills;

    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [skills, searchQuery]);

  const handleSkillSelect = (skill: SkillSummary) => {
    if (selectedAgent) {
      navigateToSkillDashboard(selectedAgent.name, skill.name);
    }
  };

  const handleCreateSkill = () => {
    if (selectedAgent) {
      navigate({
        to: `/agents/${encodeURIComponent(selectedAgent.name)}/skills/create`,
      });
    }
  };

  if (!selectedAgent) {
    return (
      <PageHeader
        title="Skills"
        description="Select an agent to see its skills"
        showBackButton={false}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Skills"
        description={`Every skill of ${selectedAgent.name}, and how each has been scoring`}
        showBackButton={true}
        onBack={() =>
          navigate({
            to: `/agents/${encodeURIComponent(selectedAgent.name)}`,
          })
        }
        actions={
          <Button onClick={handleCreateSkill}>
            <PlusIcon className="h-4 w-4 mr-2" />
            Create Skill
          </Button>
        }
      />
      <div className="p-6 space-y-6">
        <div className="flex justify-between items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <SearchIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <DateTimePicker date={endTime} onDateChange={setEndTime} />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>The end time of every chart on this page</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Jump to current time"
                  onClick={() => setEndTime(new Date())}
                >
                  <Clock className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Jump to current time</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroup
                  type="single"
                  value={selectedInterval}
                  onValueChange={(value) => {
                    if (value) setSelectedInterval(value as TimeInterval);
                  }}
                  size="sm"
                  className="border rounded-lg gap-0 overflow-hidden"
                >
                  {TIME_INTERVALS.map((interval) => (
                    <ToggleGroupItem
                      key={interval}
                      value={interval}
                      aria-label={`Toggle ${INTERVAL_CONFIG[interval].label} interval`}
                      className="text-xs rounded-none"
                    >
                      {INTERVAL_CONFIG[interval].label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Select time interval for chart buckets</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {isLoadingSkills ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5 gap-4">
            {Array.from({ length: 6 }).map(() => (
              <Card key={nanoid()}>
                <CardHeader>
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="text-center py-12">
            <h3 className="text-lg font-semibold mb-2">
              {searchQuery ? 'No skills found' : 'No skills yet'}
            </h3>
            <p className="text-muted-foreground mb-4 max-w-xl mx-auto">
              {searchQuery
                ? 'No skills match your search criteria.'
                : !selectedAgent.auto_create_skills
                  ? "This agent doesn't have any skills yet."
                  : 'Skills are created from requests automatically: the first request to this agent makes its first skill. You can also create one by hand.'}
            </p>
            {!searchQuery && (
              <div className="flex justify-center gap-2">
                <Button onClick={handleCreateSkill}>
                  <PlusIcon className="h-4 w-4 mr-2" />
                  {selectedAgent.auto_create_skills
                    ? 'Create a skill by hand'
                    : 'Create your first skill'}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5 gap-4">
            {filteredSkills.map((skill) => (
              <Card
                key={skill.id}
                {...buttonLike({
                  onActivate: () => handleSkillSelect(skill),
                  // The card holds a chart, and a button is named by what is
                  // inside it unless it says otherwise.
                  label: `${skill.name} skill`,
                  className:
                    'cursor-pointer hover:shadow-lg hover:border-primary/50 transition-all',
                })}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <img
                        src={createSkillAvatar(skill.name)}
                        alt={`${skill.name} icon`}
                        width={24}
                        height={24}
                        className="size-6 rounded-sm shrink-0"
                      />
                      <CardTitle className="text-base truncate leading-normal">
                        {skill.name}
                      </CardTitle>
                      {skill.auto_created && (
                        <Badge
                          variant="outline"
                          className="text-xs shrink-0"
                          title="Created by the gateway for a request that named only the agent"
                        >
                          auto
                        </Badge>
                      )}
                    </div>
                    <SkillStatusIndicator
                      skill={skill}
                      variant="badge"
                      tooltipSide="left"
                    />
                  </div>
                  <CardDescription className="line-clamp-2 text-sm">
                    {skill.description || 'No description available'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="pt-2 border-t">
                    <div className="text-xs text-muted-foreground mb-2">
                      Performance
                    </div>
                    {isLoadingSkillEvaluationScores ? (
                      <Skeleton className="h-32 w-full" />
                    ) : (
                      <SkillPerformanceChart
                        evaluationScores={skillEvaluationScores[skill.id] || []}
                        size="small"
                        intervalMinutes={
                          INTERVAL_CONFIG[selectedInterval].minutes
                        }
                        windowHours={INTERVAL_CONFIG[selectedInterval].hours}
                        endTime={endTime}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
