import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { ManageSkillModelsDialog } from '@web/components/agents/skills/manage-skill-models-dialog';
import { useAIProviders } from '@web/providers/ai-providers';
import { useModels } from '@web/providers/models';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock API calls
vi.mock('@web/api/v1/super-agents/skills', () => ({
  addModelsToSkill: vi.fn(),
  removeModelsFromSkill: vi.fn(),
}));

vi.mock('@web/providers/ai-providers', () => ({
  useAIProviderAPIKeys: vi.fn(),
  useAIProviders: vi.fn(),
}));

vi.mock('@web/providers/models', () => ({
  useModels: vi.fn(),
}));

vi.mock('@web/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

// Mock UI components
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

vi.mock('@web/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <button {...props}>{children}</button>,
}));

vi.mock('@web/components/ui/card', () => ({
  Card: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <div {...props}>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@web/components/ui/checkbox', () => ({
  Checkbox: (props: Record<string, unknown>) => (
    <input type="checkbox" {...props} />
  ),
}));

vi.mock('@web/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

vi.mock('lucide-react', () => ({
  CpuIcon: () => <span>CpuIcon</span>,
  Clock: () => <span>Clock</span>,
  Loader2: () => <span>Loader2</span>,
}));

describe('ManageSkillModelsDialog', () => {
  const mockOnOpenChange = vi.fn();
  const mockSetQueryParams = vi.fn();
  const mockSetSkillId = vi.fn();
  const mockRefetchSkillModels = vi.fn();

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    (useAIProviders as ReturnType<typeof vi.fn>).mockReturnValue({
      aiProviderConfigs: [
        {
          id: 'provider-1',
          ai_provider: 'openai',
          name: 'My OpenAI Key',
          api_key: 'sk-test',
          custom_fields: {},
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ],
      isLoading: false,
    });

    (useModels as ReturnType<typeof vi.fn>).mockReturnValue({
      models: [
        {
          id: 'model-1',
          ai_provider_id: 'provider-1',
          model_name: 'gpt-4',
          model_type: 'text',
          embedding_dimensions: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 'model-2',
          ai_provider_id: 'provider-1',
          model_name: 'gpt-3.5-turbo',
          model_type: 'text',
          embedding_dimensions: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ],
      skillModels: [],
      isLoadingAllModels: false,
      isLoadingSkillModels: false,
      setQueryParams: mockSetQueryParams,
      setSkillId: mockSetSkillId,
      refetchSkillModels: mockRefetchSkillModels,
    });
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <ManageSkillModelsDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          skillId="skill-1"
          agentType="text"
          {...props}
        />
      </QueryClientProvider>,
    );
  };

  it('renders the dialog when open', () => {
    renderComponent();
    expect(screen.getByTestId('dialog')).toBeInTheDocument();
    expect(screen.getByText('Manage Models')).toBeInTheDocument();
  });

  it('displays models grouped by provider', () => {
    renderComponent();
    expect(screen.getByText('My OpenAI Key')).toBeInTheDocument();
    expect(screen.getByText('gpt-4')).toBeInTheDocument();
    expect(screen.getByText('gpt-3.5-turbo')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    (useModels as ReturnType<typeof vi.fn>).mockReturnValue({
      models: [],
      skillModels: [],
      isLoadingAllModels: true,
      isLoadingSkillModels: true,
      setQueryParams: mockSetQueryParams,
      setSkillId: mockSetSkillId,
      refetchSkillModels: mockRefetchSkillModels,
    });

    renderComponent();
    expect(screen.getByText('Loader2')).toBeInTheDocument();
  });

  it('shows empty state when no models available', () => {
    (useModels as ReturnType<typeof vi.fn>).mockReturnValue({
      models: [],
      skillModels: [],
      isLoadingAllModels: false,
      isLoadingSkillModels: false,
      setQueryParams: mockSetQueryParams,
      setSkillId: mockSetSkillId,
      refetchSkillModels: mockRefetchSkillModels,
    });

    renderComponent();
    expect(screen.getByText('No models available')).toBeInTheDocument();
  });

  it('sets query params when dialog opens', () => {
    renderComponent();
    expect(mockSetQueryParams).toHaveBeenCalledWith({});
    expect(mockSetSkillId).toHaveBeenCalledWith('skill-1');
  });

  it('displays the time warning notice', () => {
    renderComponent();
    expect(
      screen.getByText('This process may take 1-2 minutes to complete.'),
    ).toBeInTheDocument();
  });

  it('shows Save Changes and Cancel buttons', () => {
    renderComponent();
    expect(screen.getByText('Save Changes')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });
});
