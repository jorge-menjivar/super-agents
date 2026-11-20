'use client';

import type { SkillOptimizationArmStat } from '@shared/types/data/skill-optimization-arm-stats';
import { EvaluationMethodName } from '@shared/types/evaluations';
import { useQuery } from '@tanstack/react-query';
import { getSkillArmStats } from '@web/api/v1/super-agents/skills';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@web/components/ui/card';
import { PageHeader } from '@web/components/ui/page-header';
import { Skeleton } from '@web/components/ui/skeleton';
import { useSmartBack } from '@web/hooks/use-smart-back';
import { useAgents } from '@web/providers/agents';
import { useAIProviders } from '@web/providers/ai-providers';
import { useModels } from '@web/providers/models';
import { useSkillOptimizationArms } from '@web/providers/skill-optimization-arms';
import { useSkillOptimizationEvaluations } from '@web/providers/skill-optimization-evaluations';
import { useSkills } from '@web/providers/skills';
import { BoxIcon, RefreshCwIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo } from 'react';

// Pretty names for evaluation methods
const EvaluationMethodNames: Record<EvaluationMethodName, string> = {
  [EvaluationMethodName.TASK_COMPLETION]: 'Task Completion',
  [EvaluationMethodName.ARGUMENT_CORRECTNESS]: 'Argument Correctness',
  [EvaluationMethodName.ROLE_ADHERENCE]: 'Role Adherence',
  [EvaluationMethodName.TURN_RELEVANCY]: 'Turn Relevancy',
  [EvaluationMethodName.TOOL_CORRECTNESS]: 'Tool Correctness',
  [EvaluationMethodName.KNOWLEDGE_RETENTION]: 'Knowledge Retention',
  [EvaluationMethodName.CONVERSATION_COMPLETENESS]: 'Conversation Completeness',
  [EvaluationMethodName.LATENCY]: 'Latency',
  [EvaluationMethodName.DECISION_CORRECTNESS]: 'Decision Correctness',
};

