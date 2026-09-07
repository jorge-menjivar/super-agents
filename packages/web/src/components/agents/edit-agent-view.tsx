'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type AIProvider, PrettyAIProvider } from '@shared/types/constants';
import type { AgentUpdateParams } from '@shared/types/data';
import {
  MAX_SKILL_ARBITER_TIMEOUT_MS,
  MIN_SKILL_ARBITER_TIMEOUT_MS,
} from '@shared/types/data/system-settings';
import { sanitizeUserInput } from '@shared/utils/security';
import { useParams } from '@tanstack/react-router';
import { Button } from '@web/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@web/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@web/components/ui/form';
import { Input } from '@web/components/ui/input';
import { PageHeader } from '@web/components/ui/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@web/components/ui/select';
import { Switch } from '@web/components/ui/switch';
import { Textarea } from '@web/components/ui/textarea';
import { usePermissiveNavigate } from '@web/hooks/use-permissive-navigate';
import { useAgents } from '@web/providers/agents';
import { useAIProviders } from '@web/providers/ai-providers';
import { useModels } from '@web/providers/models';
import { sortModels } from '@web/utils/model-sorting';
import { Bot, Settings } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const MIN_ARBITER_TIMEOUT_SECONDS = MIN_SKILL_ARBITER_TIMEOUT_MS / 1000;
const MAX_ARBITER_TIMEOUT_SECONDS = MAX_SKILL_ARBITER_TIMEOUT_MS / 1000;

/** The select's value for "no override": a Radix item cannot be the empty string. */
const SYSTEM_DEFAULT = '__system_default__';
/** The reviewer select's value for "no review", for the same reason. */
const NO_REVIEWER = '__no_reviewer__';

/**
 * A select's change, with `none` standing for null.
 *
 * Radix mirrors the chosen value into a hidden native select and reports
 * back what that select ended up holding. When the form is reset to a value
 * whose item has not registered yet -- the first paint of an agent that
 * already has one -- the native select holds nothing and Radix reports the
 * empty string, which would silently clear the setting. No item here is the
 * empty string, so it can only mean that, and is ignored.
 */
const selectChange =
  (none: string, onChange: (value: string | null) => void) =>
  (value: string) => {
    if (value === '') {
      return;
    }
    onChange(value === none ? null : value);
  };

const EditAgentFormSchema = z
  .object({
    description: z
      .string()
      .min(25, 'Description must be at least 25 characters')
      .max(10000, 'Description must be less than 10000 characters'),
    auto_create_skills: z.boolean(),
    skill_match_threshold: z
      .number({ error: 'Enter a number between 0 and 1' })
      .min(0, 'Must be between 0 and 1')
      .max(1, 'Must be between 0 and 1'),
    max_auto_created_skills: z
      .number({ error: 'Enter a whole number' })
      .int('Must be a whole number')
      .min(0, 'Cannot be negative'),
    // Null means the system setting applies.
    skill_arbiter_model_id: z.string().nullable(),
    skill_arbiter_timeout_seconds: z
      .number({ error: 'Enter a whole number of seconds, or leave it empty' })
      .int('Must be a whole number of seconds')
      .min(
        MIN_ARBITER_TIMEOUT_SECONDS,
        `Must be at least ${MIN_ARBITER_TIMEOUT_SECONDS}`,
      )
      .max(
        MAX_ARBITER_TIMEOUT_SECONDS,
        `Must be at most ${MAX_ARBITER_TIMEOUT_SECONDS}`,
      )
      .nullable(),
    // Null means responses go unreviewed.
    reviewer_agent_id: z.string().nullable(),
    review_fail_closed: z.boolean(),
    review_expose_reason: z.boolean(),
  })
  .strict();

type EditAgentFormData = z.infer<typeof EditAgentFormSchema>;

