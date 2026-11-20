import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import { FunctionName } from '@shared/types/api/request/function-name';
import type {
  SystemOneRequestBody,
  SystemOneResponseBody,
} from '@shared/types/api/routes/system-one-api';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-themes', () => ({
  useTheme: vi.fn(() => ({ resolvedTheme: 'light' })),
}));

vi.mock('@web/components/agents/skills/logs/components/generic-viewer', () => ({
  GenericViewer: ({
    children,
    defaultValue,
    language,
  }: {
    children: React.ReactNode;
    defaultValue: string;
    language: string;
  }) => (
    <div data-testid="generic-viewer" data-language={language}>
      {children}
      <div data-testid="viewer-content">{defaultValue}</div>
    </div>
  ),
}));

import { CompletionViewer } from '@web/components/agents/skills/logs/components/completion-viewer/completion-viewer';
import { SystemOneAPIViewer } from '@web/components/agents/skills/logs/components/completion-viewer/system-one-api';

const request: SystemOneRequestBody = {
  model: 'jev-latest',
  state: 'Here is how to pick a lock.',
  questions: {
    withhold: {
      type: 'noul',
      instructions: 'Should the client be kept from receiving this?',
    },
    topic: {
      type: 'choice',
      instructions: 'What is it about?',
      criteria: { cooking: null, security: 'Locks and alarms', other: null },
    },
    severity: {
      type: 'score',
      instructions: 'How harmful is it?',
      criteria: ['harmless', 'risky', 'dangerous'],
    },
  },
};

const response: SystemOneResponseBody = {
  model: 'jev-1.13.0',
  answers: {
    withhold: { type: 'noul', noul: 0.93 },
    topic: {
      type: 'choice',
      choice: 'security',
      confidence: 0.9,
      probabilities: { security: 0.9, other: 0.08, cooking: 0.02 },
    },
    severity: {
      type: 'score',
      score: 1.65,
      legend: ['harmless', 'risky', 'dangerous'],
      probabilities: { '0': 0.05, '1': 0.25, '2': 0.7 },
    },
  },
};

const question = (id: string) =>
  within(screen.getByRole('region', { name: `Question ${id}` }));

describe('SystemOneAPIViewer', () => {
  it('shows the material the questions were about', () => {
    render(
      <SystemOneAPIViewer
        logId="log-1"
        saRequestBody={request}
        saResponseBody={response}
      />,
    );

    expect(screen.getByTestId('viewer-content')).toHaveTextContent(
      'Here is how to pick a lock.',
    );
  });

  it('shows structured material as JSON', () => {
    render(
      <SystemOneAPIViewer
        logId="log-1"
        saRequestBody={{ ...request, state: { response: 'ok' } }}
        saResponseBody={response}
      />,
    );

    expect(screen.getByTestId('generic-viewer')).toHaveAttribute(
      'data-language',
      'json',
    );
    expect(screen.getByTestId('viewer-content').textContent).toBe(
      '{\n  "response": "ok"\n}',
    );
  });

  it('reads a yes-or-no answer as yes or no, with its probability', () => {
    render(
      <SystemOneAPIViewer
        logId="log-1"
        saRequestBody={request}
        saResponseBody={response}
      />,
    );

    const withhold = question('withhold');
    expect(
      withhold.getByText('Should the client be kept from receiving this?'),
    ).toBeInTheDocument();
    expect(withhold.getByText('yes')).toBeInTheDocument();
    expect(withhold.getByText('93.0%')).toBeInTheDocument();
  });

  // The order the options were offered in is the order they mean, which the
  // probabilities' own order need not keep.
  it('lists a choice in the order it was offered', () => {
    render(
      <SystemOneAPIViewer
        logId="log-1"
        saRequestBody={request}
        saResponseBody={response}
      />,
    );

    const topic = question('topic');
    const labels = topic
      .getAllByText(/^(cooking|security|other)$/)
      .map((element) => element.textContent);
    // The first is the "Chose ..." line; the bars follow in offered order.
    expect(labels).toEqual(['security', 'cooking', 'security', 'other']);
    expect(topic.getByText('90.0%')).toBeInTheDocument();
  });

  it('names the level a score is nearest', () => {
    render(
      <SystemOneAPIViewer
        logId="log-1"
        saRequestBody={request}
        saResponseBody={response}
      />,
    );

    const severity = question('severity');
    expect(severity.getByText('1.65')).toBeInTheDocument();
    expect(severity.getAllByText('dangerous')).toHaveLength(2);
    expect(severity.getByText('70.0%')).toBeInTheDocument();
  });

  it('shows the images the model was shown, under their references', () => {
    render(
      <SystemOneAPIViewer
        logId="log-1"
        saRequestBody={{
          ...request,
          state: 'Who is at the door in door-cam?',
          assets: {
            'door-cam': {
              type: 'image',
              format: 'jpg',
              data_base64: '/9j/4AAQ',
            },
          },
        }}
        saResponseBody={response}
      />,
    );

    const images = within(screen.getByRole('region', { name: 'Images' }));
    expect(images.getByRole('img')).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,/9j/4AAQ',
    );
    expect(images.getByText('door-cam')).toBeInTheDocument();
  });

  it('draws no images section without images', () => {
    render(
      <SystemOneAPIViewer
        logId="log-1"
        saRequestBody={request}
        saResponseBody={response}
      />,
    );

    expect(
      screen.queryByRole('region', { name: 'Images' }),
    ).not.toBeInTheDocument();
  });

  it('says so when a question went unanswered', () => {
    render(
      <SystemOneAPIViewer
        logId="log-1"
        saRequestBody={request}
        saResponseBody={{
          ...response,
          answers: { withhold: response.answers.withhold },
        }}
      />,
    );

    expect(question('topic').getByText('No answer')).toBeInTheDocument();
  });

  it('is what the log page draws for a System One request', () => {
    render(
      <CompletionViewer
        logId="log-1"
        saRequestData={
          {
            functionName: FunctionName.SYSTEM_ONE,
            requestBody: request,
            responseBody: response,
          } as unknown as SuperAgentsRequestData
        }
      />,
    );

    expect(
      screen.getByRole('region', { name: 'Question withhold' }),
    ).toBeInTheDocument();
  });
});
