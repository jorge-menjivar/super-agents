import { EvaluationMethodName } from '@shared/types/evaluations';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  type EvaluationDetail,
  EvaluationResults,
} from '@web/components/agents/skills/logs/components/evaluation-results';
import { describe, expect, it } from 'vitest';

const evaluation = (
  extra: Partial<EvaluationDetail> = {},
): EvaluationDetail => ({
  method: EvaluationMethodName.TASK_COMPLETION,
  score: 0.92,
  sections: [{ label: 'Reasoning', content: 'It did what was asked.' }],
  judgeModelName: 'glm-5.3-flash:cloud',
  judgeModelProvider: 'ollama',
  ...extra,
});

describe('EvaluationResults', () => {
  it('gives each judge one line: what it measured, its score and who scored it', () => {
    render(<EvaluationResults evaluations={[evaluation()]} />);

    expect(screen.getByText('Task Completion')).toBeVisible();
    expect(screen.getByText('92%')).toHaveClass('text-green-600');
    expect(screen.getByText(/glm-5.3-flash:cloud/)).toBeVisible();
    // Its reasoning waits until it is asked for.
    expect(
      screen.queryByText('It did what was asked.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('1 note')).toBeVisible();
  });

  it('opens a judge to what it wrote, in one click rather than three', () => {
    render(<EvaluationResults evaluations={[evaluation()]} />);

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Reasoning')).toBeVisible();
    expect(screen.getByText('It did what was asked.')).toBeVisible();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('answers the pointer, and turns its chevron rather than swapping it', () => {
    render(<EvaluationResults evaluations={[evaluation()]} />);

    const row = screen.getByRole('button');
    expect(row.className).toContain('hover:bg-muted/60');
    // One chevron that turns: the quarter turn is what says it is opening,
    // and it is dropped for a reader who asked for less motion.
    const chevron = row.querySelector('svg') as SVGElement;
    expect(chevron.getAttribute('class')).toContain('transition-transform');
    expect(chevron.getAttribute('class')).toContain(
      'motion-reduce:transition-none',
    );
    expect(chevron.getAttribute('class')).not.toContain('rotate-90');

    fireEvent.click(row);
    expect(
      (row.querySelector('svg') as SVGElement).getAttribute('class'),
    ).toContain('rotate-90');
  });

  it('colours a weak score apart from a good one', () => {
    render(
      <EvaluationResults
        evaluations={[
          evaluation({ score: 0.1, method: EvaluationMethodName.LATENCY }),
        ]}
      />,
    );

    expect(screen.getByText('10%')).toHaveClass('text-amber-500');
  });

  it('says nothing about a judge that was not a model', () => {
    render(
      <EvaluationResults
        evaluations={[
          evaluation({
            method: EvaluationMethodName.LATENCY,
            judgeModelName: null,
            judgeModelProvider: null,
            sections: [],
          }),
        ]}
      />,
    );

    expect(screen.getByText('Latency')).toBeVisible();
    expect(screen.queryByText(/notes?$/)).not.toBeInTheDocument();
  });
});