export function EditAgentView(): React.ReactElement {
  const { agents, selectedAgent, updateAgent, isUpdating } = useAgents();
  const { models, setQueryParams } = useModels();
  const { aiProviderConfigs } = useAIProviders();
  const navigate = usePermissiveNavigate();
  const { agentName } = useParams({ strict: false }) as { agentName?: string };
  const agentNameInputId = React.useId();

  // Load all models, for the arbiter override.
  React.useEffect(() => {
    setQueryParams({});
  }, [setQueryParams]);

  const textModelOptions = React.useMemo(
    () =>
      sortModels(
        models
          .filter((model) => model.model_type === 'text')
          .map((model) => {
            const provider = aiProviderConfigs.find(
              (config) => config.id === model.ai_provider_id,
            )?.ai_provider as AIProvider | undefined;
            return {
              id: model.id,
              modelName: model.model_name,
              providerName: provider
                ? PrettyAIProvider[provider] || provider
                : 'Unknown',
            };
          }),
      ),
    [models, aiProviderConfigs],
  );

  // Any other agent can review this one; the internal agent serves the
  // gateway's own calls and is not for clients to configure.
  const reviewerOptions = React.useMemo(
    () =>
      agents.filter(
        (agent) =>
          agent.id !== selectedAgent?.id && agent.name !== 'super-agents',
      ),
    [agents, selectedAgent],
  );

  const form = useForm<EditAgentFormData>({
    resolver: zodResolver(EditAgentFormSchema),
    defaultValues: {
      description: '',
      auto_create_skills: true,
      skill_match_threshold: 0.8,
      max_auto_created_skills: 10,
      skill_arbiter_model_id: null,
      skill_arbiter_timeout_seconds: null,
      reviewer_agent_id: null,
      review_fail_closed: false,
      review_expose_reason: false,
    },
  });

  // Update form defaults when agent data is available
  React.useEffect(() => {
    if (selectedAgent) {
      form.reset({
        description: selectedAgent.description || '',
        auto_create_skills: selectedAgent.auto_create_skills,
        skill_match_threshold: selectedAgent.skill_match_threshold,
        max_auto_created_skills: selectedAgent.max_auto_created_skills,
        skill_arbiter_model_id: selectedAgent.skill_arbiter_model_id,
        skill_arbiter_timeout_seconds:
          selectedAgent.skill_arbiter_timeout_ms === null
            ? null
            : selectedAgent.skill_arbiter_timeout_ms / 1000,
        reviewer_agent_id: selectedAgent.reviewer_agent_id,
        review_fail_closed: selectedAgent.review_fail_closed,
        review_expose_reason: selectedAgent.review_expose_reason,
      });
    }
  }, [selectedAgent, form]);

  const onSubmit = async (data: EditAgentFormData) => {
    if (!selectedAgent) {
      console.error('No agent selected');
      return;
    }

    try {
      const updateParams: AgentUpdateParams = {
        description: sanitizeUserInput(data.description),
        auto_create_skills: data.auto_create_skills,
        skill_match_threshold: data.skill_match_threshold,
        max_auto_created_skills: data.max_auto_created_skills,
        skill_arbiter_model_id: data.skill_arbiter_model_id,
        skill_arbiter_timeout_ms:
          data.skill_arbiter_timeout_seconds === null
            ? null
            : data.skill_arbiter_timeout_seconds * 1000,
        reviewer_agent_id: data.reviewer_agent_id,
        review_fail_closed: data.review_fail_closed,
        review_expose_reason: data.review_expose_reason,
      };

      await updateAgent(selectedAgent.id, updateParams);

      // Navigate back to agent skills list
      if (agentName) {
        navigate({ to: '/agents/$agentName', params: { agentName } });
      } else {
        navigate({ to: '/agents' });
      }
    } catch (error) {
      console.error('Error updating agent:', error);
      // Error is already handled by the agents provider
    }
  };

  const handleBack = () => {
    if (agentName) {
      navigate({ to: '/agents/$agentName', params: { agentName } });
    } else {
      navigate({ to: '/agents' });
    }
  };

  if (!selectedAgent) {
    return (
      <>
        <PageHeader title="Edit Agent" description="Agent not found" />
        <div className="container mx-auto py-6 max-w-2xl">
          <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                <div>
                  <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                    Agent not found
                  </h4>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                    Unable to find the specified agent. Please ensure the agent
                    exists and try again.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Edit Agent"
        description={`Update ${selectedAgent.name} configuration`}
        onBack={handleBack}
      />
      <div className="container mx-auto py-6 max-w-2xl">
        {/* Main Form Card */}
        <Card className="shadow-lg">
          <CardHeader className="pb-6">
            <div className="flex items-center gap-3">
              <Bot className="h-5 w-5 text-primary" />
              <div>
                <CardTitle>Agent Configuration</CardTitle>
                <CardDescription>
                  Update your agent's information
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
              >
                {/* Agent Name (read-only) */}
                <div className="space-y-2">
                  <label
                    htmlFor={agentNameInputId}
                    className="text-sm font-medium text-foreground"
                  >
                    Agent Name
                  </label>
                  <Input
                    id={agentNameInputId}
                    value={selectedAgent.name}
                    disabled
                    className="h-11 bg-muted"
                  />
                  <p className="text-xs text-muted-foreground">
                    Agent name cannot be changed after creation
                  </p>
                </div>

                {/* Description Field */}
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base font-medium">
                        Description (required)
                      </FormLabel>
                      <FormDescription>
                        Provide a detailed description of what this agent does
                        and when to use it.
                      </FormDescription>
                      <FormControl>
                        <Textarea
                          placeholder="This agent helps with..."
                          className="min-h-[120px] resize-y"
                          {...field}
                          disabled={isUpdating}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Automatic skills: requests that name only the agent */}
                <div className="space-y-4 rounded-lg border p-4">
                  <div>
                    <h3 className="text-base font-medium">Automatic skills</h3>
                    <p className="text-sm text-muted-foreground">
                      Requests sent to{' '}
                      <code className="text-xs">
                        /v1/agents/{selectedAgent.name}/...
                      </code>{' '}
                      are routed to the closest skill. These settings decide
                      when such a request becomes a new skill instead.
                    </p>
                  </div>
                  <FormField
                    control={form.control}
                    name="auto_create_skills"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between gap-4">
                        <div className="space-y-0.5">
                          <FormLabel>Create skills automatically</FormLabel>
                          <FormDescription>
                            New skills take this agent's default models and
                            start from the caller's own system prompt.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={isUpdating}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="skill_match_threshold"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Match threshold</FormLabel>
                          <FormDescription>
                            Similarity (0 to 1) below which a request gets a
                            skill of its own.
                          </FormDescription>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.05"
                              min={0}
                              max={1}
                              name={field.name}
                              value={field.value}
                              onBlur={field.onBlur}
                              onChange={(e) =>
                                field.onChange(e.target.valueAsNumber)
                              }
                              disabled={isUpdating}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="max_auto_created_skills"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Maximum automatic skills</FormLabel>
                          <FormDescription>
                            Past this many, requests go to the closest skill.
                          </FormDescription>
                          <FormControl>
                            <Input
                              type="number"
                              step="1"
                              min={0}
                              name={field.name}
                              value={field.value}
                              onBlur={field.onBlur}
                              onChange={(e) =>
                                field.onChange(e.target.valueAsNumber)
                              }
                              disabled={isUpdating}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* The arbiter: the model asked when no skill matches closely */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="skill_arbiter_model_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Arbiter model</FormLabel>
                          <FormDescription>
                            Decides whether an unfamiliar request is a new kind
                            of job. Empty uses the system setting.
                          </FormDescription>
                          <Select
                            value={field.value ?? SYSTEM_DEFAULT}
                            onValueChange={selectChange(
                              SYSTEM_DEFAULT,
                              field.onChange,
                            )}
                            disabled={isUpdating}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value={SYSTEM_DEFAULT}>
                                System default
                              </SelectItem>
                              {textModelOptions.map((model) => (
                                <SelectItem key={model.id} value={model.id}>
                                  {model.modelName}{' '}
                                  <span className="text-muted-foreground">
                                    ({model.providerName})
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="skill_arbiter_timeout_seconds"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Arbiter timeout (seconds)</FormLabel>
                          <FormDescription>
                            Per attempt, retried once. Empty uses the system
                            setting.
                          </FormDescription>
                          <FormControl>
                            <Input
                              type="number"
                              step="1"
                              min={MIN_ARBITER_TIMEOUT_SECONDS}
                              max={MAX_ARBITER_TIMEOUT_SECONDS}
                              placeholder="System default"
                              name={field.name}
                              value={field.value ?? ''}
                              onBlur={field.onBlur}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value === ''
                                    ? null
                                    : e.target.valueAsNumber,
                                )
                              }
                              disabled={isUpdating}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Review: another agent sees every response before the client */}
                <div className="space-y-4 rounded-lg border p-4">
                  <div>
                    <h3 className="text-base font-medium">Response review</h3>
                    <p className="text-sm text-muted-foreground">
                      Another agent can review every response before the client
                      receives it, and withhold or rewrite it. Its skill's
                      system prompt is the policy. Streamed responses are held
                      until the review is done.
                    </p>
                  </div>
                  <FormField
                    control={form.control}
                    name="reviewer_agent_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reviewer agent</FormLabel>
                        <FormDescription>
                          Empty leaves responses unreviewed.
                        </FormDescription>
                        <Select
                          value={field.value ?? NO_REVIEWER}
                          onValueChange={selectChange(
                            NO_REVIEWER,
                            field.onChange,
                          )}
                          disabled={isUpdating}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={NO_REVIEWER}>
                              No review
                            </SelectItem>
                            {reviewerOptions.map((agent) => (
                              <SelectItem key={agent.id} value={agent.id}>
                                {agent.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="review_fail_closed"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between gap-4">
                        <div className="space-y-0.5">
                          <FormLabel>Fail closed</FormLabel>
                          <FormDescription>
                            Withhold a response the reviewer could not judge,
                            because it was unreachable or gave no verdict,
                            instead of delivering it.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={
                              isUpdating ||
                              form.watch('reviewer_agent_id') === null
                            }
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="review_expose_reason"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between gap-4">
                        <div className="space-y-0.5">
                          <FormLabel>Explain denials</FormLabel>
                          <FormDescription>
                            Tell the client why a response was withheld, in the
                            reviewer's words. Otherwise it learns only that it
                            was. The reason is on the log either way.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={
                              isUpdating ||
                              form.watch('reviewer_agent_id') === null
                            }
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                {/* Form Actions */}
                <div className="flex items-center gap-3 pt-4 border-t">
                  <Button
                    type="submit"
                    disabled={isUpdating || !form.formState.isDirty}
                    className="w-full sm:w-auto"
                  >
                    {isUpdating ? 'Saving...' : 'Save Changes'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                    disabled={isUpdating}
                    className="w-full sm:w-auto"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
