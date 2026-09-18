'use client';

import { botttsNeutral } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import { useQuery } from '@tanstack/react-query';
import { getAgentEvaluationScoresByTimeBucket } from '@web/api/v1/super-agents/agents';
import { getSkillEvents } from '@web/api/v1/super-agents/skill-events';
import { AgentPerformanceChart } from '@web/components/agents/agent-performance-chart';
import { AgentRecentLogsCard } from '@web/components/agents/agent-recent-logs-card';
import { AgentStatusIndicator } from '@web/components/agents/agent-status-indicator';
import { DeleteAgentDialog } from '@web/components/agents/delete-agent-dialog';
import { ManageAgentModelsDialog } from '@web/components/agents/manage-agent-models-dialog';
import { Alert, AlertDescription, AlertTitle } from '@web/components/ui/alert';
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
import { PageHeader } from '@web/components/ui/page-header';
import { Skeleton } from '@web/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@web/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@web/components/ui/tooltip';
import { useAgentUnreadySkills } from '@web/hooks/use-agent-unready-skills';
import { useAgentValidation } from '@web/hooks/use-agent-validation';
import { usePermissiveNavigate } from '@web/hooks/use-permissive-navigate';
import { useAgents } from '@web/providers/agents';
import { useSkills } from '@web/providers/skills';
import {
  INTERVAL_CONFIG,
  rememberInterval,
  storedInterval,
  TIME_INTERVALS,
  type TimeInterval,
} from '@web/utils/chart-interval';
import { scoreRangeForWindow } from '@web/utils/chart-window';
import {
  BarChart3Icon,
  Clock,
  CpuIcon,
  Edit,
  EyeIcon,
  EyeOffIcon,
  LayersIcon,
  MoreVertical,
  PlusIcon,
  ScrollTextIcon,
  Trash2,
} from 'lucide-react';
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

/** How the reader last cut time on this page, shared with the skills page. */
const INTERVAL_KEY = 'agent-performance-interval';

export function AgentView(): ReactElement {
  const { selectedAgent, deleteAgent } = useAgents();
  const navigate = usePermissiveNavigate();

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
  // Already answered for the sidebar's mark on this agent, so the card below
  // costs nothing to fill in.
  const { unreadySkillsCount } = useAgentUnreadySkills(selectedAgent);

  const [selectedInterval, setSelectedInterval] = useState<TimeInterval>(() =>
    storedInterval(INTERVAL_KEY),
  );

  useEffect(() => {
    rememberInterval(INTERVAL_KEY, selectedInterval);
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

  const handleViewSkills = () => {
    if (selectedAgent) {
      navigate({
        to: `/agents/${encodeURIComponent(selectedAgent.name)}/skills`,
      });
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
            <Button variant="outline" onClick={handleViewSkills}>
              <LayersIcon className="h-4 w-4 mr-2" />
              Skills
            </Button>
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

        {/* The skills themselves live on their own page */}
        <Card
          className="cursor-pointer hover:shadow-lg hover:border-primary/50 transition-all"
          onClick={handleViewSkills}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base font-medium">Skills</CardTitle>
              <CardDescription>
                {isLoadingSkills
                  ? 'Counting…'
                  : skills.length === 0
                    ? selectedAgent.auto_create_skills
                      ? 'None yet — the first request to this agent makes one'
                      : 'None yet'
                    : `${skills.length} skill${skills.length === 1 ? '' : 's'}${
                        unreadySkillsCount > 0
                          ? `, ${unreadySkillsCount} not ready`
                          : ''
                      }`}
              </CardDescription>
            </div>
            <LayersIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleViewSkills}>
                View skills
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation();
                  handleCreateSkill();
                }}
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                Create Skill
              </Button>
            </div>
          </CardContent>
        </Card>
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
