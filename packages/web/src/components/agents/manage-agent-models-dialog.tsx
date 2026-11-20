'use client';

import { type AIProvider, PrettyAIProvider } from '@shared/types/constants';
import type { AgentType } from '@shared/types/data/agent';
import type { Model } from '@shared/types/data/model';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addModelsToAgent,
  getAgentModels,
  removeModelsFromAgent,
} from '@web/api/v1/super-agents/agents';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { Card, CardContent } from '@web/components/ui/card';
import { Checkbox } from '@web/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@web/components/ui/dialog';
import { useToast } from '@web/hooks/use-toast';
import { useAIProviders } from '@web/providers/ai-providers';
import { useModels } from '@web/providers/models';
import { compareModels } from '@web/utils/model-sorting';
import { CpuIcon, Loader2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

/**
 * A stable "nothing yet" for the query below. A fresh `[]` per render would
 * change the dependency of the effect that mirrors it into state, which then
 * re-renders, which makes another `[]` -- and so on until the heap runs out.
 */
const NO_MODELS: Model[] = [];

interface ManageAgentModelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  /** What serves the agent, and so the only models on offer. */
  agentType: AgentType;
}

/**
 * Picks the agent's default models: what a skill the gateway creates for the
 * agent starts with. Same picker as the skill's, minus the arm regeneration,
 * because nothing is rebuilt when an agent's defaults change.
 */
export function ManageAgentModelsDialog({
  open,
  onOpenChange,
  agentId,
  agentType,
}: ManageAgentModelsDialogProps): ReactElement {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { aiProviderConfigs: apiKeys } = useAIProviders();
  const { models, isLoading: isLoadingAllModels, setQueryParams } = useModels();
  const { data, isLoading: isLoadingAgentModels } = useQuery({
    queryKey: ['models', 'agent', agentId],
    queryFn: () => getAgentModels(agentId),
    enabled: open && !!agentId,
  });
  const agentModels = data ?? NO_MODELS;

  const [initialModelIds, setInitialModelIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(
    new Set(),
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setQueryParams({});
    }
  }, [open, setQueryParams]);

  useEffect(() => {
    if (!open) return;

    const ids = new Set(agentModels.map((model) => model.id));
    setInitialModelIds(ids);
    setSelectedModelIds(ids);
  }, [agentModels, open]);

  const handleToggleModel = (modelId: string) => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const modelsToAdd = Array.from(selectedModelIds).filter(
        (id) => !initialModelIds.has(id),
      );
      const modelsToRemove = Array.from(initialModelIds).filter(
        (id) => !selectedModelIds.has(id),
      );

      const operations = [];
      if (modelsToRemove.length > 0) {
        operations.push(removeModelsFromAgent(agentId, modelsToRemove));
      }
      if (modelsToAdd.length > 0) {
        operations.push(addModelsToAgent(agentId, modelsToAdd));
      }
      await Promise.all(operations);

      toast({
        title: 'Default models updated',
        description: 'Skills the gateway creates for this agent will use them.',
      });

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['models', 'agent', agentId],
        }),
        // The skills the gateway created without models take the new
        // defaults, so their readiness changes too.
        queryClient.invalidateQueries({
          queryKey: ['agent-unready-skills-data'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['skill-validation-models'],
        }),
      ]);

      onOpenChange(false);
    } catch (error) {
      console.error('Failed to save default models:', error);
      toast({
        title: 'Failed to update default models',
        description:
          error instanceof Error
            ? error.message
            : 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setSelectedModelIds(initialModelIds);
    onOpenChange(false);
  };

  const hasChanges =
    Array.from(selectedModelIds).sort().join(',') !==
    Array.from(initialModelIds).sort().join(',');

  const isLoading = isLoadingAllModels || isLoadingAgentModels;

  const getProviderInfo = (apiKeyId: string) => {
    const apiKey = apiKeys.find((key) => key.id === apiKeyId);
    const providerType = apiKey
      ? PrettyAIProvider[apiKey.ai_provider as AIProvider] || apiKey.ai_provider
      : 'Unknown Provider';
    const providerName = apiKey?.name || 'Unknown';
    return { providerType, providerName };
  };

  // The models of the agent's own type: the database takes no other.
  const servingModels = models.filter(
    (model) => model.model_type === agentType,
  );

  const modelsByProvider = servingModels.reduce(
    (acc, model) => {
      if (!acc[model.ai_provider_id]) {
        acc[model.ai_provider_id] = [];
      }
      acc[model.ai_provider_id].push(model);
      return acc;
    },
    {} as Record<string, Model[]>,
  );
  for (const providerId of Object.keys(modelsByProvider)) {
    modelsByProvider[providerId].sort((a, b) =>
      compareModels({ modelName: a.model_name }, { modelName: b.model_name }),
    );
  }
  const sortedProviderEntries = Object.entries(modelsByProvider).sort(
    ([providerIdA], [providerIdB]) => {
      const { providerName: nameA } = getProviderInfo(providerIdA);
      const { providerName: nameB } = getProviderInfo(providerIdB);
      return nameA.toLowerCase().localeCompare(nameB.toLowerCase());
    },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CpuIcon size={20} />
            Default Models
          </DialogTitle>
          <DialogDescription>
            The models a skill starts with when the gateway creates it for a
            request that named only this agent. Existing skills keep their own.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 border rounded-md p-3 max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2
                size={24}
                className="animate-spin text-muted-foreground"
              />
            </div>
          ) : sortedProviderEntries.length === 0 ? (
            <div className="text-center py-8">
              <CpuIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                No models available
              </h3>
              <p className="text-muted-foreground">
                You need to add AI models first. Go to AI Providers to add
                models.
              </p>
            </div>
          ) : (
            sortedProviderEntries.map(([providerId, providerModels]) => {
              const { providerType, providerName } =
                getProviderInfo(providerId);

              return (
                <div key={providerId} className="space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium">{providerName}</span>
                    <Badge variant="secondary">{providerType}</Badge>
                    <span className="text-xs text-muted-foreground">
                      • {providerModels.length} model(s)
                    </span>
                  </div>
                  {providerModels.map((model) => (
                    <Card
                      key={model.id}
                      className={`cursor-pointer transition-all ${
                        selectedModelIds.has(model.id)
                          ? 'border-primary bg-primary/5'
                          : 'hover:border-primary/50'
                      } ${isSaving ? 'opacity-50 pointer-events-none' : ''}`}
                      onClick={() => handleToggleModel(model.id)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            aria-label={model.model_name}
                            checked={selectedModelIds.has(model.id)}
                            onCheckedChange={() => handleToggleModel(model.id)}
                            onClick={(e) => e.stopPropagation()}
                            disabled={isSaving}
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
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
            {isSaving ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
