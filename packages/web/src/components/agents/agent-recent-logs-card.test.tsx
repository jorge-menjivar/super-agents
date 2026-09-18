import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The agent dashboard's recent-logs preview: agent-wide scope, a labeled
 * header row (an unlabeled table left readers guessing what the columns
 * mean), the skill that served each log, and a click-through to the
 * agent-wide logs page.
 *
 * It reads the same way the logs page does -- how the request ended and how
 * it was judged, not only what was asked of it -- through the same cells, so
 * a card cannot end up unable to show a failure the table shows.
 */

const navigateToLogDetail = vi.fn();

const logs = vi.hoisted(() => ({
  value: [
    {
      id: 'log-1',
      skill_id: 'skill-2',
      function_name: 'chat_complete',
      model: 'glm-5.3',
      status: 200,
      start_time: new Date('2026-09-03T10:15:30Z').getTime(),
      end_time: new Date('2026-09-03T10:15:31Z').getTime(),
      duration: 1200,
      avg_eval_score: 0.82,
    },
  ] as unknown[],
}));

const navigate = vi.fn();
const queryLogSummaries = vi.hoisted(() => vi.fn());

vi.mock('@web/hooks/use-permissive-navigate', () => ({
  usePermissiveNavigate: () => navigate,
}));

vi.mock('@web/providers/agents', () => ({
  useAgents: () => ({
    selectedAgent: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'menjivar-website',
    },
  }),
}));

vi.mock('@web/providers/navigation', () => ({
  useNavigation: () => ({ navigateToLogDetail }),
}));

vi.mock('@web/providers/skills', () => ({
  useSkills: () => ({
    skills: [{ id: 'skill-2', name: 'generate-thread-titles' }],
  }),
}));

vi.mock('@web/api/v1/super-agents/observability/logs', () => ({
  queryLogSummaries: (...args: unknown[]) => queryLogSummaries(...args),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentRecentLogsCard } from '@web/components/agents/agent-recent-logs-card';

const renderCard = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AgentRecentLogsCard />
    </QueryClientProvider>,
  );

describe('AgentRecentLogsCard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const completedLog = {
    id: 'log-1',
    skill_id: 'skill-2',
    function_name: 'chat_complete',
    model: 'glm-5.3',
    status: 200,
    start_time: new Date('2026-09-03T10:15:30Z').getTime(),
    end_time: new Date('2026-09-03T10:15:31Z').getTime(),
    duration: 1200,
    avg_eval_score: 0.82,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    logs.value = [completedLog];
    queryLogSummaries.mockImplementation(() => Promise.resolve(logs.value));
  });

  it('labels the columns and names the skill that served each log', async () => {
    renderCard();

    expect(
      await screen.findByText('generate-thread-titles'),
    ).toBeInTheDocument();
    // The card shows five rows, so it asks for five -- not the logs page's
    // fifty, whose rows it would throw away.
    expect(queryLogSummaries).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: '11111111-1111-4111-8111-111111111111',
        limit: 5,
      }),
    );
    for (const header of [
      'Status',
      'Eval',
      'Function',
      'Model',
      'Skill',
      'Time',
      'Duration',
    ]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
    expect(screen.getByText('1200ms')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
  });

  it('shows a request that is still running, counting up', async () => {
    // Frozen: the elapsed time is read from `Date.now()` when the cell first
    // renders, and a slow render (under coverage) would turn 2.0s into 2.1s.
    vi.useFakeTimers({ toFake: ['Date'] });
    logs.value = [
      {
        id: 'log-running',
        skill_id: 'skill-2',
        function_name: 'chat_complete',
        model: null,
        status: null,
        start_time: Date.now() - 2000,
        end_time: null,
        duration: null,
        avg_eval_score: null,
      },
    ];

    renderCard();

    expect(await screen.findByTestId('running-log-row')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('2.0s')).toBeInTheDocument();
  });

  it('shows a request that failed', async () => {
    logs.value = [
      {
        id: 'log-failed',
        skill_id: 'skill-2',
        function_name: 'chat_complete',
        model: null,
        status: 502,
        start_time: new Date('2026-09-03T10:15:30Z').getTime(),
        end_time: new Date('2026-09-03T10:15:31Z').getTime(),
        duration: 40,
        avg_eval_score: null,
      },
    ];

    renderCard();

    expect(await screen.findByText('502')).toBeInTheDocument();
  });

  it('opens the agent-wide logs page from a button of its own', async () => {
    renderCard();

    // The card itself is not the control: a card that swallowed every click
    // could not have rows that went anywhere else, and a div with an onClick
    // is reachable by pointer alone.
    fireEvent.click(await screen.findByRole('button', { name: /view all/i }));

    expect(navigate).toHaveBeenCalledWith({
      to: '/agents/menjivar-website/logs',
    });
  });

  it('opens one request from its own row', async () => {
    renderCard();

    const row = await screen.findByRole('button', {
      name: /chat_complete at .*200/i,
    });
    fireEvent.click(row);

    expect(navigateToLogDetail).toHaveBeenCalledWith(
      'menjivar-website',
      'log-1',
    );
    // And the row does not also take the reader to the list.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reaches every row by keyboard, not by pointer alone', async () => {
    renderCard();

    const row = await screen.findByRole('button', {
      name: /chat_complete at .*200/i,
    });
    row.focus();
    expect(row).toHaveFocus();
  });
});
