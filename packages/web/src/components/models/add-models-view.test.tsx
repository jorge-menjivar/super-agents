import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createModel } from '@web/api/v1/super-agents/models';
import { AddModelsView } from '@web/components/models/add-models-view';
import { useAIProviders } from '@web/providers/ai-providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@web/api/v1/super-agents/models', () => ({
  createModel: vi.fn(),
}));

vi.mock('@web/providers/ai-providers', () => ({
  useAIProviders: vi.fn(),
}));

vi.mock('@web/providers/models', () => ({
  useModels: vi.fn(() => ({ refetch: vi.fn() })),
}));

vi.mock('@web/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

vi.mock('@web/hooks/use-permissive-navigate', () => ({
  usePermissiveNavigate: vi.fn(() => vi.fn()),
}));

// The suggestions are the hook's business; what matters here is which type
// the field asks them for.
vi.mock('@web/components/ui/model-autocomplete-input', () => ({
  ModelAutocompleteInput: ({
    id,
    value,
    onChange,
    modelType,
    placeholder,
  }: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    modelType?: string;
    placeholder?: string;
  }) => (
    <input
      id={id}
      aria-label="Model name"
      data-model-type={modelType}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const withProvider = (aiProvider: string) =>
  vi.mocked(useAIProviders).mockReturnValue({
    aiProviderConfigs: [
      { id: 'provider-1', name: 'Mine', ai_provider: aiProvider },
    ],
  } as unknown as ReturnType<typeof useAIProviders>);

describe('AddModelsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createModel).mockResolvedValue({} as never);
  });

  it('makes every model of a decision provider a decision model', async () => {
    withProvider('typesafe');
    render(<AddModelsView providerId="provider-1" />);

    const type = screen.getByRole('combobox', { name: 'Model type' });
    expect(type).toHaveTextContent('Decision');
    expect(type).toBeDisabled();

    const name = screen.getByRole('textbox', { name: 'Model name' });
    expect(name).toHaveAttribute('data-model-type', 'decision');
    expect(name).toHaveAttribute(
      'placeholder',
      'e.g., jev-latest, drex-latest',
    );
    // No dimensions to ask for: only an embedding model has them.
    expect(screen.queryByPlaceholderText('Dimensions')).not.toBeInTheDocument();

    fireEvent.change(name, { target: { value: 'jev-latest' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(createModel).toHaveBeenCalledWith({
        model_name: 'jev-latest',
        ai_provider_id: 'provider-1',
        model_type: 'decision',
        embedding_dimensions: null,
      });
    });
  });

  it('leaves the type to choose for any other provider', () => {
    withProvider('openai');
    render(<AddModelsView providerId="provider-1" />);

    const type = screen.getByRole('combobox', { name: 'Model type' });
    expect(type).toHaveTextContent('Text');
    expect(type).toBeEnabled();
  });
});
