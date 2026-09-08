import { render, screen } from '@testing-library/react';
import {
  describeTrace,
  RequestTrace,
} from '@web/components/agents/skills/logs/components/request-trace';
import type { TraceStage } from '@web/utils/log-trace';
import { describe, expect, it } from 'vitest';

/** The real shape of a withheld request: the model had 6% of it. */
const stages: TraceStage[] = [
  {
    key: 'gateway-0',
    kind: 'gateway',
    label: 'routing',
    detail: 'Choosing the skill.',
    ms: 108_950,
  },
  {
    key: 'provider-0',
    kind: 'provider',
    label: 'provider',
    detail: 'The provider answering.',
    ms: 7_867,
  },
  {
    key: 'hook-1',
    kind: 'hook',
    label: 'review',
    detail: 'The reviewer judging the response.',
    ms: 7_142,
  },
];

describe('describeTrace', () => {
  it('reads the whole request as a sentence, for a reader who cannot see it', () => {
    expect(describeTrace(stages, 123_959)).toBe(
      'The request took 2m 4s: routing 1m 49s, provider 7.9s, review 7.1s.',
    );
  });
});

describe('RequestTrace', () => {
  it('names every stage with its own duration, and the request with its total', () => {
    render(<RequestTrace stages={stages} total={123_959} />);

    const timing = screen.getByRole('region', { name: 'Timing' });
    expect(timing).toHaveTextContent('routing');
    expect(timing).toHaveTextContent('1m 49s');
    expect(timing).toHaveTextContent('provider');
    expect(timing).toHaveTextContent('7.9s');
    expect(timing).toHaveTextContent('review');
    expect(timing).toHaveTextContent('7.1s');
    expect(timing).toHaveTextContent('total');
    expect(timing).toHaveTextContent('2m 4s');
  });

  it('draws each stage as long as it took', () => {
    const { container } = render(
      <RequestTrace stages={stages} total={123_959} />,
    );

    const bar = screen.getByRole('img');
    const widths = Array.from(bar.children).map(
      (child) => (child as HTMLElement).style.flexGrow,
    );
    expect(widths).toEqual(['108950', '7867', '7142']);
    // Every stage keeps a floor, so a short one is never invisible.
    expect(container.querySelectorAll('.min-w-\\[2px\\]')).toHaveLength(3);
  });

  it('tells the provider apart from the gateway and the hooks by colour', () => {
    render(<RequestTrace stages={stages} total={123_959} />);

    const bar = screen.getByRole('img');
    const [gateway, provider, hook] = Array.from(bar.children);
    expect(gateway.className).toContain('bg-muted-foreground/40');
    expect(provider.className).toContain('bg-teal-500');
    expect(hook.className).toContain('bg-amber-500');
  });
});
