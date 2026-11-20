'use client';

import { type AIProvider, PrettyAIProvider } from '@shared/types/constants';
import type { Model } from '@shared/types/data/model';
import { servesSkills } from '@shared/types/data/model';
import { useQueryClient } from '@tanstack/react-query';
import {
  addModelsToSkill,
  removeModelsFromSkill,
} from '@web/api/v1/super-agents/skills';
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
import { Clock, CpuIcon, Loader2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

interface ManageSkillModelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillId: string;
}

export function ManageSkillModelsDialog({
  open,
  onOpenChange,
  skillId,
}: ManageSkillModelsDialogProps): ReactElement {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { aiProviderConfigs: apiKeys } = useAIProviders();
  const {
    models,
    isLoading: isLoadingAllModels,
    setQueryParams,
    skillModels,
    isLoadingSkillModels,
    setSkillId: setModelsSkillId,
    refetchSkillModels,
  } = useModels();

  const [initialModelIds, setInitialModelIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(
    new Set(),
  );
  const [isSaving, setIsSaving] = useState(false);

  // Load all models and skill models when dialog opens
  useEffect(() => {
    if (open && skillId) {
      setQueryParams({});
      setModelsSkillId(skillId);
    } else if (!open) {
      setModelsSkillId(null);
    }
  }, [open, skillId, setQueryParams, setModelsSkillId]);

  // Update selected models when skill models change
  useEffect(() => {
    if (!open) return;

    const ids = new Set(skillModels.map((model) => model.id));
    setInitialModelIds(ids);
    setSelectedModelIds(ids);
  }, [skillModels, open]);

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
      // Determine what to add and what to remove
      const modelsToAdd = Array.from(selectedModelIds).filter(
        (id) => !initialModelIds.has(id),
      );
      const modelsToRemove = Array.from(initialModelIds).filter(
        (id) => !selectedModelIds.has(id),
      );

      const operations = [];

      if (modelsToRemove.length > 0) {
        operations.push(removeModelsFromSkill(skillId, modelsToRemove));
      }

      if (modelsToAdd.length > 0) {
        operations.push(addModelsToSkill(skillId, modelsToAdd));
      }

      // Execute all operations in parallel
      await Promise.all(operations);

      toast({
        title: 'Models updated successfully',
        description: `Updated models for the skill.`,
      });

      // Invalidate the skill validation cache to refresh the UI
      await queryClient.invalidateQueries({
        queryKey: ['skill-validation-models', skillId],
      });

      // Refresh skill models
      await refetchSkillModels();

      // Close dialog on success
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to save model changes:', error);
      toast({
        title: 'Failed to update models',
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
    // Reset to initial state
    setSelectedModelIds(initialModelIds);
    onOpenChange(false);
  };

  const hasChanges =
    Array.from(selectedModelIds).sort().join(',') !==
    Array.from(initialModelIds).sort().join(',');

  const isProcessing = isSaving;
  const isLoading = isLoadingAllModels || isLoadingSkillModels;

  // Get provider info
  const getProviderInfo = (apiKeyId: string) => {
    const apiKey = apiKeys.find((key) => key.id === apiKeyId);
    const providerType = apiKey
      ? PrettyAIProvider[apiKey.ai_provider as AIProvider] || apiKey.ai_provider
      : 'Unknown Provider';
    const providerName = apiKey?.name || 'Unknown';
    return { providerType, providerName };
  };

  // What a skill can be served by: text models for chat, decision models for
  // System One. Embedding models serve no skill.
  const servingModels = models.filter(servesSkills);

  // Group models by provider, with models sorted alphabetically within each group
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

  // Sort models within each provider group by model name
  for (const providerId of Object.keys(modelsByProvider)) {
    modelsByProvider[providerId].sort((a, b) =>
      compareModels({ modelName: a.model_name }, { modelName: b.model_name }),
    );
  }

  // Sort provider groups alphabetically by provider name
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
            Manage Models
          </DialogTitle>
          <DialogDescription>
            Select models from your configured AI providers. You need at least
            one model for your skill to work.
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
                      } ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}
                      onClick={() => handleToggleModel(model.id)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={selectedModelIds.has(model.id)}
                            onCheckedChange={() => handleToggleModel(model.id)}
                            onClick={(e) => e.stopPropagation()}
                            disabled={isProcessing}
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

        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500 mb-4">
          <Clock size={16} />
          <span>This process may take 1-2 minutes to complete.</span>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || isProcessing}>
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
