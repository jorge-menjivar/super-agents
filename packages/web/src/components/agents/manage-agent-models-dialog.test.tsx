import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  addModelsToAgent,
  getAgentModels,
  removeModelsFromAgent,
} from '@web/api/v1/super-agents/agents';
import { ManageAgentModelsDialog } from '@web/components/agents/manage-agent-models-dialog';
import { useAIProviders } from '@web/providers/ai-providers';
import { useModels } from '@web/providers/models';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@web/api/v1/super-agents/agents', () => ({
  getAgentModels: vi.fn(),
  addModelsToAgent: vi.fn(),
  removeModelsFromAgent: vi.fn(),
}));

vi.mock('@web/providers/ai-providers', () => ({
  useAIProviders: vi.fn(),
}));

vi.mock('@web/providers/models', () => ({
  useModels: vi.fn(),
}));

vi.mock('@web/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

vi.mock('@web/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

vi.mock('@web/components/ui/checkbox', () => ({
  Checkbox: (props: Record<string, unknown>) => (
    <input type="checkbox" {...props} />
  ),
}));

vi.mock('lucide-react', () => ({
  CpuIcon: () => <span>CpuIcon</span>,
  Loader2: () => <span>Loader2</span>,
}));

const providers = [
  { id: 'provider-1', name: 'OpenAI Prod', ai_provider: 'openai' },
  { id: 'provider-2', name: 'Anthropic', ai_provider: 'anthropic' },
  { id: 'provider-3', name: 'TypeSafe', ai_provider: 'typesafe' },
];

const models = [
  {
    id: 'model-1',
    ai_provider_id: 'provider-1',
    model_name: 'gpt-5',
    model_type: 'text',
  },
  {
    id: 'model-2',
    ai_provider_id: 'provider-2',
    model_name: 'claude-sonnet-5',
    model_type: 'text',
  },
  {
    id: 'model-3',
    ai_provider_id: 'provider-1',
    model_name: 'text-embedding-3-small',
    model_type: 'embed',
  },
  {
    id: 'model-4',
    ai_provider_id: 'provider-3',
    model_name: 'jev-latest',
    model_type: 'decision',
  },
];

/** The checkbox for the model called `modelName`; it is labelled with the name. */
const checkboxFor = (modelName: string): HTMLElement =>
  screen.getByRole('checkbox', { name: modelName });

describe('ManageAgentModelsDialog', () => {
  const onOpenChange = vi.fn();
  const setQueryParams = vi.fn();

  const renderDialog = (open = true, agentType: 'text' | 'decision' = 'text') =>
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ManageAgentModelsDialog
          open={open}
          onOpenChange={onOpenChange}
          agentId="agent-1"
          agentType={agentType}
        />
      </QueryClientProvider>,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAIProviders).mockReturnValue({
      aiProviderConfigs: providers,
    } as unknown as ReturnType<typeof useAIProviders>);
    vi.mocked(useModels).mockReturnValue({
      models,
      isLoading: false,
      setQueryParams,
    } as unknown as ReturnType<typeof useModels>);
    vi.mocked(getAgentModels).mockResolvedValue([models[0]] as never);
    vi.mocked(addModelsToAgent).mockResolvedValue(undefined);
    vi.mocked(removeModelsFromAgent).mockResolvedValue(undefined);
  });

  it('renders nothing while closed', () => {
    renderDialog(false);

    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
    expect(getAgentModels).not.toHaveBeenCalled();
  });

  it('lists the text models by provider and preselects the agent defaults', async () => {
    renderDialog();

    expect(await screen.findByText('gpt-5')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument();
    // Embedding models serve no skill, so they are not on offer.
    expect(
      screen.queryByText('text-embedding-3-small'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('OpenAI Prod')).toBeInTheDocument();
    expect(setQueryParams).toHaveBeenCalledWith({});

    await waitFor(() => {
      expect(checkboxFor('gpt-5')).toBeChecked();
    });
    expect(checkboxFor('claude-sonnet-5')).not.toBeChecked();
    expect(
      screen.getByRole('button', { name: /save changes/i }),
    ).toBeDisabled();
  });

  // The database takes no model of another type, so none is offered.
  it('offers a decision agent its decision models, and nothing else', async () => {
    renderDialog(true, 'decision');

    expect(await screen.findByText('jev-latest')).toBeInTheDocument();
    expect(screen.getByText('TypeSafe')).toBeInTheDocument();
    expect(screen.queryByText('gpt-5')).not.toBeInTheDocument();
  });

  it('offers an LLM agent no decision model', async () => {
    renderDialog();

    expect(await screen.findByText('gpt-5')).toBeInTheDocument();
    expect(screen.queryByText('jev-latest')).not.toBeInTheDocument();
  });

  it('saves only the difference and closes', async () => {
    renderDialog();
    await screen.findByText('gpt-5');
    await waitFor(() => {
      expect(checkboxFor('gpt-5')).toBeChecked();
    });

    // Drop gpt-5, pick claude: one removal and one addition.
    fireEvent.click(screen.getByText('gpt-5'));
    fireEvent.click(screen.getByText('claude-sonnet-5'));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(removeModelsFromAgent).toHaveBeenCalledWith('agent-1', [
        'model-1',
      ]);
      expect(addModelsToAgent).toHaveBeenCalledWith('agent-1', ['model-2']);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('shows an empty state when there are no text models', async () => {
    vi.mocked(useModels).mockReturnValue({
      models: [models[2]],
      isLoading: false,
      setQueryParams,
    } as unknown as ReturnType<typeof useModels>);

    renderDialog();

    // Shown once the agent's own models have loaded.
    expect(await screen.findByText('No models available')).toBeInTheDocument();
  });
});
