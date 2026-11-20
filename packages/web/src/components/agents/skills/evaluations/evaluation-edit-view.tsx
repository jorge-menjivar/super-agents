'use client';

import { type AIProvider, PrettyAIProvider } from '@shared/types/constants';
import type { ModelType } from '@shared/types/data/model';
import type { EvaluationMethodDetails } from '@shared/types/evaluations';
import { getEvaluationMethods } from '@web/api/v1/super-agents/skills';
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@web/components/ui/command';
import { Input } from '@web/components/ui/input';
import { Label } from '@web/components/ui/label';
import { PageHeader } from '@web/components/ui/page-header';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@web/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@web/components/ui/select';
import { Skeleton } from '@web/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@web/components/ui/tooltip';
import { useSmartBack } from '@web/hooks/use-smart-back';
import { useToast } from '@web/hooks/use-toast';
import { useAIProviders } from '@web/providers/ai-providers';
import { useModels } from '@web/providers/models';
import { useNavigation } from '@web/providers/navigation';
import { useSkillOptimizationEvaluations } from '@web/providers/skill-optimization-evaluations';
import { useSkills } from '@web/providers/skills';
import { sortModels } from '@web/utils/model-sorting';
import { cn } from '@web/utils/ui/utils';
import {
  CheckIcon,
  ChevronsUpDownIcon,
  Eraser,
  Loader2,
  RotateCcw,
  SaveIcon,
} from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface ModelOption {
  id: string;
  name: string;
  provider: AIProvider;
  modelType: ModelType;
}

/** The select value standing for "no value at all"; an item cannot be empty. */
export const UNSET = '__unset__';
export const UNSET_LABEL = 'Not set';

/**
 * The parameters a select's new value produces.
 *
 * Choosing the unset item *removes* the parameter rather than storing a
 * value, which is what an optional parameter's absence means: the evaluation
 * goes back to following the setting behind it. Pure and exported because a
 * Radix select cannot be opened under jsdom, so this is where the behaviour
 * is checked.
 */
export function paramsAfterSelect(
  params: Record<string, unknown>,
  key: string,
  next: string,
): Record<string, unknown> {
  if (next === UNSET) {
    const { [key]: _cleared, ...rest } = params;
    return rest;
  }
  return { ...params, [key]: next };
}

/**
 * The lowest value the input should accept.
 *
 * JSON Schema's exclusive bound has no HTML equivalent, and handing it to
 * `min` straight would accept the one value it excludes -- `max_tokens: 0`
 * for a positive integer, which the API then refuses. For an integer the
 * next one up is exact; for a float it is the closest an input can express.
 */
function minimumFor(
  property: SchemaProperty | undefined,
  type: string | undefined,
): number | undefined {
  if (property?.minimum !== undefined) return property.minimum;
  if (property?.exclusiveMinimum === undefined) return undefined;
  return type === 'integer'
    ? property.exclusiveMinimum + 1
    : property.exclusiveMinimum;
}

/** The shape this form reads out of a method's JSON schema. */
interface SchemaProperty {
  type?: string;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
}

