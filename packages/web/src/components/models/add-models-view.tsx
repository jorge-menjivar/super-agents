'use client';

import { getKnownEmbeddingDimensions } from '@shared/constants/embedding-models';
import type { AIProvider } from '@shared/types/constants';
import { isDecisionProvider, PrettyAIProvider } from '@shared/types/constants';
import type { ModelType } from '@shared/types/data/model';
import { createModel } from '@web/api/v1/super-agents/models';
import { Button } from '@web/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@web/components/ui/card';
import { Input } from '@web/components/ui/input';
import { Label } from '@web/components/ui/label';
import { ModelAutocompleteInput } from '@web/components/ui/model-autocomplete-input';
import { PageHeader } from '@web/components/ui/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@web/components/ui/select';
import { usePermissiveNavigate } from '@web/hooks/use-permissive-navigate';
import { useToast } from '@web/hooks/use-toast';
import { useAIProviders } from '@web/providers/ai-providers';
import { useModels } from '@web/providers/models';
import {
  AlertCircle,
  CpuIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

interface AddModelsViewProps {
  providerId: string;
}

interface ModelField {
  id: string;
  modelName: string;
  modelType: ModelType;
  embeddingDimensions: string;
  dimensionsAutoFilled?: boolean; // Track if we auto-filled dimensions
  error?: string;
  dimensionsError?: string;
}

export function AddModelsView({
  providerId,
}: AddModelsViewProps): ReactElement {
  const navigate = usePermissiveNavigate();
  const { toast } = useToast();
  const { aiProviderConfigs: apiKeys } = useAIProviders();
  const { refetch } = useModels();

  const provider = apiKeys.find((key) => key.id === providerId);
  // A decision provider serves decision models and nothing else, so the type
  // is not a choice there.
  const decisionProvider = isDecisionProvider(provider?.ai_provider);
  const defaultModelType: ModelType = decisionProvider ? 'decision' : 'text';

  const [modelFields, setModelFields] = useState<ModelField[]>([
    {
      id: nanoid(),
      modelName: '',
      modelType: defaultModelType,
      embeddingDimensions: '',
    },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The providers load after the first render; a decision provider found then
  // still decides the type of the fields already on the page.
  useEffect(() => {
    if (decisionProvider) {
      setModelFields((fields) =>
        fields.map((field) => ({ ...field, modelType: 'decision' })),
      );
    }
  }, [decisionProvider]);

  useEffect(() => {
    if (!provider) {
      navigate({ to: '/ai-providers' });
    }
  }, [provider, navigate]);

  if (!provider) {
    return <div>Loading...</div>;
  }

  const handleAddField = () => {
    setModelFields([
      ...modelFields,
      {
        id: nanoid(),
        modelName: '',
        modelType: defaultModelType,
        embeddingDimensions: '',
      },
    ]);
  };

  const handleRemoveField = (id: string) => {
    if (modelFields.length === 1) return; // Keep at least one field
    setModelFields(modelFields.filter((field) => field.id !== id));
  };

  const handleModelNameChange = (id: string, value: string) => {
    setModelFields(
      modelFields.map((field) => {
        if (field.id !== id) return field;

        const updatedField = { ...field, modelName: value, error: undefined };

        // Auto-fill dimensions for known embedding models
        if (field.modelType === 'embed') {
          const knownDimensions = getKnownEmbeddingDimensions(value);
          if (knownDimensions !== undefined) {
            // Auto-fill with known dimensions
            updatedField.embeddingDimensions = String(knownDimensions);
            updatedField.dimensionsAutoFilled = true;
            updatedField.dimensionsError = undefined;
          } else if (field.dimensionsAutoFilled) {
            // Model no longer matches - clear auto-filled dimensions
            updatedField.embeddingDimensions = '';
            updatedField.dimensionsAutoFilled = false;
          }
        }

        return updatedField;
      }),
    );
  };

  const handleModelTypeChange = (id: string, value: ModelType) => {
    setModelFields(
      modelFields.map((field) => {
        if (field.id !== id) return field;

        if (value !== 'embed') {
          // Only an embed model has dimensions
          return {
            ...field,
            modelType: value,
            embeddingDimensions: '',
            dimensionsAutoFilled: false,
            dimensionsError: undefined,
          };
        }

        // Switching to embed - try to auto-fill dimensions from known models
        const knownDimensions = getKnownEmbeddingDimensions(field.modelName);
        const shouldAutoFill = knownDimensions !== undefined;
        return {
          ...field,
          modelType: value,
          embeddingDimensions: shouldAutoFill
            ? String(knownDimensions)
            : field.embeddingDimensions,
          dimensionsAutoFilled: shouldAutoFill,
          dimensionsError: undefined,
        };
      }),
    );
  };

  const handleEmbeddingDimensionsChange = (id: string, value: string) => {
    setModelFields(
      modelFields.map((field) =>
        field.id === id
          ? {
              ...field,
              embeddingDimensions: value,
              dimensionsAutoFilled: false, // User manually edited
              dimensionsError: undefined,
            }
          : field,
      ),
    );
  };

  const handleSubmit = async () => {
    // Validate all fields
    const updatedFields = modelFields.map((field) => {
      let error: string | undefined;
      let dimensionsError: string | undefined;

      if (field.modelName.trim() === '') {
        error = 'Model name is required';
      }

      if (field.modelType === 'embed') {
        const dims = field.embeddingDimensions.trim();
        if (dims === '') {
          dimensionsError = 'Embedding dimensions is required for embed models';
        } else {
          const parsed = Number.parseInt(dims, 10);
          if (Number.isNaN(parsed) || parsed <= 0) {
            dimensionsError = 'Must be a positive integer';
          }
        }
      }

      return { ...field, error, dimensionsError };
    });

    setModelFields(updatedFields);

    // Check if any field has an error
    if (updatedFields.some((field) => field.error || field.dimensionsError)) {
      return;
    }

    // Check for duplicate model names
    const modelNames = updatedFields.map((field) => field.modelName.trim());
    const uniqueModelNames = new Set(modelNames);

    if (uniqueModelNames.size !== modelNames.length) {
      toast({
        title: 'Duplicate model names',
        description: 'Please ensure all model names are unique.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Create all models
      await Promise.all(
        updatedFields.map((field) =>
          createModel({
            model_name: field.modelName.trim(),
            ai_provider_id: provider.id,
            model_type: field.modelType,
            embedding_dimensions:
              field.modelType === 'embed'
                ? Number.parseInt(field.embeddingDimensions, 10)
                : null,
          }),
        ),
      );

      toast({
        title: 'Models added successfully',
        description: `Added ${uniqueModelNames.size} model(s) to ${provider.name}.`,
      });

      // Navigate back to providers page with provider selected
      await refetch();
      navigate({ to: '/ai-providers', search: { provider: provider.id } });
    } catch (error) {
      console.error('Error adding models:', error);
      toast({
        title: 'Failed to add models',
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

  const handleBack = () => {
    window.history.back();
  };

  return (
    <>
      <PageHeader
        title="Add Models"
        description={`Add models for ${provider.name}`}
        onBack={handleBack}
      />
      <div className="p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CpuIcon className="h-5 w-5" />
              Add Models to{' '}
              {PrettyAIProvider[provider.ai_provider as AIProvider] ||
                provider.ai_provider}
            </CardTitle>
            <CardDescription>
              Add one or more models for this AI provider. You can add multiple
              models at once by clicking the "+" button.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Info Banner */}
            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-md p-3 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-1">
                  Model names
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  Enter the exact model name as specified by the AI provider
                  (e.g., "gpt-5", "claude-sonnet-4-5").
                </p>
              </div>
            </div>

            {/* Model Fields */}
            <div className="space-y-4">
              {modelFields.map((field, index) => (
                <div key={field.id} className="space-y-2">
                  <Label htmlFor={`model-${field.id}`}>
                    Model {index + 1}
                    {modelFields.length > 1 && (
                      <span className="text-muted-foreground text-xs ml-1">
                        (optional)
                      </span>
                    )}
                  </Label>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-1">
                      <ModelAutocompleteInput
                        id={`model-${field.id}`}
                        placeholder={
                          decisionProvider
                            ? 'e.g., jev-latest, drex-latest'
                            : 'e.g., gpt-5, text-embedding-3-small'
                        }
                        value={field.modelName}
                        onChange={(newValue) =>
                          handleModelNameChange(field.id, newValue)
                        }
                        provider={provider.ai_provider as AIProvider}
                        modelType={field.modelType}
                        className={field.error ? 'border-destructive' : ''}
                        aria-invalid={!!field.error}
                      />
                      {field.error && (
                        <p className="text-xs text-destructive">
                          {field.error}
                        </p>
                      )}
                    </div>
                    <div className="w-[120px]">
                      <Select
                        value={field.modelType}
                        onValueChange={(value: ModelType) =>
                          handleModelTypeChange(field.id, value)
                        }
                        disabled={decisionProvider}
                      >
                        <SelectTrigger aria-label="Model type">
                          <SelectValue placeholder="Type" />
                        </SelectTrigger>
                        <SelectContent>
                          {decisionProvider ? (
                            <SelectItem value="decision">Decision</SelectItem>
                          ) : (
                            <>
                              <SelectItem value="text">Text</SelectItem>
                              <SelectItem value="embed">Embed</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    {field.modelType === 'embed' && (
                      <div className="w-[140px] space-y-1">
                        <Input
                          id={`dimensions-${field.id}`}
                          placeholder="Dimensions"
                          value={field.embeddingDimensions}
                          onChange={(e) =>
                            handleEmbeddingDimensionsChange(
                              field.id,
                              e.target.value,
                            )
                          }
                          className={
                            field.dimensionsError ? 'border-destructive' : ''
                          }
                        />
                        {field.dimensionsError && (
                          <p className="text-xs text-destructive">
                            {field.dimensionsError}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="flex gap-1">
                      {index === modelFields.length - 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={handleAddField}
                          className="shrink-0"
                        >
                          <PlusIcon className="h-4 w-4" />
                        </Button>
                      )}
                      {modelFields.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => handleRemoveField(field.id)}
                          className="shrink-0 text-destructive hover:text-destructive"
                        >
                          <Trash2Icon className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Adding...
                  </>
                ) : (
                  <>
                    <SaveIcon className="h-4 w-4 mr-2" />
                    Add{' '}
                    {modelFields.filter((f) => f.modelName.trim()).length || 1}{' '}
                    Model
                    {modelFields.filter((f) => f.modelName.trim()).length !== 1
                      ? 's'
                      : ''}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
