'use client';

import type { AIProvider } from '@shared/types/constants';
import { PrettyAIProvider } from '@shared/types/constants';
import {
  type EvaluationMethodDetails,
  type EvaluationMethodName,
  evaluationMethodAppliesTo,
} from '@shared/types/evaluations';
import {
  addModelsToSkill,
  getEvaluationMethods,
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
import { Checkbox } from '@web/components/ui/checkbox';
import { Label } from '@web/components/ui/label';
import { PageHeader } from '@web/components/ui/page-header';
import { Skeleton } from '@web/components/ui/skeleton';
import { usePermissiveNavigate } from '@web/hooks/use-permissive-navigate';
import { useToast } from '@web/hooks/use-toast';
import { useAgents } from '@web/providers/agents';
import { useAIProviders } from '@web/providers/ai-providers';
import { useModels } from '@web/providers/models';
import { useSkillOptimizationEvaluations } from '@web/providers/skill-optimization-evaluations';
import { useSkills } from '@web/providers/skills';
import { CheckCircle2, Clock, CpuIcon, Loader2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

interface SelectedModel {
  providerId: string;
  modelName: string;
}

export function CreateSkillCompleteView(): ReactElement {
  const { selectedAgent } = useAgents();
  const { selectedSkill } = useSkills();
  const { createEvaluation } = useSkillOptimizationEvaluations();
  const { aiProviderConfigs: apiKeys, isLoading: isLoadingAPIKeys } =
    useAIProviders();
  const { models, isLoading: isLoadingModels, setQueryParams } = useModels();
  const navigate = usePermissiveNavigate();
  const { toast } = useToast();

  const [selectedModels, setSelectedModels] = useState<SelectedModel[]>([]);
  const [selectedEvaluations, setSelectedEvaluations] = useState<
    EvaluationMethodName[]
  >([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [evaluationMethods, setEvaluationMethods] = useState<
    EvaluationMethodDetails[]
  >([]);
  const [isLoadingEvaluations, setIsLoadingEvaluations] = useState(true);

  // Fetch all models on mount
  useEffect(() => {
    setQueryParams({});
  }, [setQueryParams]);

  // Fetch evaluation methods from server
  useEffect(() => {
    const fetchMethods = async () => {
      try {
        setIsLoadingEvaluations(true);
        const methods = await getEvaluationMethods();
        setEvaluationMethods(methods);
      } catch (error) {
        console.error('Failed to fetch evaluation methods:', error);
        toast({
          title: 'Failed to load evaluation methods',
          description: 'Please try refreshing the page.',
          variant: 'destructive',
        });
      } finally {
        setIsLoadingEvaluations(false);
      }
    };

    fetchMethods();
  }, [toast]);

  const handleToggleModel = (providerId: string, modelName: string) => {
    setSelectedModels((prev) => {
      const exists = prev.some(
        (m) => m.providerId === providerId && m.modelName === modelName,
      );
      if (exists) {
        return prev.filter(
          (m) => !(m.providerId === providerId && m.modelName === modelName),
        );
      }
      return [...prev, { providerId, modelName }];
    });
  };

  const handleToggleEvaluation = (method: EvaluationMethodName) => {
    setSelectedEvaluations((prev) => {
      if (prev.includes(method)) {
        return prev.filter((m) => m !== method);
      }
      return [...prev, method];
    });
  };

  const isModelSelected = (providerId: string, modelName: string) => {
    return selectedModels.some(
      (m) => m.providerId === providerId && m.modelName === modelName,
    );
  };

  const handleSubmit = async () => {
    if (!selectedSkill) {
      toast({
        title: 'Error',
        description: 'No skill selected',
        variant: 'destructive',
      });
      return;
    }

    // Validate at least one model is selected
    if (selectedModels.length === 0) {
      toast({
        title: 'No models selected',
        description: 'Please select at least one model for your skill.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Run both operations in parallel
      const operations = [];

      // Add models operation
      if (selectedModels.length > 0) {
        const modelIds = selectedModels
          .map((sm) => {
            const model = models.find(
              (m) =>
                m.ai_provider_id === sm.providerId &&
                m.model_name === sm.modelName,
            );
            return model?.id;
          })
          .filter((id): id is string => id !== undefined);

        if (modelIds.length > 0) {
          operations.push(addModelsToSkill(selectedSkill.id, modelIds));
        }
      }

      // Add evaluations operation
      if (selectedEvaluations.length > 0) {
        operations.push(
          createEvaluation(selectedSkill.id, selectedEvaluations),
        );
      }

      // Execute both in parallel
      await Promise.all(operations);

      toast({
        title: 'Setup complete!',
        description: `Added ${selectedModels.length} model(s)${selectedEvaluations.length > 0 ? ` and ${selectedEvaluations.length} evaluation method(s)` : ''} to ${selectedSkill.name}.`,
      });

      // Navigate to skill dashboard (replace to remove setup page from history)
      if (selectedAgent && selectedSkill) {
        navigate({
          to: '/agents/$agentName/skills/$skillName',
          params: {
            agentName: selectedAgent.name,
            skillName: selectedSkill.name,
          },
          replace: true,
        });
      }
    } catch (error) {
      console.error('Error completing setup:', error);
      toast({
        title: 'Failed to complete setup',
        description:
          error instanceof Error
            ? error.message
            : 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    // Navigate to skill dashboard without adding anything (replace to remove setup page from history)
    if (selectedAgent && selectedSkill) {
      navigate({
        to: '/agents/$agentName/skills/$skillName',
        params: {
          agentName: selectedAgent.name,
          skillName: selectedSkill.name,
        },
        replace: true,
      });
    }
  };

  if (!selectedAgent || !selectedSkill) {
    return (
      <>
        <PageHeader
          title="Complete Skill Setup"
          description="Configure models and evaluations for your skill"
          showBackButton={false}
        />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-muted-foreground">
              No skill selected. Please create a skill first.
            </p>
          </div>
        </div>
      </>
    );
  }

  // The models of the agent's own type: the database takes no other.
  const servingModels = models.filter(
    (model) => model.model_type === selectedAgent.agent_type,
  );
  // And the methods that can judge its skills: the API takes no other.
  const applicableMethods = evaluationMethods.filter((method) =>
    evaluationMethodAppliesTo(method, selectedAgent.agent_type),
  );

  // Group models by provider
  const modelsByProvider = servingModels.reduce(
    (acc, model) => {
      if (!acc[model.ai_provider_id]) {
        acc[model.ai_provider_id] = [];
      }
      acc[model.ai_provider_id].push(model);
      return acc;
    },
    {} as Record<string, typeof servingModels>,
  );

  return (
    <>
      <PageHeader
        title="Complete Skill Setup"
        description={`Configure models and evaluations for ${selectedSkill.name}`}
        onBack={handleSkip}
      />
      <div className="container mx-auto py-6 max-w-5xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Models Section */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CpuIcon className="h-5 w-5 text-primary" />
                Select Models
              </CardTitle>
              <CardDescription>
                Select models from your configured AI providers. You need at
                least one model for your skill to work.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoadingModels || isLoadingAPIKeys ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : Object.keys(modelsByProvider).length === 0 ? (
                <div className="text-center py-8">
                  <CpuIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">
                    No models available
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    You need to add AI models first. Go to AI Providers to add
                    models.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => navigate({ to: '/ai-providers' })}
                  >
                    Go to AI Providers
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 border rounded-md p-3">
                  {Object.entries(modelsByProvider).map(
                    ([providerId, providerModels]) => {
                      const apiKey = apiKeys.find((k) => k.id === providerId);
                      const providerType = apiKey
                        ? PrettyAIProvider[apiKey.ai_provider as AIProvider] ||
                          apiKey.ai_provider
                        : 'Unknown Provider';
                      const providerName = apiKey?.name || 'Unknown';

                      return (
                        <div key={providerId} className="space-y-2">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-medium">
                              {providerName}
                            </span>
                            <Badge variant="secondary">{providerType}</Badge>
                            <span className="text-xs text-muted-foreground">
                              • {providerModels.length} model(s)
                            </span>
                          </div>
                          {providerModels.map((model) => (
                            <Card
                              key={model.id}
                              className={`cursor-pointer transition-all ${
                                isModelSelected(providerId, model.model_name)
                                  ? 'border-primary bg-primary/5'
                                  : 'hover:border-primary/50'
                              }`}
                              onClick={() =>
                                handleToggleModel(providerId, model.model_name)
                              }
                            >
                              <CardContent className="p-3">
                                <div className="flex items-center gap-3">
                                  <Checkbox
                                    checked={isModelSelected(
                                      providerId,
                                      model.model_name,
                                    )}
                                    onCheckedChange={() =>
                                      handleToggleModel(
                                        providerId,
                                        model.model_name,
                                      )
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium truncate">
                                      {model.model_name}
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      );
                    },
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Evaluations Section */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                Select Evaluations
              </CardTitle>
              <CardDescription>
                Evaluations help measure and improve your skill's performance.
                You can add them later if you prefer.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoadingEvaluations ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : applicableMethods.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">
                    No evaluation methods available
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Unable to load evaluation methods. Please try again later.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 border rounded-md p-3">
                  {applicableMethods.map((method) => (
                    <Card
                      key={method.method}
                      className={`cursor-pointer transition-all ${
                        selectedEvaluations.includes(method.method)
                          ? 'border-primary bg-primary/5'
                          : 'hover:border-primary/50'
                      }`}
                      onClick={() => handleToggleEvaluation(method.method)}
                    >
                      <CardContent className="p-4">
                        <div className="flex gap-3">
                          <div className="pt-0.5">
                            <Checkbox
                              checked={selectedEvaluations.includes(
                                method.method,
                              )}
                              onCheckedChange={() =>
                                handleToggleEvaluation(method.method)
                              }
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                          <div className="flex-1">
                            <Label className="text-base font-medium cursor-pointer">
                              {method.name}
                            </Label>
                            <p className="text-sm text-muted-foreground mt-1">
                              {method.description}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Action Buttons */}
        <Card className="mt-6 shadow-lg">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500 mb-4">
              <Clock size={16} />
              <span>This process may take 1-2 minutes to complete.</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={handleSkip}
                disabled={isSubmitting}
                className="flex-1"
              >
                Skip for now
              </Button>
              <Button
                type="button"
                size="lg"
                onClick={handleSubmit}
                disabled={isSubmitting || selectedModels.length === 0}
                className="flex-1"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Complete Setup
                    {(selectedModels.length > 0 ||
                      selectedEvaluations.length > 0) && (
                      <span className="ml-2 text-sm">
                        ({selectedModels.length} model
                        {selectedModels.length !== 1 && 's'}
                        {selectedEvaluations.length > 0 &&
                          `, ${selectedEvaluations.length} evaluation${selectedEvaluations.length !== 1 ? 's' : ''}`}
                        )
                      </span>
                    )}
                  </>
                )}
              </Button>
            </div>

            {/* Summary */}
            {(selectedModels.length > 0 || selectedEvaluations.length > 0) && (
              <div className="mt-4 pt-4 border-t">
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium">Summary:</span> Adding{' '}
                  {selectedModels.length} model
                  {selectedModels.length !== 1 && 's'}
                  {selectedEvaluations.length > 0 &&
                    ` and ${selectedEvaluations.length} evaluation method${selectedEvaluations.length !== 1 ? 's' : ''}`}{' '}
                  to <span className="font-medium">{selectedSkill.name}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tips Card */}
        <Card className="mt-6 border-primary/20 bg-primary/5">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Setup Tips
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm space-y-2">
              <p className="flex items-start gap-2">
                <span className="text-primary font-medium">•</span>
                <span>
                  Both operations run in parallel, saving you time during setup
                </span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-primary font-medium">•</span>
                <span>
                  You can add or remove models and evaluations later from the
                  skill dashboard
                </span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-primary font-medium">•</span>
                <span>
                  Start with a few models and evaluations - you can always
                  expand later
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
