'use client';

import { botttsNeutral } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import type { Skill } from '@shared/types/data';
import { useQuery } from '@tanstack/react-query';
import { getAgentEvaluationScoresByTimeBucket } from '@web/api/v1/super-agents/agents';
import { getSkillEvents } from '@web/api/v1/super-agents/skill-events';
import { getSkillEvaluationScoresByTimeBucket } from '@web/api/v1/super-agents/skills';
import { AgentPerformanceChart } from '@web/components/agents/agent-performance-chart';
import { AgentRecentLogsCard } from '@web/components/agents/agent-recent-logs-card';
import { AgentStatusIndicator } from '@web/components/agents/agent-status-indicator';
import { DeleteAgentDialog } from '@web/components/agents/delete-agent-dialog';
import { ManageAgentModelsDialog } from '@web/components/agents/manage-agent-models-dialog';
import { SkillPerformanceChart } from '@web/components/agents/skills/skill-performance-chart';
import { SkillStatusIndicator } from '@web/components/agents/skills/skill-status-indicator';
import { Alert, AlertDescription, AlertTitle } from '@web/components/ui/alert';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { Input } from '@web/components/ui/input';
import { PageHeader } from '@web/components/ui/page-header';
import { Skeleton } from '@web/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@web/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@web/components/ui/tooltip';
import { useAgentValidation } from '@web/hooks/use-agent-validation';
import { usePermissiveNavigate } from '@web/hooks/use-permissive-navigate';
import { useAgents } from '@web/providers/agents';
import { useNavigation } from '@web/providers/navigation';
import { useSkills } from '@web/providers/skills';
import { createSkillAvatar } from '@web/utils/avatars';
import { scoreRangeForWindow } from '@web/utils/chart-window';
import {
  BarChart3Icon,
  Clock,
  CpuIcon,
  Edit,
  EyeIcon,
  EyeOffIcon,
  MoreVertical,
  PlusIcon,
  ScrollTextIcon,
  SearchIcon,
  Trash2,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';

const createAgentAvatar = (agentName: string) => {
  const svg = createAvatar(botttsNeutral, {
    seed: agentName,
    size: 24,
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

export function AgentView(): ReactElement {
  const { navigateToSkillDashboard } = useNavigation();
  const { selectedAgent, deleteAgent } = useAgents();
  const navigate = usePermissiveNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const agentAvatar = useMemo(() => {
    if (!selectedAgent) return '';
    return createAgentAvatar(selectedAgent.name);
  }, [selectedAgent]);

  const [isDeleteAgentDialogOpen, setIsDeleteAgentDialogOpen] = useState(false);
  const [isModelsDialogOpen, setIsModelsDialogOpen] = useState(false);
  // The one thing an agent that creates its own skills cannot do without.
  const { defaultModelsCount, isLoading: isLoadingValidation } =
    useAgentValidation(selectedAgent);
  const needsDefaultModels =
    !!selectedAgent?.auto_create_skills &&
    !isLoadingValidation &&
    defaultModelsCount === 0;

  // Time interval controls for chart (30 buckets fixed)
  type TimeInterval = '1min' | '5min' | '15min' | '1hour' | '6hour' | '24hour';
  const BUCKETS = 30; // Fixed number of buckets
  const INTERVAL_CONFIG = {
    '1min': { label: '1 Min', minutes: 1, hours: (BUCKETS * 1) / 60 },
    '5min': { label: '5 Min', minutes: 5, hours: (BUCKETS * 5) / 60 },
    '15min': { label: '15 Min', minutes: 15, hours: (BUCKETS * 15) / 60 },
    '1hour': { label: '1 Hour', minutes: 60, hours: (BUCKETS * 60) / 60 },
    '6hour': { label: '6 Hours', minutes: 360, hours: (BUCKETS * 360) / 60 },
    '24hour': { label: '1 Day', minutes: 1440, hours: (BUCKETS * 1440) / 60 },
  } as const;

  const [selectedInterval, setSelectedInterval] = useState<TimeInterval>(() => {
    if (typeof window === 'undefined') return '1hour';
    try {
      const stored = localStorage.getItem('agent-performance-interval');
      if (stored && stored in INTERVAL_CONFIG) {
        return stored as TimeInterval;
      }
    } catch {
      // localStorage not available
    }
    return '1hour';
  });

  // Save interval preference
  useEffect(() => {
    try {
      localStorage.setItem('agent-performance-interval', selectedInterval);
    } catch {
      // localStorage not available
    }
  }, [selectedInterval]);

  // Whether the chart draws the skills that scored nothing in the window,
  // carried across it from an older score. Remembered like the interval: it
  // is how this reader wants their chart, not a property of the agent.
  const [showQuietSkills, setShowQuietSkills] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return localStorage.getItem('agent-performance-quiet-skills') !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        'agent-performance-quiet-skills',
        String(showQuietSkills),
      );
    } catch {
      // localStorage not available
    }
  }, [showQuietSkills]);

  // End time for charts (defaults to now)
  const [endTime, setEndTime] = useState<Date>(() => new Date());

  // Use providers
  const {
    skills,
    isLoading: isLoadingSkills,
    setQueryParams: setSkillQueryParams,
  } = useSkills();

  // Update skills query params when agent changes
  useEffect(() => {
    if (!selectedAgent) return;
    setSkillQueryParams({
      agent_id: selectedAgent.id,
      limit: 100,
    });
  }, [selectedAgent, setSkillQueryParams]);

  // Fetch agent-level evaluation scores by time bucket
  const {
    data: agentEvaluationScores = [],
    isLoading: isLoadingAgentEvaluationScores,
  } = useQuery({
    queryKey: [
      'agentEvaluationScores',
      selectedAgent?.id,
      selectedInterval,
      INTERVAL_CONFIG[selectedInterval].hours,
      endTime.toISOString(),
    ],
    queryFn: async () => {
      if (!selectedAgent) return [];
      const scores = await getAgentEvaluationScoresByTimeBucket(
        selectedAgent.id,
        {
          interval_minutes: INTERVAL_CONFIG[selectedInterval].minutes,
          // The window, and the bucket nearest outside each end of it: what a
          // line needs to cross an edge instead of starting there.
          ...scoreRangeForWindow(
            endTime,
            INTERVAL_CONFIG[selectedInterval].hours,
            INTERVAL_CONFIG[selectedInterval].minutes,
          ),
        },
      );
      return scores;
    },
    enabled: !!selectedAgent,
    refetchInterval: 60000, // Refetch every minute
  });

  // Fetch agent-level skill events
  const { data: agentEvents = [] } = useQuery({
    queryKey: ['agentEvents', selectedAgent?.id],
    queryFn: async () => {
      if (!selectedAgent) return [];
      return await getSkillEvents({ agent_id: selectedAgent.id });
    },
    enabled: !!selectedAgent,
    refetchInterval: 60000, // Refetch every minute
  });

  // Fetch skill-level evaluation scores for all skills (small charts).
  //
  // The cards follow the interval chosen for the chart above them rather than
  // a window of their own. A card that always showed the last two hours said
  // nothing about a skill that runs weekly, and disagreed with the chart it
  // sits under: the reader picks a day and the cards keep answering in
  // minutes.
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

      // Fetch scores for all skills in parallel
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

      const scoresArray = await Promise.all(scoresPromises);
      return Object.fromEntries(scoresArray);
    },
    enabled: !!selectedAgent && skills.length > 0,
    refetchInterval: 60000, // Refetch every minute
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

  const handleSkillSelect = (skill: Skill) => {
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

  const handleViewLogs = () => {
    if (selectedAgent) {
      navigate({
        to: `/agents/${encodeURIComponent(selectedAgent.name)}/logs`,
      });
    }
  };

  const handleEditAgent = () => {
    if (selectedAgent) {
      navigate({
        to: `/agents/${encodeURIComponent(selectedAgent.name)}/edit`,
      });
    }
  };

  const handleDeleteAgent = async () => {
    if (!selectedAgent) return;
    await deleteAgent(selectedAgent.id);
    navigate({ to: '/agents' });
  };

  // Removed automatic redirect to create skill - let users decide when to create

  if (!selectedAgent) {
    return (
      <>
        <PageHeader
          title="Welcome to Agents"
          description="Select an agent from the dropdown above to view its skills and start managing your AI /agents"
          showBackButton={false}
        />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-semibold mb-2">Welcome to Agents</h2>
            <p className="text-muted-foreground mb-4">
              Select an agent from the dropdown above to view its skills and
              start managing your AI /agents.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <img
              src={agentAvatar}
              alt={`${selectedAgent.name} avatar`}
              width={20}
              height={20}
              className="size-5 rounded-sm"
            />
            <span>{selectedAgent.name}</span>
            <AgentStatusIndicator
              agent={selectedAgent}
              variant="badge"
              tooltipSide="bottom"
            />
          </div>
        }
        description={selectedAgent.description || 'No description provided'}
        showBackButton={true}
        onBack={() => navigate({ to: '/agents' })}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleViewLogs}>
              <ScrollTextIcon className="h-4 w-4 mr-2" />
              Logs
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" title="More options">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleEditAgent}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Agent
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsModelsDialogOpen(true)}>
                  <CpuIcon className="h-4 w-4 mr-2" />
                  Default Models
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setIsDeleteAgentDialogOpen(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Agent
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      <div className="p-6 space-y-6">
        {needsDefaultModels && (
          <Alert>
            <CpuIcon className="h-4 w-4" />
            <AlertTitle>This agent has no default models</AlertTitle>
            <AlertDescription>
              <p>
                It creates skills from requests automatically and gives them its
                default models. Without any, those skills cannot serve requests.
              </p>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => setIsModelsDialogOpen(true)}
              >
                <CpuIcon className="h-4 w-4 mr-2" />
                Add default models
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Agent Performance Chart */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3Icon className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Agent Performance</CardTitle>
            </div>
            <CardDescription className="mb-4">
              Performance metrics across all skills for this agent
            </CardDescription>
            <div className="flex justify-between items-start gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2">
                        <DateTimePicker
                          date={endTime}
                          onDateChange={setEndTime}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>
                        Select the end time for the chart (rightmost data point)
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
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
                      <Button
                        variant="outline"
                        size="icon"
                        aria-pressed={showQuietSkills}
                        aria-label="Skills with no scores in this window"
                        onClick={() => setShowQuietSkills((shown) => !shown)}
                      >
                        {showQuietSkills ? (
                          <EyeIcon className="h-4 w-4" />
                        ) : (
                          <EyeOffIcon className="h-4 w-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>
                        {showQuietSkills
                          ? 'Hide the skills that scored nothing in this window, whose lines are carried from an older score'
                          : 'Show the skills that scored nothing in this window, carried from their last score'}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
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
                    {(Object.keys(INTERVAL_CONFIG) as TimeInterval[]).map(
                      (interval) => (
                        <ToggleGroupItem
                          key={interval}
                          value={interval}
                          aria-label={`Toggle ${INTERVAL_CONFIG[interval].label} interval`}
                          className="text-xs rounded-none"
                        >
                          {INTERVAL_CONFIG[interval].label}
                        </ToggleGroupItem>
                      ),
                    )}
                  </ToggleGroup>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Select time interval for chart buckets</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingAgentEvaluationScores ? (
              <div className="h-64 flex items-center justify-center">
                <Skeleton className="h-full w-full" />
              </div>
            ) : (
              <AgentPerformanceChart
                evaluationScores={agentEvaluationScores}
                events={agentEvents}
                skills={skills}
                intervalMinutes={INTERVAL_CONFIG[selectedInterval].minutes}
                windowHours={INTERVAL_CONFIG[selectedInterval].hours}
                endTime={endTime}
                showQuietSkills={showQuietSkills}
              />
            )}
          </CardContent>
        </Card>

        {/* Recent Logs across all skills */}
        <AgentRecentLogsCard />

        <div className="flex justify-between items-center gap-4">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button onClick={handleCreateSkill}>
            <PlusIcon className="h-4 w-4 mr-2" />
            Create Skill
          </Button>
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
                  : needsDefaultModels
                    ? 'Skills are created from requests automatically and take the default models of the agent. Add those first: without them a created skill cannot serve requests.'
                    : 'Skills are created from requests automatically: the first request to this agent makes its first skill. You can also create one by hand.'}
            </p>
            {!searchQuery && (
              <div className="flex justify-center gap-2">
                {needsDefaultModels && (
                  <Button onClick={() => setIsModelsDialogOpen(true)}>
                    <CpuIcon className="h-4 w-4 mr-2" />
                    Add default models
                  </Button>
                )}
                <Button
                  variant={needsDefaultModels ? 'outline' : 'default'}
                  onClick={handleCreateSkill}
                >
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
            {filteredSkills.map((skill) => {
              return (
                <Card
                  key={skill.id}
                  className="cursor-pointer hover:shadow-lg hover:border-primary/50 transition-all"
                  onClick={() => handleSkillSelect(skill)}
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
                          evaluationScores={
                            skillEvaluationScores[skill.id] || []
                          }
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
              );
            })}
          </div>
        )}
      </div>

      <DeleteAgentDialog
        agent={selectedAgent}
        open={isDeleteAgentDialogOpen}
        onOpenChange={setIsDeleteAgentDialogOpen}
        onConfirm={handleDeleteAgent}
      />
      {isModelsDialogOpen && (
        <ManageAgentModelsDialog
          agentId={selectedAgent.id}
          open={isModelsDialogOpen}
          onOpenChange={setIsModelsDialogOpen}
        />
      )}
    </>
  );
}