export function ArmDetailView(): ReactElement {
  const { selectedAgent } = useAgents();
  const { selectedSkill } = useSkills();
  const goBack = useSmartBack();

  const { selectedArm, isLoading, error, refetch, setSkillId, setClusterId } =
    useSkillOptimizationArms();
  const { skillModels, setSkillId: setModelsSkillId } = useModels();
  const { getAPIKeyById } = useAIProviders();
  const { evaluations, setSkillId: setEvaluationsSkillId } =
    useSkillOptimizationEvaluations();

  const clusterId = selectedArm?.cluster_id;

  // Fetch arm stats for this specific arm
  const { data: armStats = [] } = useQuery<SkillOptimizationArmStat[]>({
    queryKey: ['armStats', selectedArm?.id],
    queryFn: () => {
      if (!selectedArm || !selectedSkill) return [];
      return getSkillArmStats(selectedSkill.id);
    },
    enabled: !!selectedArm && !!selectedSkill,
  });

  // Filter arm stats for this specific arm
  const armStatsForArm = useMemo(
    () => armStats.filter((stat) => stat.arm_id === selectedArm?.id),
    [armStats, selectedArm?.id],
  );

  // Get model and provider info
  const modelInfo = useMemo(() => {
    if (!selectedArm) return null;
    const model = skillModels.find((m) => m.id === selectedArm.params.model_id);
    if (!model) return null;

    const apiKey = getAPIKeyById(model.ai_provider_id);
    return {
      modelName: model.model_name,
      providerName: apiKey?.ai_provider || 'Unknown',
    };
  }, [selectedArm, skillModels, getAPIKeyById]);

  // Set skill ID and cluster ID when they change
  useEffect(() => {
    if (!selectedSkill) {
      setSkillId(null);
      setModelsSkillId(null);
      setEvaluationsSkillId(null);
      return;
    }
    setSkillId(selectedSkill.id);
    setModelsSkillId(selectedSkill.id);
    setEvaluationsSkillId(selectedSkill.id);
  }, [selectedSkill, setSkillId, setModelsSkillId, setEvaluationsSkillId]);

  useEffect(() => {
    if (!clusterId) {
      setClusterId(null);
      return;
    }
    setClusterId(clusterId);
  }, [clusterId, setClusterId]);

  // Early return if no skill or agent or arm selected
  if (!selectedSkill || !selectedAgent || !selectedArm) {
    return (
      <>
        <PageHeader
          title="Configuration Details"
          description="No configuration selected. Please select a configuration to view its details."
        />
        <div className="p-6">
          <div className="text-center text-muted-foreground">
            No configuration selected. Please select a configuration to view its
            details.
          </div>
        </div>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <PageHeader
          title="Configuration Details"
          description="Loading configuration details..."
          showBackButton={true}
          onBack={goBack}
        />
        <div className="p-6 space-y-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-full" />
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader
          title="Configuration Details"
          description="Failed to load configuration details"
          showBackButton={true}
          onBack={goBack}
        />
        <div className="p-6">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-destructive mb-4">
                Failed to load configuration details: {error.message}
              </p>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCwIcon className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  if (!selectedArm) {
    return (
      <>
        <PageHeader
          title="Configuration Details"
          description="Configuration not found"
          showBackButton={true}
          onBack={goBack}
        />
        <div className="p-6">
          <Card>
            <CardContent className="pt-6 text-center">
              <BoxIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                Configuration not found
              </h3>
              <p className="text-muted-foreground">
                The requested configuration could not be found.
              </p>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={selectedArm.name}
        description="Configuration details and performance metrics"
        showBackButton={true}
        onBack={goBack}
      />

      <div className="p-6 space-y-6">
        {/* Model & Provider Information */}
        <Card>
          <CardHeader>
            <CardTitle>Model & Provider</CardTitle>
            <CardDescription>
              AI model and provider used by this configuration
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">
                  AI Provider
                </div>
                <Badge variant="secondary" className="text-sm">
                  {modelInfo?.providerName || 'Unknown'}
                </Badge>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">
                  Model
                </div>
                <Badge variant="outline" className="text-sm">
                  {modelInfo?.modelName || 'Unknown'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Performance Statistics by Evaluation Method */}
        <Card>
          <CardHeader>
            <CardTitle>Performance by Evaluation Method</CardTitle>
            <CardDescription>
              Performance metrics for each evaluation method
            </CardDescription>
          </CardHeader>
          <CardContent>
            {armStatsForArm.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                No performance data available yet. This configuration needs to
                receive requests to generate statistics.
              </div>
            ) : (
              <div className="space-y-4">
                {armStatsForArm.map((stat) => {
                  const evaluation = evaluations.find(
                    (e) => e.id === stat.evaluation_id,
                  );
                  const methodName = evaluation
                    ? EvaluationMethodNames[evaluation.evaluation_method]
                    : 'Unknown Method';

                  return (
                    <div
                      key={stat.evaluation_id}
                      className="flex items-center justify-between p-3 bg-muted rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="font-medium text-sm">{methodName}</div>
                        <div className="text-xs text-muted-foreground">
                          {stat.n} request{stat.n !== 1 ? 's' : ''} • Weight:{' '}
                          {evaluation?.weight.toFixed(1) || 'N/A'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            stat.mean >= 0.7
                              ? 'default'
                              : stat.mean >= 0.5
                                ? 'secondary'
                                : 'destructive'
                          }
                          className="text-sm"
                        >
                          {(stat.mean * 100).toFixed(1)}%
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Model Parameters */}
        <Card>
          <CardHeader>
            <CardTitle>Model Parameters</CardTitle>
            <CardDescription>
              Parameter ranges for this configuration
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium mb-2">Temperature</div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Min:</span>
                    <Badge variant="outline">
                      {selectedArm.params.temperature_min.toFixed(2)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-muted-foreground">Max:</span>
                    <Badge variant="outline">
                      {selectedArm.params.temperature_max.toFixed(2)}
                    </Badge>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium mb-2">Top P</div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Min:</span>
                    <Badge variant="outline">
                      {selectedArm.params.top_p_min.toFixed(2)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-muted-foreground">Max:</span>
                    <Badge variant="outline">
                      {selectedArm.params.top_p_max.toFixed(2)}
                    </Badge>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium mb-2">Top K</div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Min:</span>
                    <Badge variant="outline">
                      {selectedArm.params.top_k_min.toFixed(2)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-muted-foreground">Max:</span>
                    <Badge variant="outline">
                      {selectedArm.params.top_k_max.toFixed(2)}
                    </Badge>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium mb-2">
                    Frequency Penalty
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Min:</span>
                    <Badge variant="outline">
                      {selectedArm.params.frequency_penalty_min.toFixed(2)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-muted-foreground">Max:</span>
                    <Badge variant="outline">
                      {selectedArm.params.frequency_penalty_max.toFixed(2)}
                    </Badge>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium mb-2">
                    Presence Penalty
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Min:</span>
                    <Badge variant="outline">
                      {selectedArm.params.presence_penalty_min.toFixed(2)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-muted-foreground">Max:</span>
                    <Badge variant="outline">
                      {selectedArm.params.presence_penalty_max.toFixed(2)}
                    </Badge>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium mb-2">Thinking</div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Min:</span>
                    <Badge variant="outline">
                      {selectedArm.params.thinking_min.toFixed(2)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-muted-foreground">Max:</span>
                    <Badge variant="outline">
                      {selectedArm.params.thinking_max.toFixed(2)}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* System Prompt */}
        <Card>
          <CardHeader>
            <CardTitle>System Prompt</CardTitle>
            <CardDescription>
              The system prompt template for this configuration
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-muted p-4 rounded font-mono text-sm whitespace-pre-wrap break-words">
              {selectedArm.params.system_prompt}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
