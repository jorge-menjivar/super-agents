import type {
  ChatCompletionRequestBody,
  ChatCompletionResponseBody,
} from '@shared/types/api/routes/chat-completions-api';
import { ChatCompletionMessageRole } from '@shared/types/api/routes/shared/messages';
import { render, screen } from '@testing-library/react';
import { ChatCompletionsAPIViewer } from '@web/components/agents/skills/logs/components/completion-viewer/chat-completions-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-themes', () => ({
  useTheme: vi.fn(() => ({ resolvedTheme: 'light' })),
}));

interface GenericViewerProps {
  children: React.ReactNode;
  defaultValue: string;
  variant?: string;
  defaultCollapsed?: boolean;
}

// `defaultCollapsed` is surfaced because a chain of thought is only welcome
// above the answer while it is shut.
vi.mock('@web/components/agents/skills/logs/components/generic-viewer', () => ({
  GenericViewer: ({
    children,
    defaultValue,
    variant,
    defaultCollapsed,
  }: GenericViewerProps) => (
    <div
      data-testid="generic-viewer"
      data-variant={variant}
      data-collapsed={defaultCollapsed ? 'true' : 'false'}
    >
      {children}
      <div data-testid="viewer-content">{defaultValue}</div>
    </div>
  ),
}));

const requestBody = {
  model: 'glm-5.3-flash',
  messages: [
    { role: ChatCompletionMessageRole.USER, content: 'What is 17*23?' },
  ],
} as ChatCompletionRequestBody;

function responseWith(
  message: ChatCompletionResponseBody['choices'][number]['message'],
): ChatCompletionResponseBody {
  return {
    id: 'chatcmpl-871',
    object: 'chat.completion',
    created: 1234567890,
    model: 'glm-5.3-flash',
    choices: [{ index: 0, message, finish_reason: 'stop' }],
  } as ChatCompletionResponseBody;
}

describe('ChatCompletionsAPIViewer - thinking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows what the model thought before it answered', () => {
    render(
      <ChatCompletionsAPIViewer
        logId="log-1"
        saRequestBody={requestBody}
        saResponseBody={responseWith({
          role: ChatCompletionMessageRole.ASSISTANT,
          content: '391',
          content_blocks: [
            { type: 'thinking', thinking: '17 * 23 = 340 + 51' },
            { type: 'text', text: '391' },
          ],
        })}
      />,
    );

    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('17 * 23 = 340 + 51')).toBeInTheDocument();
    // The answer keeps its own card, under the thinking.
    expect(screen.getByText('391')).toBeInTheDocument();
  });

  it('keeps the thinking shut, so the answer stays on the screen', () => {
    render(
      <ChatCompletionsAPIViewer
        logId="log-1"
        saRequestBody={requestBody}
        saResponseBody={responseWith({
          role: ChatCompletionMessageRole.ASSISTANT,
          content: '391',
          content_blocks: [
            { type: 'thinking', thinking: '17 * 23 = 340 + 51' },
            { type: 'text', text: '391' },
          ],
        })}
      />,
    );

    const [thinking, answer] = screen.getAllByTestId('generic-viewer');
    expect(thinking).toHaveAttribute('data-collapsed', 'true');
    expect(answer).toHaveAttribute('data-collapsed', 'false');
  });

  it('draws nothing for an answer that did no thinking', () => {
    render(
      <ChatCompletionsAPIViewer
        logId="log-1"
        saRequestBody={requestBody}
        saResponseBody={responseWith({
          role: ChatCompletionMessageRole.ASSISTANT,
          content: '391',
        })}
      />,
    );

    expect(screen.queryByText('Reasoning')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('generic-viewer')).toHaveLength(1);
  });

  it('draws nothing when the only blocks are the answer itself', () => {
    render(
      <ChatCompletionsAPIViewer
        logId="log-1"
        saRequestBody={requestBody}
        saResponseBody={responseWith({
          role: ChatCompletionMessageRole.ASSISTANT,
          content: '391',
          content_blocks: [{ type: 'text', text: '391' }],
        })}
      />,
    );

    expect(screen.queryByText('Reasoning')).not.toBeInTheDocument();
  });
});
