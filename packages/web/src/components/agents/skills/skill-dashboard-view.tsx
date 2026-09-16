'use client';

import { useQuery } from '@tanstack/react-query';
import {
  getSkillEvaluationScoresByTimeBucket,
  resetSkill,
} from '@web/api/v1/super-agents/skills';
import { LogTagBadge } from '@web/components/agents/log-cells';
import { RecentLogsTable } from '@web/components/agents/recent-logs-table';
import { ManageSkillModelsDialog } from '@web/components/agents/skills/manage-skill-models-dialog';
import { SkillStatusIndicator } from '@web/components/agents/skills/skill-status-indicator';
import { SkillWarmingUpIndicator } from '@web/components/agents/skills/skill-warming-up-indicator';
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
import { PageHeader } from '@web/components/ui/page-header';
import { Skeleton } from '@web/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@web/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@web/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@web/components/ui/tooltip';
import { eventLabels } from '@web/constants';
import { usePermissiveNavigate } from '@web/hooks/use-permissive-navigate';
import { useSkillValidation } from '@web/hooks/use-skill-validation';
import { useToast } from '@web/hooks/use-toast';
import { useAgents } from '@web/providers/agents';
import { useLogs } from '@web/providers/logs';
import { useModels } from '@web/providers/models';
import { useNavigation } from '@web/providers/navigation';
import { useSkillEvents } from '@web/providers/skill-events';
import { useSkillOptimizationClusters } from '@web/providers/skill-optimization-clusters';
import { useSkills } from '@web/providers/skills';
import { createClusterAvatar, createSkillAvatar } from '@web/utils/avatars';
import { scoreRangeForWindow } from '@web/utils/chart-window';
import {
  AlertCircle,
  CalendarIcon,
  CheckCircle2,
  Clock,
  CpuIcon,
  Edit,
  FileTextIcon,
  LayersIcon,
  MoreVertical,
  PlusIcon,
  RotateCcwIcon,
  Trash2,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { ClusterPerformanceChart } from './clusters/cluster-performance-chart';
import { DeleteSkillDialog } from './delete-skill-dialog';
import { ResetSkillDialog } from './reset-skill-dialog';
import { SkillPerformanceChart } from './skill-performance-chart';

// ============================================================================
// Utility Functions
// ============================================================================

export function SkillDashboardView(): ReactElement {
  const { navigateToLogs, navigateToClusterArms } = useNavigation();
  const navigate = usePermissiveNavigate();
  const { toast } = useToast();
  const { navigateToEvaluations } = useNavigation();

  const { selectedAgent } = useAgents();
  const { selectedSkill, deleteSkill, refetch: refetchSkills } = useSkills();
  const [isManageModelsOpen, setIsManageModelsOpen] = useState(false);
  const [isDeleteSkillDialogOpen, setIsDeleteSkillDialogOpen] = useState(false);
  const [isResetSkillDialogOpen, setIsResetSkillDialogOpen] = useState(false);
  const [isResettingSkill, setIsResettingSkill] = useState(false);

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
      const stored = localStorage.getItem('skill-performance-interval');
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
      localStorage.setItem('skill-performance-interval', selectedInterval);
    } catch {
      // localStorage not available
    }
  }, [selectedInterval]);

  // End time for charts (defaults to now)
  const [endTime, setEndTime] = useState<Date>(() => new Date());

  // Skill validation
  const { isReady, missingRequirements } = useSkillValidation(selectedSkill);

  // Logs via provider
  const {
    logs: recentLogs = [],
    isLoading: isLoadingLogs,
    setAgentId: setLogsAgentId,
    setSkillId: setLogsSkillId,
    setAgentWide: setLogsAgentWide,
  } = useLogs();

  // Models via provider
  const { setSkillId } = useModels();

  // Cluster states via provider
  const {
    clusters: clusterStates,
    isLoading: isLoadingClusterStates,
    setSkillId: setClusterStatesSkillId,
  } = useSkillOptimizationClusters();

  // Fetch skill-level evaluation scores by time bucket (more efficient than full runs)
  const {
    data: skillEvaluationScores = [],
    isLoading: isLoadingSkillEvaluationScores,
  } = useQuery({
    queryKey: [
      'skillEvaluationScores',
      selectedSkill?.id,
      selectedInterval,
      endTime.toISOString(),
    ],
    queryFn: () =>
      selectedSkill
        ? getSkillEvaluationScoresByTimeBucket(selectedSkill.id, {
            interval_minutes: INTERVAL_CONFIG[selectedInterval].minutes,
            // Wider than the window it draws: the points just outside an edge
            // are what let a line cross it instead of starting there.
            ...scoreRangeForWindow(
              endTime,
              INTERVAL_CONFIG[selectedInterval].hours,
            ),
          })
        : Promise.resolve([]),
    enabled: !!selectedSkill,
    refetchInterval: 60000, // Refetch every minute
  });

  // Fetch cluster-level evaluation scores for all clusters
  const {
    data: clusterEvaluationScores = {},
    isLoading: isLoadingClusterEvaluationScores,
  } = useQuery({
    queryKey: [
      'clusterEvaluationScores',
      selectedSkill?.id,
      clusterStates.map((c) => c.id).join(','),
      endTime.toISOString(),
    ],
    queryFn: async () => {
      if (!selectedSkill || clusterStates.length === 0) return {};

      // Fetch scores for all clusters in parallel (30 buckets at 5 min intervals = 2.5 hours)
      const scoresPromises = clusterStates.map(async (cluster) => {
        const scores = await getSkillEvaluationScoresByTimeBucket(
          selectedSkill.id,
          {
            cluster_id: cluster.id,
            interval_minutes: 5, // 5 min intervals
            // The last 2.5 hours (30 buckets), and a window on each side of
            // them so a line can cross the chart's edges.
            ...scoreRangeForWindow(endTime, 2.5),
          },
        ).catch(() => []);
        return [cluster.id, scores] as const;
      });

      const scoresArray = await Promise.all(scoresPromises);
      return Object.fromEntries(scoresArray);
    },
    enabled: !!selectedSkill && clusterStates.length > 0,
    refetchInterval: 60000, // Refetch every minute
  });

  // Skill events via provider
  const { events: skillEvents = [], setSkillId: setSkillEventsSkillId } =
    useSkillEvents();

  // The recent logs are this skill's, whatever scope the logs page left
  useEffect(() => {
    setLogsAgentWide(false);
    if (selectedAgent && selectedSkill) {
      setLogsAgentId(selectedAgent.id);
      setLogsSkillId(selectedSkill.id);
    } else {
      setLogsAgentId(null);
      setLogsSkillId(null);
    }
  }, [
    selectedAgent,
    selectedSkill,
    setLogsAgentId,
    setLogsSkillId,
    setLogsAgentWide,
  ]);

  // Update models query params
  useEffect(() => {
    if (!selectedSkill) {
      setSkillId(null);
      return;
    }
    setSkillId(selectedSkill.id);
  }, [selectedSkill, setSkillId]);

  // Update cluster states skill ID
  useEffect(() => {
    if (!selectedSkill) {
      setClusterStatesSkillId(null);
      return;
    }
    setClusterStatesSkillId(selectedSkill.id);
  }, [selectedSkill, setClusterStatesSkillId]);

  // Update skill events skill ID
  useEffect(() => {
    if (!selectedSkill) {
      setSkillEventsSkillId(null);
      return;
    }
    setSkillEventsSkillId(selectedSkill.id);
  }, [selectedSkill, setSkillEventsSkillId]);

  const handleDeleteSkill = async () => {
    if (!selectedSkill || !selectedAgent) return;
    await deleteSkill(selectedSkill.id);
    navigate({
      to: '/agents/$agentName',
      params: { agentName: selectedAgent.name },
    });
  };

  const handleResetSkill = async (clearObservabilityCount: boolean) => {
    if (!selectedSkill) return;

    setIsResettingSkill(true);
    try {
      await resetSkill(selectedSkill.id, clearObservabilityCount);
      await refetchSkills();
      toast({
        title: 'Skill reset successfully',
        description: `${selectedSkill.name} has been reset and is regenerating.`,
      });
    } catch (error) {
      console.error('Failed to reset skill:', error);
      toast({
        title: 'Failed to reset skill',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsResettingSkill(false);
    }
  };

  // Early return if no skill or agent selected - AFTER all hooks
  if (!selectedSkill || !selectedAgent) {
    return (
      <>
        <PageHeader
          title="Skill Dashboard"
          description="No skill selected. Please select a skill to view its dashboard."
        />
        <div className="p-6">
          <div className="text-center text-muted-foreground">
            No skill selected. Please select a skill to view its dashboard.
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
              src={createSkillAvatar(selectedSkill.name)}
              alt={`${selectedSkill.name} icon`}
              width={20}
              height={20}
              className="h-5 w-5 rounded-sm"
            />
            <span>{selectedSkill.name}</span>
            {selectedSkill.auto_created && (
              <Badge
                variant="outline"
                className="text-xs"
                title="Created by the gateway for a request that named only the agent; its first configurations used that request's own system prompt"
              >
                auto
              </Badge>
            )}
            <SkillStatusIndicator
              skill={selectedSkill}
              variant="badge"
              tooltipSide="bottom"
            />
            <SkillWarmingUpIndicator
              skill={selectedSkill}
              variant="badge"
              tooltipSide="bottom"
            />
          </div>
        }
        description={selectedSkill.description || 'No description available'}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setIsManageModelsOpen(true)}
            >
              <CpuIcon className="h-4 w-4 mr-2" />
              Manage Models
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                selectedAgent &&
                selectedSkill &&
                navigateToEvaluations(selectedAgent.name, selectedSkill.name)
              }
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Manage Evaluations
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" title="More options">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    navigate({
                      to: '/agents/$agentName/skills/$skillName/edit',
                      params: {
                        agentName: selectedAgent.name,
                        skillName: selectedSkill.name,
                      },
                    })
                  }
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Skill
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setIsResetSkillDialogOpen(true)}
                  disabled={isResettingSkill}
                >
                  <RotateCcwIcon className="h-4 w-4 mr-2" />
                  {isResettingSkill ? 'Resetting...' : 'Reset Skill'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setIsDeleteSkillDialogOpen(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Skill
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      {!isReady && (
        <div className="mx-6 mt-6">
          <Card className="bg-orange-100 dark:bg-orange-950 border-orange-200 dark:border-orange-800">
            <CardContent className="flex items-start gap-3 pt-4">
              <AlertCircle className="h-5 w-5 text-orange-800 dark:text-orange-200 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-orange-800 dark:text-orange-200 mb-1">
                  Skill Not Ready
                </h3>
                <p className="text-sm text-orange-800 dark:text-orange-200 mb-3">
                  This skill is missing required components:
                </p>
                <ul className="text-sm text-orange-800 dark:text-orange-200 list-disc pl-5 space-y-1 mb-3">
                  {missingRequirements.map((req) => (
                    <li key={req}>{req}</li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsManageModelsOpen(true)}
                    className="bg-white dark:bg-orange-900 hover:bg-orange-50 dark:hover:bg-orange-800 border-orange-300 dark:border-orange-700"
                  >
                    <PlusIcon className="h-3 w-3 mr-1" />
                    Add Model
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      selectedAgent &&
                      selectedSkill &&
                      navigateToEvaluations(
                        selectedAgent.name,
                        selectedSkill.name,
                      )
                    }
                    className="bg-white dark:bg-orange-900 hover:bg-orange-50 dark:hover:bg-orange-800 border-orange-300 dark:border-orange-700"
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Add Evaluation
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      <div className="p-6 space-y-6">
        {/* Performance Chart - Full Width */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-between items-start mb-4 gap-4">
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
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Total Requests:
                  </span>
                  <Badge variant="secondary">
                    {clusterStates
                      .reduce(
                        (sum, cluster) =>
                          sum + cluster.observability_total_requests,
                        0,
                      )
                      .toLocaleString()}
                  </Badge>
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
            {isLoadingSkillEvaluationScores ? (
              <div className="h-64 flex items-center justify-center">
                <Skeleton className="h-full w-full" />
              </div>
            ) : (
              <SkillPerformanceChart
                evaluationScores={skillEvaluationScores}
                events={skillEvents}
                clusters={clusterStates}
                intervalMinutes={INTERVAL_CONFIG[selectedInterval].minutes}
                windowHours={INTERVAL_CONFIG[selectedInterval].hours}
                endTime={endTime}
              />
            )}
          </CardContent>
        </Card>

        {/* Partitions - Horizontal Scroll */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold">Partitions</h3>
              <p className="text-sm text-muted-foreground">
                Optimization partitions for this skill
              </p>
            </div>
            <Badge variant="secondary">{clusterStates.length} total</Badge>
          </div>

          {isLoadingClusterStates ? (
            <div className="flex gap-4 overflow-x-auto pb-4">
              {Array.from({ length: 3 }).map(() => (
                <Card key={nanoid()} className="min-w-[300px]">
                  <CardHeader className="pb-2">
                    <Skeleton className="h-6 w-24 mb-2" />
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-5 w-12" />
                      </div>
                      <div className="flex items-center justify-between">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-3 w-8" />
                      </div>
                      <div className="pt-2 border-t">
                        <Skeleton className="h-3 w-32 mb-2" />
                        <Skeleton className="h-32 w-full" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : clusterStates.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center">
                <LayersIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  No partitions found
                </h3>
                <p className="text-muted-foreground">
                  This skill has no optimization partitions yet.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-4">
              {clusterStates.map((cluster) => (
                <Card
                  key={cluster.id}
                  className="min-w-[300px] cursor-pointer hover:shadow-lg hover:border-primary/50 transition-all"
                  onClick={() =>
                    navigateToClusterArms(
                      selectedAgent.name,
                      selectedSkill.name,
                      cluster.name,
                    )
                  }
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg leading-none mb-2 flex items-center gap-2">
                      <img
                        src={createClusterAvatar(
                          selectedSkill.name,
                          cluster.name,
                        )}
                        alt={`Partition ${cluster.name} icon`}
                        width={24}
                        height={24}
                        className="size-6 rounded-sm shrink-0"
                      />
                      {cluster.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Total Requests
                        </span>
                        <Badge variant="secondary">
                          {cluster.observability_total_requests.toString()}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          Since Reflection
                        </span>
                        <span className="text-muted-foreground">
                          {cluster.total_steps.toString()}
                        </span>
                      </div>
                      <div className="pt-2 border-t">
                        <div className="text-xs text-muted-foreground mb-2">
                          Performance
                        </div>
                        {isLoadingClusterEvaluationScores ? (
                          <Skeleton className="h-32 w-full" />
                        ) : (
                          <ClusterPerformanceChart
                            evaluationScores={
                              clusterEvaluationScores[cluster.id] || []
                            }
                            events={skillEvents.filter(
                              (e) =>
                                e.cluster_id === cluster.id ||
                                e.cluster_id === null,
                            )}
                            intervalMinutes={5}
                            windowHours={2.5}
                            endTime={endTime}
                          />
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">Observability</h3>
            <p className="text-sm text-muted-foreground">
              Monitor and analyze the performance and behavior of your skill
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Recent Logs Card */}
          <Card
            className="cursor-pointer hover:shadow-lg hover:border-primary/50 transition-all"
            onClick={() =>
              navigateToLogs(selectedAgent.name, selectedSkill.name)
            }
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-base font-medium">Logs</CardTitle>
                <CardDescription>Recent requests</CardDescription>
              </div>
              <FileTextIcon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingLogs ? (
                <div className="p-6 space-y-1">
                  {Array.from({ length: 5 }).map(() => (
                    <Skeleton key={nanoid()} className="h-8 w-full" />
                  ))}
                </div>
              ) : recentLogs.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  No logs available
                </p>
              ) : (
                <div className="m-4 border rounded-lg overflow-hidden">
                  <RecentLogsTable
                    logs={recentLogs}
                    context={{
                      header: 'Partition',
                      render: (log) => (
                        <LogTagBadge
                          value={
                            clusterStates.find((c) => c.id === log.cluster_id)
                              ?.name
                          }
                          mono
                        />
                      ),
                    }}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Events Card */}
          <Card
            className="cursor-pointer hover:shadow-lg hover:border-primary/50 transition-all"
            onClick={() =>
              navigate({
                to: '/agents/$agentName/skills/$skillName/events',
                params: {
                  agentName: selectedAgent.name,
                  skillName: selectedSkill.name,
                },
              })
            }
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-base font-medium">Events</CardTitle>
                <CardDescription>Skill changes and updates</CardDescription>
              </div>
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-0">
              {skillEvents.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  No events available
                </p>
              ) : (
                <div className="m-4 border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Event</TableHead>
                        <TableHead className="text-right">When</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {skillEvents.slice(0, 5).map((event) => {
                        const label =
                          eventLabels[event.event_type] || event.event_type;

                        return (
                          <TableRow
                            key={event.id}
                            className="hover:bg-transparent"
                          >
                            <TableCell className="font-medium">
                              {label}
                              {event.metadata.model_name
                                ? `: ${event.metadata.model_name}`
                                : ''}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {new Date(event.created_at).toLocaleString()}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Manage Models Dialog */}
      {selectedSkill && (
        <ManageSkillModelsDialog
          open={isManageModelsOpen}
          onOpenChange={setIsManageModelsOpen}
          skillId={selectedSkill.id}
        />
      )}

      {/* Delete Skill Dialog */}
      <DeleteSkillDialog
        skill={selectedSkill || null}
        open={isDeleteSkillDialogOpen}
        onOpenChange={setIsDeleteSkillDialogOpen}
        onConfirm={handleDeleteSkill}
      />

      {/* Reset Skill Dialog */}
      <ResetSkillDialog
        skill={selectedSkill || null}
        open={isResetSkillDialogOpen}
        onOpenChange={setIsResetSkillDialogOpen}
        onConfirm={handleResetSkill}
        isResetting={isResettingSkill}
      />
    </>
  );
}
