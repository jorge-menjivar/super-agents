'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { AgentCreateParams } from '@shared/types/data';
import { sanitizeUserInput } from '@shared/utils/security';
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
import { Textarea } from '@web/components/ui/textarea';
import { usePermissiveNavigate } from '@web/hooks/use-permissive-navigate';
import { useAgents } from '@web/providers/agents';
import { Bot, Sparkles } from 'lucide-react';
import type * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const CreateAgentFormSchema = z
  .object({
    name: z
      .string()
      .min(3, 'Agent name must be at least 3 characters')
      .max(100, 'Agent name must be less than 100 characters')
      .regex(/^[a-z0-9_-]+$/, {
        message:
          'Agent name must only contain lowercase letters, numbers, underscores, and hyphens',
      })
      .refine((name) => name !== 'super-agents', {
        message:
          'The name "super-agents" is reserved for internal system use. Please choose a different name.',
      }),
    description: z
      .string()
      .min(25, 'Description must be at least 25 characters')
      .max(10000, 'Description must be less than 10000 characters'),
  })
  .strict();

type CreateAgentFormData = z.infer<typeof CreateAgentFormSchema>;

export function CreateAgentView(): React.ReactElement {
  const { createAgent, isCreating } = useAgents();
  const navigate = usePermissiveNavigate();

  const form = useForm<CreateAgentFormData>({
    resolver: zodResolver(CreateAgentFormSchema),
    defaultValues: {
      name: '',
      description: '',
    },
  });

  const onSubmit = async (data: CreateAgentFormData) => {
    try {
      const agentParams: AgentCreateParams = {
        name: data.name,
        description: sanitizeUserInput(data.description),
        metadata: {},
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        review_fail_closed: false,
        review_expose_reason: false,
      };

      const newAgent = await createAgent(agentParams);

      // Reset form after successful creation
      form.reset();

      // Navigate to the agent's skills page, replacing history to prevent back button going to create page
      navigate({
        to: '/agents/$agentName',
        params: { agentName: newAgent.name },
        replace: true,
      });
    } catch (error) {
      console.error('Error creating agent:', error);
      // Error is already handled by the agents provider
    }
  };

  const handleBack = () => {
    navigate({ to: '/agents' });
  };

  return (
    <>
      <PageHeader
        title="Create New Agent"
        description="Build a new AI agent to help with your tasks"
        onBack={handleBack}
      />
      <div className="container mx-auto px-2 pt-6 pb-6 max-w-2xl">
        {/* Main Form Card */}
        <Card className="shadow-lg">
          <CardHeader className="pb-6">
            <div className="flex items-center gap-3">
              <Bot className="h-5 w-5 text-primary" />
              <div>
                <CardTitle>Agent Configuration</CardTitle>
                <CardDescription>
                  Define your agent's basic information and purpose
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
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base font-medium">
                        Agent Name
                      </FormLabel>
                      <FormDescription>
                        Choose a descriptive name using only lowercase letters,
                        numbers, underscores, and hyphens.
                      </FormDescription>
                      <FormControl>
                        <Input
                          placeholder="e.g., customer-support-bot, content_writer, data-analyst"
                          className="h-11"
                          pattern="[a-z0-9_-]+"
                          title="Only lowercase letters, numbers, underscores, and hyphens are allowed"
                          {...field}
                          onChange={(e) => {
                            field.onChange(e);
                            // Trigger validation on every change
                            form.trigger('name');
                          }}
                          disabled={isCreating}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base font-medium">
                        Description (required)
                      </FormLabel>
                      <FormDescription>
                        Provide additional context about the agent's purpose,
                        capabilities, and expected behavior (minimum 25
                        characters). This description is{' '}
                        <span className="font-bold">crucial</span> for
                        generating accurate system prompts and evaluations for
                        each of the agent's skills.
                      </FormDescription>
                      <FormControl>
                        <Textarea
                          placeholder="Describe what this agent will do, its capabilities, and how it should behave. For example: 'A helpful customer support agent that can answer questions about our products, handle basic troubleshooting, and escalate complex issues to human agents.'"
                          className="resize-none min-h-[120px]"
                          {...field}
                          disabled={isCreating}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={handleBack}
                    disabled={isCreating}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="lg"
                    disabled={isCreating}
                    className="flex-1"
                  >
                    {isCreating ? (
                      <>
                        <Bot className="mr-2 h-4 w-4 animate-pulse" />
                        Creating Agent...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Create Agent
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Tips Card */}
        <Card className="mt-6 border-primary/20 bg-primary/5">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              Tips for Creating Effective Agents
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm space-y-2">
              <p className="flex items-start gap-2">
                <span className="text-primary font-medium">•</span>
                <span>
                  Use clear, specific names that describe the agent's primary
                  function
                </span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-primary font-medium">•</span>
                <span>
                  Include context about the agent's role, expertise, and
                  communication style in the description
                </span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-primary font-medium">•</span>
                <span>
                  You can always edit these details later from the agents
                  management page
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
