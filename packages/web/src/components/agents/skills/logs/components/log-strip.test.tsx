import { fireEvent, render, screen } from '@testing-library/react';
import { LogStrip } from '@web/components/agents/skills/logs/components/log-strip';
import { describe, expect, it } from 'vitest';

describe('LogStrip', () => {
  it('is shut to begin with, showing only what it decided', () => {
    render(
      <LogStrip name="Hooks" note="1 ran · Denied by reviewer:system-safety">
        <p>The reason it was denied.</p>
      </LogStrip>,
    );

    expect(screen.getByText('Hooks')).toBeInTheDocument();
    expect(
      screen.getByText('1 ran · Denied by reviewer:system-safety'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('The reason it was denied.'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('opens and shuts again on the summary', () => {
    render(
      <LogStrip name="Hooks" note="1 ran">
        <p>The reason it was denied.</p>
      </LogStrip>,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('The reason it was denied.')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button'));
    expect(
      screen.queryByText('The reason it was denied.'),
    ).not.toBeInTheDocument();
  });

  it('names the region it opens, so its content is reachable by name', () => {
    render(
      <LogStrip name="Evaluations" note="2 ran" defaultOpen>
        <p>Task Completion 92%.</p>
      </LogStrip>,
    );

    expect(
      screen.getByRole('region', { name: 'Evaluations' }),
    ).toHaveTextContent('Task Completion 92%.');
  });

  it('can be asked to open on arrival', () => {
    render(
      <LogStrip name="Routing" note="embedding" defaultOpen>
        <p>Matched at 0.87.</p>
      </LogStrip>,
    );

    expect(screen.getByText('Matched at 0.87.')).toBeInTheDocument();
  });
});
