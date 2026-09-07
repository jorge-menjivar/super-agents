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
const setAgentId = vi.fn();
const setSkillId = vi.fn();
const setAgentWide = vi.fn();

vi.mock('@web/hooks/use-permissive-navigate', () => ({
  usePermissiveNavigate: () => navigate,
}));

vi.mock('@web/providers/agents', () => ({
  useAgents: () => ({
    selectedAgent: { id: 'agent-1', name: 'menjivar-website' },
  }),
}));

vi.mock('@web/providers/skills', () => ({
  useSkills: () => ({
    skills: [{ id: 'skill-2', name: 'generate-thread-titles' }],
  }),
}));

vi.mock('@web/providers/logs', () => ({
  useLogs: () => ({
    logs: logs.value,
    isLoading: false,
    setAgentId,
    setSkillId,
    setAgentWide,
  }),
}));

import { AgentRecentLogsCard } from '@web/components/agents/agent-recent-logs-card';

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
    logs.value = [completedLog];
  });

  it('labels the columns and names the skill that served each log', () => {
    render(<AgentRecentLogsCard />);

    expect(setAgentWide).toHaveBeenCalledWith(true);
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
    expect(screen.getByText('generate-thread-titles')).toBeInTheDocument();
    expect(screen.getByText('1200ms')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
  });

  it('shows a request that is still running, counting up', () => {
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

    render(<AgentRecentLogsCard />);

    expect(screen.getByTestId('running-log-row')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('2.0s')).toBeInTheDocument();
  });

  it('shows a request that failed', () => {
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

    render(<AgentRecentLogsCard />);

    expect(screen.getByText('502')).toBeInTheDocument();
  });

  it('opens the agent-wide logs page', () => {
    render(<AgentRecentLogsCard />);

    fireEvent.click(screen.getByText('Recent requests across all skills'));

    expect(navigate).toHaveBeenCalledWith({
      to: '/agents/menjivar-website/logs',
    });
  });
});
