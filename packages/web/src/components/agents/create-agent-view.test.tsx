import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CreateAgentView } from '@web/components/agents/create-agent-view';
import { useAgents } from '@web/providers/agents';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@web/providers/agents', () => ({ useAgents: vi.fn() }));

vi.mock('@web/hooks/use-permissive-navigate', () => ({
  usePermissiveNavigate: vi.fn(() => vi.fn()),
}));

// A native select in place of Radix's, which jsdom cannot open: what is under
// test is which type the form sends, not how the list is drawn.
vi.mock('@web/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      aria-label="Agent type"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => <option value={value}>{children}</option>,
}));

describe('CreateAgentView', () => {
  const createAgent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createAgent.mockResolvedValue({ name: 'security-reviewer' });
    vi.mocked(useAgents).mockReturnValue({
      createAgent,
      isCreating: false,
    } as unknown as ReturnType<typeof useAgents>);
  });

  const fillIn = () => {
    fireEvent.change(screen.getByPlaceholderText(/customer-support-bot/), {
      target: { value: 'security-reviewer' },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/Describe what this agent will do/),
      {
        target: {
          value: 'Decides whether a reply would be dangerous to deliver.',
        },
      },
    );
  };

  it('makes an LLM agent unless told otherwise', async () => {
    render(<CreateAgentView />);
    expect(screen.getByLabelText('Agent type')).toHaveValue('text');

    fillIn();
    fireEvent.click(screen.getByRole('button', { name: /create agent/i }));

    await waitFor(() => {
      expect(createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'security-reviewer',
          agent_type: 'text',
        }),
      );
    });
  });

  it('makes a decision agent when asked to', async () => {
    render(<CreateAgentView />);

    fillIn();
    fireEvent.change(screen.getByLabelText('Agent type'), {
      target: { value: 'decision' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create agent/i }));

    await waitFor(() => {
      expect(createAgent).toHaveBeenCalledWith(
        expect.objectContaining({ agent_type: 'decision' }),
      );
    });
  });
});