/** A ghost icon button with a tooltip, the shape every param control repeats. */
function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            className="h-8 w-8"
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function EvaluationEditView(): ReactElement {
  const { selectedSkill } = useSkills();
  const { navigationState } = useNavigation();
  const goBack = useSmartBack();
  const { toast } = useToast();

  const { evaluations, updateEvaluation, setSkillId } =
    useSkillOptimizationEvaluations();
  const { models, setQueryParams } = useModels();
  const { aiProviderConfigs } = useAIProviders();

  // Fetch all models on mount
  useEffect(() => {
    setQueryParams({});
  }, [setQueryParams]);

  const [isSaving, setIsSaving] = useState(false);
  const [evaluationMethods, setEvaluationMethods] = useState<
    EvaluationMethodDetails[]
  >([]);
  const [isLoadingMethods, setIsLoadingMethods] = useState(true);
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);

  // Form state
  const [weight, setWeight] = useState<string>('1.0');
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [modelId, setModelId] = useState<string | null>(null);

  // Build model options (text models only for evaluations), sorted alphabetically
  const textModelOptions = useMemo((): ModelOption[] => {
    const options = models
      .filter((model) => model.model_type === 'text')
      .map((model) => {
        const provider = aiProviderConfigs.find(
          (p) => p.id === model.ai_provider_id,
        );
        return {
          id: model.id,
          name: model.model_name,
          provider: (provider?.ai_provider ?? 'openai') as AIProvider,
          modelType: model.model_type,
        };
      });
    // Sort alphabetically by model name, then by provider name
    return sortModels(options);
  }, [models, aiProviderConfigs]);

  // Fetch evaluation methods from server
  useEffect(() => {
    const fetchMethods = async () => {
      try {
        setIsLoadingMethods(true);
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
        setIsLoadingMethods(false);
      }
    };

    fetchMethods();
  }, [toast]);

  // Set skill ID when skill changes
  useEffect(() => {
    if (!selectedSkill) {
      setSkillId(null);
      return;
    }
    setSkillId(selectedSkill.id);
  }, [selectedSkill, setSkillId]);

  // Find the evaluation being edited
  const evaluation = useMemo(() => {
    if (!navigationState.selectedEvaluationId) return undefined;
    return evaluations.find(
      (e) => e.id === navigationState.selectedEvaluationId,
    );
  }, [evaluations, navigationState.selectedEvaluationId]);

  // Find evaluation method details
  const evaluationMethod = useMemo(() => {
    if (!evaluation) return undefined;
    return evaluationMethods.find(
      (m) => m.method === evaluation.evaluation_method,
    );
  }, [evaluation, evaluationMethods]);

  // Initialize form when evaluation loads
  useEffect(() => {
    if (evaluation && evaluationMethod) {
      setWeight(evaluation.weight.toString());
      setModelId(evaluation.model_id);

      // Extract defaults from JSON schema if available
      if (evaluationMethod.parameterSchema) {
        const schemaDefaults: Record<string, unknown> = {};

        // Extract default values from JSON schema properties
        // biome-ignore lint/suspicious/noExplicitAny: JSON schema type is dynamic
        const properties = (evaluationMethod.parameterSchema as any)
          ?.properties;
        if (properties) {
          for (const [key, prop] of Object.entries(properties)) {
            // biome-ignore lint/suspicious/noExplicitAny: JSON schema property type is dynamic
            const propDef = prop as any;
            if ('default' in propDef) {
              schemaDefaults[key] = propDef.default;
            }
          }
        }

        // Merge schema defaults with existing params (existing params take precedence)
        const mergedParams = {
          ...schemaDefaults,
          ...evaluation.params,
        };
        setParams(mergedParams);
      } else {
        // Fall back to just using existing params
        setParams(evaluation.params);
      }
    }
  }, [evaluation, evaluationMethod]);

  const handleSave = async () => {
    if (!selectedSkill || !evaluation) return;

    const numericWeight = Number.parseFloat(weight);

    // Validate weight
    if (Number.isNaN(numericWeight) || numericWeight <= 0) {
      toast({
        title: 'Invalid weight',
        description: 'Weight must be a positive number.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      // Send all params including model_id
      await updateEvaluation(selectedSkill.id, evaluation.id, {
        weight: numericWeight,
        params,
        model_id: modelId,
      });

      toast({
        title: 'Evaluation updated',
        description: 'The evaluation has been updated successfully.',
      });

      goBack();
    } catch (error) {
      console.error('Failed to update evaluation:', error);
      toast({
        title: 'Failed to update evaluation',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleParamChange = (key: string, value: unknown) => {
    setParams((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleResetToDefault = (key: string) => {
    // Get the default value from the schema
    if (!evaluationMethod?.parameterSchema) return;

    // biome-ignore lint/suspicious/noExplicitAny: JSON schema type is dynamic
    const properties = (evaluationMethod.parameterSchema as any)?.properties;
    if (!properties?.[key] || !('default' in properties[key])) return;

    // Reset to default value
    setParams((prev) => ({
      ...prev,
      [key]: properties[key].default,
    }));
  };

  // Check if a param has a default value in the schema
  const hasDefault = (key: string): boolean => {
    if (!evaluationMethod?.parameterSchema) return false;

    // biome-ignore lint/suspicious/noExplicitAny: JSON schema type is dynamic
    const properties = (evaluationMethod.parameterSchema as any)?.properties;
    if (!properties?.[key]) return false;

    return 'default' in properties[key];
  };

  // Check if the current value differs from the default
  // biome-ignore lint/correctness/useExhaustiveDependencies: params dependency needed to trigger re-render when values change
  const isDifferentFromDefault = useCallback(
    (key: string, value: unknown): boolean => {
      if (!evaluationMethod?.parameterSchema) return false;

      // biome-ignore lint/suspicious/noExplicitAny: JSON schema type is dynamic
      const properties = (evaluationMethod.parameterSchema as any)?.properties;
      if (!properties?.[key] || !('default' in properties[key])) return false;

      const defaultValue = properties[key].default;

      // Deep equality check for objects/arrays, otherwise simple equality
      if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value) !== JSON.stringify(defaultValue);
      }

      return value !== defaultValue;
    },
    [evaluationMethod?.parameterSchema, params],
  );

  /** The JSON-schema property behind a parameter, when the method has one. */
  const propertyOf = (key: string): SchemaProperty | undefined => {
    // biome-ignore lint/suspicious/noExplicitAny: JSON schema type is dynamic
    const properties = (evaluationMethod?.parameterSchema as any)?.properties;
    return properties?.[key];
  };

  /**
   * A parameter the evaluation may simply not have.
   *
   * Zod lists a defaulted field as required, because the parsed value always
   * has it; what is left out is genuinely optional. Those are the parameters
   * whose absence means something -- the judge's token budget and reasoning
   * effort fall back to system settings when the evaluation says nothing --
   * so the form has to be able to express "not set" rather than only a value.
   */
  const isOptional = (key: string): boolean => {
    // biome-ignore lint/suspicious/noExplicitAny: JSON schema type is dynamic
    const required = (evaluationMethod?.parameterSchema as any)?.required;
    return Array.isArray(required) ? !required.includes(key) : false;
  };

  /** Removes a parameter, which is how an optional one goes back to unset. */
  const handleClearParam = (key: string) => {
    setParams((prev) => {
      const { [key]: _cleared, ...rest } = prev;
      return rest;
    });
  };

  /**
   * The label, its description, and whichever of the two buttons applies.
   *
   * A function rather than a component: `key` is React's own prop, so a
   * component taking the parameter name under that name would never receive
   * it, and one declared inside this render would remount on every keystroke.
   */
  const paramLabel = (key: string): ReactElement => {
    const property = propertyOf(key);
    const unset = !(key in params);
    const showReset =
      hasDefault(key) && isDifferentFromDefault(key, params[key]);
    const showClear = !unset && isOptional(key);

    return (
      <div className="space-y-1">
        <div className="inline-flex items-center gap-2 h-8">
          <Label htmlFor={key} className="capitalize">
            {key.replace(/_/g, ' ')}
          </Label>
          {showReset && (
            <IconButton
              label="Reset to default"
              onClick={() => handleResetToDefault(key)}
              disabled={isSaving}
            >
              <RotateCcw className="h-4 w-4" />
            </IconButton>
          )}
          {showClear && (
            <IconButton
              label="Clear, leaving it unset"
              onClick={() => handleClearParam(key)}
              disabled={isSaving}
            >
              <Eraser className="h-4 w-4" />
            </IconButton>
          )}
        </div>
        {property?.description && (
          <p className="text-sm text-muted-foreground">
            {property.description}
          </p>
        )}
      </div>
    );
  };

  /**
   * One parameter's control, chosen from the schema rather than from the
   * value.
   *
   * The value cannot decide it: an unset optional parameter has no value at
   * all, and a form that switched on `typeof` could only render what the
   * evaluation already had -- which is why a parameter nobody had set was
   * invisible, and unsettable. The schema knows the type either way, and
   * knows an enum is a choice rather than free text.
   */
  const renderParamInput = (key: string) => {
    const property = propertyOf(key);
    const value = params[key];
    const unset = !(key in params);
    const type =
      property?.type ??
      (typeof value === 'boolean'
        ? 'boolean'
        : typeof value === 'number'
          ? 'number'
          : typeof value === 'string'
            ? 'string'
            : undefined);

    if (property?.enum) {
      return (
        <div key={key} className="space-y-2">
          {paramLabel(key)}
          <Select
            value={unset ? UNSET : String(value)}
            onValueChange={(next) =>
              setParams((prev) => paramsAfterSelect(prev, key, next))
            }
            disabled={isSaving}
          >
            <SelectTrigger id={key} className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {isOptional(key) && (
                <SelectItem value={UNSET}>{UNSET_LABEL}</SelectItem>
              )}
              {property.enum.map((option) => (
                <SelectItem key={String(option)} value={String(option)}>
                  {String(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    if (type === 'boolean') {
      return (
        <div key={key} className="flex items-start gap-2">
          <Checkbox
            id={key}
            className="mt-2"
            checked={value === true}
            onCheckedChange={(checked: boolean) =>
              handleParamChange(key, checked)
            }
            disabled={isSaving}
          />
          {paramLabel(key)}
        </div>
      );
    }

    if (type === 'number' || type === 'integer') {
      return (
        <div key={key} className="space-y-2">
          {paramLabel(key)}
          <Input
            id={key}
            type="number"
            value={unset ? '' : String(value)}
            placeholder={isOptional(key) ? UNSET_LABEL : undefined}
            onChange={(e) => {
              // An emptied field is the parameter going back to unset, not a
              // zero: the two mean different things to an optional setting.
              if (e.target.value === '') {
                handleClearParam(key);
                return;
              }
              const numValue = Number.parseFloat(e.target.value);
              if (!Number.isNaN(numValue)) {
                handleParamChange(key, numValue);
              }
            }}
            disabled={isSaving}
            step={type === 'integer' ? 1 : 'any'}
            min={minimumFor(property, type)}
            max={property?.maximum}
            className="w-40"
          />
        </div>
      );
    }

    if (type === 'string') {
      return (
        <div key={key} className="space-y-2">
          {paramLabel(key)}
          <Input
            id={key}
            type="text"
            value={unset ? '' : String(value)}
            placeholder={isOptional(key) ? UNSET_LABEL : undefined}
            onChange={(e) =>
              e.target.value === '' && isOptional(key)
                ? handleClearParam(key)
                : handleParamChange(key, e.target.value)
            }
            disabled={isSaving}
          />
        </div>
      );
    }

    // Anything structural: edited as JSON, as it always was.
    return (
      <div key={key} className="space-y-2">
        {paramLabel(key)}
        <Input
          id={key}
          type="text"
          value={unset ? '' : JSON.stringify(value)}
          placeholder={isOptional(key) ? UNSET_LABEL : undefined}
          onChange={(e) => {
            if (e.target.value === '' && isOptional(key)) {
              handleClearParam(key);
              return;
            }
            try {
              handleParamChange(key, JSON.parse(e.target.value));
            } catch {
              // Invalid JSON, ignore
            }
          }}
          disabled={isSaving}
        />
      </div>
    );
  };

  // Show error if no evaluation ID in navigation state
  if (!navigationState.selectedEvaluationId) {
    return (
      <>
        <PageHeader
          title="Edit Evaluation"
          description="No evaluation selected"
          showBackButton={true}
          onBack={goBack}
        />
        <div className="p-6">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground">
                No evaluation selected. Please go back and select an evaluation
                to edit.
              </p>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  // Show loading state
  if (isLoadingMethods || !evaluation) {
    return (
      <>
        <PageHeader
          title="Edit Evaluation"
          description="Loading evaluation data..."
          showBackButton={true}
          onBack={goBack}
        />
        <div className="p-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-48 mb-2" />
              <Skeleton className="h-4 w-64" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Edit ${evaluationMethod?.name || 'Evaluation'}`}
        description={`Configure the parameters for this evaluation method`}
        showBackButton={true}
        onBack={goBack}
        actions={
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <SaveIcon className="h-4 w-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        }
      />

      <div className="p-6 space-y-6">
        {/* Evaluation Info */}
        <Card>
          <CardHeader>
            <CardTitle>{evaluationMethod?.name || 'Evaluation'}</CardTitle>
            <CardDescription>
              {evaluationMethod?.description ||
                'Configure this evaluation method'}
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Weight Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Weight</CardTitle>
            <CardDescription>
              The relative importance of this evaluation in the overall score
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>Weight (must be positive)</Label>
              <Input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                disabled={isSaving}
                step="0.1"
                min="0.01"
              />
            </div>
          </CardContent>
        </Card>

        {/* Model Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Model</CardTitle>
            <CardDescription>
              The model used to run this evaluation. If not set, the system
              default will be used.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>Evaluation Model</Label>
              <Popover
                open={modelPopoverOpen}
                onOpenChange={setModelPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    aria-expanded={modelPopoverOpen}
                    className="w-full justify-between"
                    disabled={isSaving}
                  >
                    {modelId ? (
                      (() => {
                        const selectedModel = textModelOptions.find(
                          (m) => m.id === modelId,
                        );
                        return selectedModel ? (
                          <div className="flex items-center gap-2 truncate">
                            <span className="truncate">
                              {selectedModel.name}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-xs shrink-0"
                            >
                              {PrettyAIProvider[selectedModel.provider] ??
                                selectedModel.provider}
                            </Badge>
                          </div>
                        ) : (
                          'Select a model...'
                        );
                      })()
                    ) : (
                      <span className="text-muted-foreground">
                        Use system default
                      </span>
                    )}
                    <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search models..." />
                    <CommandList>
                      <CommandEmpty>No models found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__none__"
                          onSelect={() => {
                            setModelId(null);
                            setModelPopoverOpen(false);
                          }}
                        >
                          <CheckIcon
                            className={cn(
                              'mr-2 h-4 w-4',
                              modelId === null ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                          <span className="text-muted-foreground">
                            Use system default
                          </span>
                        </CommandItem>
                        {textModelOptions.map((model) => (
                          <CommandItem
                            key={model.id}
                            value={`${model.name} ${PrettyAIProvider[model.provider] ?? model.provider}`}
                            onSelect={() => {
                              setModelId(model.id);
                              setModelPopoverOpen(false);
                            }}
                          >
                            <CheckIcon
                              className={cn(
                                'mr-2 h-4 w-4',
                                modelId === model.id
                                  ? 'opacity-100'
                                  : 'opacity-0',
                              )}
                            />
                            <div className="flex items-center gap-2">
                              <span>{model.name}</span>
                              <Badge variant="outline" className="text-xs">
                                {PrettyAIProvider[model.provider] ??
                                  model.provider}
                              </Badge>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {textModelOptions.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No text models available. Add models in AI Providers &amp;
                  Models settings.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Parameters Configuration */}
        {Object.keys(params).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Parameters</CardTitle>
              <CardDescription>
                Configure the specific parameters for this evaluation method
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Render params in schema order if available, otherwise alphabetical */}
              {(() => {
                // biome-ignore lint/suspicious/noExplicitAny: JSON schema type is dynamic
                const properties = (evaluationMethod?.parameterSchema as any)
                  ?.properties;
                const schemaKeys = properties ? Object.keys(properties) : [];

                // Every parameter the method declares, whether or not this
                // evaluation has one: an optional parameter is unsettable if
                // the form only shows what is already stored.
                const orderedKeys =
                  schemaKeys.length > 0 ? schemaKeys : Object.keys(params);

                return orderedKeys.map((key) => renderParamInput(key));
              })()}
            </CardContent>
          </Card>
        )}

        {/* Save Button (mobile) */}
        <div className="lg:hidden">
          <Button onClick={handleSave} disabled={isSaving} className="w-full">
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <SaveIcon className="h-4 w-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
