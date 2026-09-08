import { render, screen } from '@testing-library/react';
import {
  describeTrace,
  placeStages,
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

describe('placeStages', () => {
  it('puts each stage at the middle of its own share of the request', () => {
    // routing spans 0-87.9% of the request, provider 87.9-94.2%, review
    // 94.2-100%, so each middle is the centre of its own share.
    const middles = placeStages(stages).map((stage) => stage.middle);
    expect(middles[0]).toBeCloseTo(0.439, 3);
    expect(middles[1]).toBeCloseTo(0.911, 3);
    expect(middles[2]).toBeCloseTo(0.971, 3);
  });
});

describe('RequestTrace', () => {
  it('names every stage with its own duration', () => {
    render(<RequestTrace stages={stages} total={123_959} />);

    const timing = screen.getByRole('region', { name: 'Timing' });
    expect(timing).toHaveTextContent('routing');
    expect(timing).toHaveTextContent('1m 49s');
    expect(timing).toHaveTextContent('provider');
    expect(timing).toHaveTextContent('7.9s');
    expect(timing).toHaveTextContent('review');
    expect(timing).toHaveTextContent('7.1s');
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

  it('sets each label over its own stage, not in a row beside the bar', () => {
    render(<RequestTrace stages={stages} total={123_959} />);

    const routing = screen.getByText('routing').parentElement as HTMLElement;
    const provider = screen.getByText('provider').parentElement as HTMLElement;
    const review = screen.getByText('review').parentElement as HTMLElement;

    // The long stage is named over its own middle, not beside the bar.
    expect(Number.parseFloat(routing.style.left)).toBeCloseTo(43.9, 1);
    expect(routing.style.transform).toBe('translateX(-50%)');

    // The two short ones end at the right, so their labels anchor there
    // rather than overflowing the bar. Their risers still point at them.
    expect(provider.style.right).toBe('0px');
    expect(review.style.right).toBe('0px');
  });

  it('alternates rows so neighbouring labels cannot overlap', () => {
    render(<RequestTrace stages={stages} total={123_959} />);

    const tops = ['routing', 'provider', 'review'].map(
      (label) =>
        (screen.getByText(label).parentElement as HTMLElement).style.top,
    );
    expect(tops).toEqual(['7px', '24px', '7px']);
  });

  it('keeps two stages on one row, since they cannot collide', () => {
    render(<RequestTrace stages={stages.slice(0, 2)} total={116_817} />);

    const tops = ['routing', 'provider'].map(
      (label) =>
        (screen.getByText(label).parentElement as HTMLElement).style.top,
    );
    expect(tops).toEqual(['7px', '7px']);
  });
});
