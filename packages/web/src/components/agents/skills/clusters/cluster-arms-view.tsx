'use client';

import type { SkillOptimizationArmStat } from '@shared/types/data/skill-optimization-arm-stats';
import { useQuery } from '@tanstack/react-query';
import {
  getSkillArmStats,
  getSkillEvaluationScoresByTimeBucket,
  resetCluster,
} from '@web/api/v1/super-agents/skills';
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
import { useSmartBack } from '@web/hooks/use-smart-back';
import { useToast } from '@web/hooks/use-toast';
import { useAgents } from '@web/providers/agents';
import { useAIProviders } from '@web/providers/ai-providers';
import { useModels } from '@web/providers/models';
import { useNavigation } from '@web/providers/navigation';
import { useSkillEvents } from '@web/providers/skill-events';
import { useSkillOptimizationArms } from '@web/providers/skill-optimization-arms';
import { useSkillOptimizationClusters } from '@web/providers/skill-optimization-clusters';
import { useSkillOptimizationEvaluations } from '@web/providers/skill-optimization-evaluations';
import { useSkills } from '@web/providers/skills';
import { createArmAvatar, createClusterAvatar } from '@web/utils/avatars';
import { scoreRangeForWindow } from '@web/utils/chart-window';
import { buttonLike } from '@web/utils/ui/button-like';
import {
  ArrowUpDown,
  BoxIcon,
  Clock,
  LayersIcon,
  MoreVertical,
  PaletteIcon,
  RefreshCwIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { ClusterPerformanceChart } from './cluster-performance-chart';
import { ResetClusterDialog } from './reset-cluster-dialog';

export function ClusterArmsView(): ReactElement {
  const { navigateToArmDetail, navigationState } = useNavigation();
  const { selectedAgent } = useAgents();
  const { selectedSkill } = useSkills();
  const goBack = useSmartBack();
  const { toast } = useToast();

  const { arms, isLoading, error, refetch, setSkillId, setClusterId } =
    useSkillOptimizationArms();
  const {
    selectedCluster,
    isLoading: clustersLoading,
    setSkillId: setClustersSkillId,
  } = useSkillOptimizationClusters();
  const { skillModels, setSkillId: setModelsSkillId } = useModels();
  const { getAPIKeyById } = useAIProviders();
  const { events: skillEvents = [], setSkillId: setSkillEventsSkillId } =
    useSkillEvents();
  const { evaluations, setSkillId: setEvaluationsSkillId } =
    useSkillOptimizationEvaluations();

  // Fetch arm stats for weighted colorization
  const { data: armStats = [] } = useQuery<SkillOptimizationArmStat[]>({
    queryKey: ['skillArmStats', selectedSkill?.id],
    queryFn: () => {
      if (!selectedSkill) return [];
      return getSkillArmStats(selectedSkill.id);
    },
    enabled: !!selectedSkill,
  });

  const clusterId = selectedCluster?.id;

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
      const stored = localStorage.getItem('cluster-performance-interval');
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
      localStorage.setItem('cluster-performance-interval', selectedInterval);
    } catch {
      // localStorage not available
    }
  }, [selectedInterval]);

  // End time for charts (defaults to now)
  const [endTime, setEndTime] = useState<Date>(() => new Date());

  // Fetch cluster-level evaluation scores
  const {
    data: clusterEvaluationScores = [],
    isLoading: isLoadingClusterEvaluationScores,
  } = useQuery({
    queryKey: [
      'clusterEvaluationScores',
      selectedSkill?.id,
      clusterId,
      selectedInterval,
      endTime.toISOString(),
    ],
    queryFn: () =>
      selectedSkill && clusterId
        ? getSkillEvaluationScoresByTimeBucket(selectedSkill.id, {
            cluster_id: clusterId,
            interval_minutes: INTERVAL_CONFIG[selectedInterval].minutes,
            // The window, and the bucket nearest outside each end of it.
            ...scoreRangeForWindow(
              endTime,
              INTERVAL_CONFIG[selectedInterval].hours,
              INTERVAL_CONFIG[selectedInterval].minutes,
            ),
          })
        : Promise.resolve([]),
    enabled: !!selectedSkill && !!clusterId,
    refetchInterval: 60000, // Refetch every minute
  });
  const [isResetting, setIsResetting] = useState(false);
  const [isResetClusterDialogOpen, setIsResetClusterDialogOpen] =
    useState(false);

  // Load sort preference from localStorage
  const [sortBy, setSortBy] = useState<'name' | 'performance' | 'requests'>(
    () => {
      if (typeof window === 'undefined') return 'name';
      try {
        const stored = localStorage.getItem('cluster-arms-sort-by');
        if (
          stored === 'name' ||
          stored === 'performance' ||
          stored === 'requests'
        ) {
          return stored;
        }
        return 'name';
      } catch {
        return 'name';
      }
    },
  );

  // Save sort preference to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('cluster-arms-sort-by', sortBy);
    } catch {
      // localStorage might not be available
    }
  }, [sortBy]);

  // Load colorization mode from localStorage
  const [colorizeMode, setColorizeMode] = useState<
    'none' | 'linear' | 'logarithmic'
  >(() => {
    if (typeof window === 'undefined') return 'none';
    try {
      const stored = localStorage.getItem('cluster-arms-colorize-mode');
      if (
        stored === 'none' ||
        stored === 'linear' ||
        stored === 'logarithmic'
      ) {
        return stored;
      }
      return 'none';
    } catch {
      return 'none';
    }
  });

  // Save colorization mode to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('cluster-arms-colorize-mode', colorizeMode);
    } catch {
      // localStorage might not be available
    }
  }, [colorizeMode]);

  // Handle cluster reset
  const handleResetCluster = useCallback(
    async (clearObservabilityCount: boolean) => {
      if (!selectedSkill || !selectedCluster) return;

      setIsResetting(true);
      try {
        await resetCluster(
          selectedSkill.id,
          selectedCluster.id,
          clearObservabilityCount,
        );
        await refetch();
        toast({
          title: 'Partition reset successfully',
          description: `${selectedCluster.name} has been reset and is regenerating configurations.`,
        });
      } catch (error) {
        console.error('Failed to reset cluster:', error);
        toast({
          title: 'Failed to reset partition',
          description:
            error instanceof Error ? error.message : 'Please try again.',
          variant: 'destructive',
        });
      } finally {
        setIsResetting(false);
      }
    },
    [selectedSkill, selectedCluster, refetch, toast],
  );

  // Helper function to get model and provider info for an arm
  const getArmMetadata = useCallback(
    (modelId: string) => {
      const model = skillModels.find((m) => m.id === modelId);
      if (!model) return { modelName: 'Unknown', providerName: 'Unknown' };

      const apiKey = getAPIKeyById(model.ai_provider_id);
      return {
        modelName: model.model_name,
        providerName: apiKey?.ai_provider || 'Unknown',
      };
    },
    [skillModels, getAPIKeyById],
  );

  // Calculate weighted score for an arm based on evaluation weights
  const getWeightedScore = useCallback(
    (armId: string): { score: number; requestCount: number } => {
      // Get all stats for this arm
      const armStatsForArm = armStats.filter((stat) => stat.arm_id === armId);

      if (armStatsForArm.length === 0 || evaluations.length === 0) {
        return { score: 0, requestCount: 0 };
      }

      // Calculate total weight and weighted sum
      let totalWeight = 0;
      let weightedSum = 0;
      let maxRequests = 0;

      for (const stat of armStatsForArm) {
        // Find the corresponding evaluation to get its weight
        const evaluation = evaluations.find((e) => e.id === stat.evaluation_id);
        if (!evaluation) continue;

        totalWeight += evaluation.weight;
        weightedSum += stat.mean * evaluation.weight;
        // Track the maximum n across all evaluations (same requests evaluated multiple times)
        maxRequests = Math.max(maxRequests, stat.n);
      }

      // If no valid evaluations found, return 0
      if (totalWeight === 0) {
        return { score: 0, requestCount: 0 };
      }

      // Calculate weighted average
      const weightedScore = weightedSum / totalWeight;

      return { score: weightedScore, requestCount: maxRequests };
    },
    [armStats, evaluations],
  );

  // Set skill ID and cluster ID when they change
  useEffect(() => {
    if (!selectedSkill) {
      setSkillId(null);
      setModelsSkillId(null);
      setClustersSkillId(null);
      setSkillEventsSkillId(null);
      setEvaluationsSkillId(null);
      return;
    }
    setSkillId(selectedSkill.id);
    setModelsSkillId(selectedSkill.id);
    setClustersSkillId(selectedSkill.id);
    setSkillEventsSkillId(selectedSkill.id);
    setEvaluationsSkillId(selectedSkill.id);
  }, [
    selectedSkill,
    setSkillId,
    setModelsSkillId,
    setClustersSkillId,
    setSkillEventsSkillId,
    setEvaluationsSkillId,
  ]);

  useEffect(() => {
    if (!clusterId) {
      setClusterId(null);
      return;
    }
    setClusterId(clusterId);
  }, [clusterId, setClusterId]);

  // Helper function to get continuous performance-based border color (red to green)
  const getPerformanceColor = useCallback(
    (
      mean: number,
      requestCount: number,
      mode: 'none' | 'linear' | 'logarithmic',
    ) => {
      // If no colorization or no requests, return gray
      if (mode === 'none' || requestCount === 0) {
        return 'rgb(156, 163, 175)'; // Tailwind gray-400
      }

      // Clamp mean between 0 and 1
      let normalized = Math.max(0, Math.min(1, mean));

      // Apply logarithmic scaling if requested
      // This emphasizes the lower end (below 0.7) to be more red
      if (mode === 'logarithmic') {
        // Use a power function to create logarithmic-like scaling
        // Values below 0.7 get pushed toward 0 (red), values above stay similar
        if (normalized < 0.7) {
          // Map 0-0.7 to 0-0.15 using quartic curve (x^4) for extremely aggressive red emphasis
          normalized = (normalized / 0.7) ** 4 * 0.15;
        } else {
          // Map 0.7-1.0 to 0.15-1.0 linearly
          normalized = 0.15 + ((normalized - 0.7) / 0.3) * 0.85;
        }
      }

      // Interpolate from red (0) to green (1)
      // Red: rgb(239, 68, 68) - Tailwind red-500
      // Green: rgb(34, 197, 94) - Tailwind green-500
      const red = Math.round(239 - (239 - 34) * normalized);
      const green = Math.round(68 + (197 - 68) * normalized);
      const blue = Math.round(68 + (94 - 68) * normalized);

      return `rgb(${red}, ${green}, ${blue})`;
    },
    [],
  );

  // Early return if no skill or agent selected
  if (!selectedSkill || !selectedAgent) {
    return (
      <>
        <PageHeader
          title="Partition Configurations"
          description="No partition selected. Please select a partition to view its configurations."
        />
        <div className="p-6">
          <div className="text-center text-muted-foreground">
            No partition selected. Please select a partition to view its
            configurations.
          </div>
        </div>
      </>
    );
  }

  // Show loading state if we have a cluster name in URL but clusters are still loading
  if (
    navigationState.selectedClusterName &&
    !selectedCluster &&
    clustersLoading
  ) {
    return (
      <>
        <PageHeader
          title="Partition Configurations"
          description="Loading partition data..."
          showBackButton={true}
          onBack={goBack}
        />
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 6 }).map(() => (
              <Card key={nanoid()}>
                <CardHeader>
                  <Skeleton className="h-6 w-24 mb-2" />
                  <Skeleton className="h-4 w-16" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div>
                      <Skeleton className="h-4 w-24 mb-2" />
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Skeleton className="h-3 w-16" />
                          <Skeleton className="h-5 w-20" />
                        </div>
                        <div className="flex items-center justify-between">
                          <Skeleton className="h-3 w-12" />
                          <Skeleton className="h-5 w-24" />
                        </div>
                      </div>
                    </div>
                    <div>
                      <Skeleton className="h-4 w-20 mb-2" />
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Skeleton className="h-3 w-20" />
                          <Skeleton className="h-3 w-12" />
                        </div>
                        <div className="flex items-center justify-between">
                          <Skeleton className="h-3 w-16" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </>
    );
  }

  // Show error if cluster name is in URL but not found after loading
  if (
    navigationState.selectedClusterName &&
    !selectedCluster &&
    !clustersLoading
  ) {
    return (
      <>
        <PageHeader
          title="Partition Not Found"
          description="The requested partition could not be found."
          showBackButton={true}
          onBack={goBack}
        />
        <div className="p-6">
          <div className="text-center text-muted-foreground">
            Partition "{navigationState.selectedClusterName}" not found.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Configurations for ${selectedCluster?.name || 'Partition'}`}
        description={`View the performance of each configuration in this partition.`}
        showBackButton={true}
        onBack={goBack}
        actions={
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" title="More options">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setIsResetClusterDialogOpen(true)}
                  disabled={isResetting}
                >
                  <RotateCcwIcon className="h-4 w-4 mr-2" />
                  {isResetting ? 'Resetting...' : 'Reset Partition'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="p-6 space-y-6">
        {/* Partition Info */}
        {selectedCluster && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {selectedSkill ? (
                  <img
                    src={createClusterAvatar(
                      selectedSkill.name,
                      selectedCluster.name,
                    )}
                    alt={`Partition ${selectedCluster.name} icon`}
                    width={20}
                    height={20}
                    className="size-5 rounded-sm shrink-0"
                  />
                ) : (
                  <LayersIcon className="h-5 w-5" />
                )}
                Partition Information
              </CardTitle>
              <CardDescription>
                Total requests:{' '}
                {selectedCluster.observability_total_requests.toString()} (Since
                reflection: {selectedCluster.total_steps.toString()})
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
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
                            Select the end time for the chart (rightmost data
                            point)
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
                    <div className="text-sm font-medium">
                      Performance Over Time
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
                {isLoadingClusterEvaluationScores ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <ClusterPerformanceChart
                    evaluationScores={clusterEvaluationScores}
                    events={skillEvents.filter(
                      (e) =>
                        e.cluster_id === clusterId || e.cluster_id === null,
                    )}
                    size="large"
                    intervalMinutes={INTERVAL_CONFIG[selectedInterval].minutes}
                    windowHours={INTERVAL_CONFIG[selectedInterval].hours}
                    endTime={endTime}
                  />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sort and Display Options */}
        <div className="flex justify-end items-center gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <PaletteIcon className="h-4 w-4 mr-2" />
                Colorize:{' '}
                {colorizeMode === 'none'
                  ? 'None'
                  : colorizeMode === 'linear'
                    ? 'Linear'
                    : 'Logarithmic'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setColorizeMode('none')}>
                None
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setColorizeMode('linear')}>
                Linear
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setColorizeMode('logarithmic')}>
                Logarithmic
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <ArrowUpDown className="h-4 w-4 mr-2" />
                Sort by:{' '}
                {sortBy === 'name'
                  ? 'Name'
                  : sortBy === 'performance'
                    ? 'Performance'
                    : 'Requests'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSortBy('name')}>
                Name
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy('performance')}>
                Performance
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy('requests')}>
                Request Count
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Configurations Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {isLoading ? (
            Array.from({ length: 6 }).map(() => (
              <Card key={nanoid()}>
                <CardHeader>
                  <Skeleton className="h-6 w-24 mb-2" />
                  <Skeleton className="h-4 w-16" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div>
                      <Skeleton className="h-4 w-24 mb-2" />
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Skeleton className="h-3 w-16" />
                          <Skeleton className="h-5 w-20" />
                        </div>
                        <div className="flex items-center justify-between">
                          <Skeleton className="h-3 w-12" />
                          <Skeleton className="h-5 w-24" />
                        </div>
                      </div>
                    </div>
                    <div>
                      <Skeleton className="h-4 w-20 mb-2" />
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Skeleton className="h-3 w-20" />
                          <Skeleton className="h-3 w-12" />
                        </div>
                        <div className="flex items-center justify-between">
                          <Skeleton className="h-3 w-16" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : error ? (
            <div className="col-span-full">
              <Card>
                <CardContent className="pt-6 text-center">
                  <p className="text-destructive mb-4">
                    Failed to load configurations: {error.message}
                  </p>
                  <Button variant="outline" onClick={() => refetch()}>
                    <RefreshCwIcon className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : arms.length === 0 ? (
            <div className="col-span-full">
              <Card>
                <CardContent className="pt-6 text-center">
                  <BoxIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">
                    No configurations found
                  </h3>
                  <p className="text-muted-foreground">
                    This partition has no optimization configurations yet.
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : (
            arms
              .slice()
              .sort((a, b) => {
                if (sortBy === 'name') {
                  return a.name.localeCompare(b.name, undefined, {
                    numeric: true,
                  });
                } else if (sortBy === 'performance') {
                  // Sort by weighted score (higher is better)
                  const scoreA = getWeightedScore(a.id).score;
                  const scoreB = getWeightedScore(b.id).score;
                  return scoreB - scoreA; // Descending
                } else {
                  // requests - sort by total request count
                  const requestsA = getWeightedScore(a.id).requestCount;
                  const requestsB = getWeightedScore(b.id).requestCount;
                  return requestsB - requestsA; // Descending
                }
              })
              .map((arm, index) => {
                const { modelName, providerName } = getArmMetadata(
                  arm.params.model_id,
                );
                const { score: weightedScore, requestCount } = getWeightedScore(
                  arm.id,
                );
                return (
                  <Card
                    key={arm.id}
                    style={
                      colorizeMode !== 'none'
                        ? {
                            borderLeft: `4px solid ${getPerformanceColor(
                              weightedScore,
                              requestCount,
                              colorizeMode,
                            )}`,
                          }
                        : undefined
                    }
                    {...buttonLike({
                      onActivate: () => {
                        if (
                          !selectedAgent ||
                          !selectedSkill ||
                          !selectedCluster
                        )
                          return;
                        navigateToArmDetail(
                          selectedAgent.name,
                          selectedSkill.name,
                          selectedCluster.name,
                          arm.name,
                        );
                      },
                      // The card holds a chart, and a button is named by what
                      // is inside it unless it says otherwise.
                      label: `Configuration ${arm.name}`,
                      className:
                        'hover:shadow-lg hover:border-primary/50 transition-all cursor-pointer',
                    })}
                  >
                    <CardHeader>
                      <CardTitle className="text-lg leading-none mb-2 flex items-center gap-2">
                        {selectedSkill && selectedCluster && (
                          <img
                            src={createArmAvatar(
                              selectedSkill.name,
                              selectedCluster.name,
                              arm.name,
                            )}
                            alt={`Configuration ${arm.name} icon`}
                            width={24}
                            height={24}
                            className="size-6 rounded-sm shrink-0"
                          />
                        )}
                        {arm.name}
                      </CardTitle>
                      <CardDescription className="leading-none m-0">
                        Rank: {index + 1}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div>
                          <div className="text-sm font-medium mb-2">
                            Configuration
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                Provider
                              </span>
                              <Badge variant="secondary">{providerName}</Badge>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                Model
                              </span>
                              <Badge variant="outline">{modelName}</Badge>
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="text-sm font-medium mb-2">
                            Performance
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                Score
                              </span>
                              <Badge variant="outline">
                                {requestCount > 0
                                  ? `${(weightedScore * 100).toFixed(1)}%`
                                  : 'N/A'}
                              </Badge>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                Requests
                              </span>
                              <span>{requestCount}</span>
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="text-sm font-medium mb-2">
                            Parameters
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                Temp
                              </span>
                              <span>
                                {arm.params.temperature_min.toFixed(2)}-
                                {arm.params.temperature_max.toFixed(2)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                Reasoning Effort
                              </span>
                              <span>
                                {arm.params.thinking_min.toFixed(2)}-
                                {arm.params.thinking_max.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
          )}
        </div>
      </div>

      {/* Reset Cluster Dialog */}
      <ResetClusterDialog
        cluster={selectedCluster || null}
        open={isResetClusterDialogOpen}
        onOpenChange={setIsResetClusterDialogOpen}
        onConfirm={handleResetCluster}
        isResetting={isResetting}
      />
    </>
  );
}
