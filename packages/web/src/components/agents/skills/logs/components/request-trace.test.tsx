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

/**
 * A request that spent four minutes before the provider and 1.4 seconds in
 * it: the two names at the end have nowhere of their own to sit.
 */
const lopsided: TraceStage[] = [
  { ...stages[0], ms: 242_000 },
  { ...stages[1], ms: 1_400 },
  { ...stages[2], ms: 3_200 },
];

const labelFor = (name: string): HTMLElement =>
  screen.getByText(name, { exact: false }).parentElement as HTMLElement;

describe('describeTrace', () => {
  it('reads the whole request as a sentence, for a reader who cannot see it', () => {
    expect(describeTrace(stages, 123_959)).toBe(
      'The request took 2m 4s: routing 1m 49s, provider 7.9s, review 7.1s.',
    );
  });
});

describe('placeStages', () => {
  it('starts each name where its own segment starts', () => {
    const starts = placeStages(stages).map((stage) => stage.start);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBeCloseTo(0.879, 3);
    expect(starts[2]).toBeCloseTo(0.942, 3);
  });

  it('keeps names on one row while each has room', () => {
    expect(placeStages(stages).map((stage) => stage.row)).toEqual([0, 0, 0]);
    expect(placeStages(stages).every((stage) => !stage.atEnd)).toBe(true);
  });

  it('drops a name to a second row rather than let it touch the one before', () => {
    // The review begins 0.6% after the provider, which is far less than the
    // provider's name needs, so it goes under it instead of beside it.
    expect(placeStages(lopsided).map((stage) => stage.row)).toEqual([0, 0, 1]);
  });

  it('lays the names out against the width the card actually has', () => {
    // The same three names that share a line on a wide card cannot on a
    // narrow one, where the review no longer clears the provider.
    expect(placeStages(stages, 900).map((stage) => stage.row)).toEqual([
      0, 0, 1,
    ]);
    expect(placeStages(stages, 900).map((stage) => stage.atEnd)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('gives every name a row of its own when none of them can share', () => {
    expect(placeStages(stages, 150).map((stage) => stage.row)).toEqual([
      0, 1, 2,
    ]);
  });

  it('pulls a name back to the end when it would run off it', () => {
    expect(placeStages(lopsided).map((stage) => stage.atEnd)).toEqual([
      false,
      true,
      true,
    ]);
  });
});

describe('RequestTrace', () => {
  it('draws each stage as long as it took', () => {
    render(<RequestTrace stages={stages} total={123_959} />);

    const widths = Array.from(screen.getByRole('img').children).map(
      (child) => (child as HTMLElement).style.flexGrow,
    );
    expect(widths).toEqual(['108950', '7867', '7142']);
  });

  it('tells the provider apart from the gateway and the hooks by colour', () => {
    render(<RequestTrace stages={stages} total={123_959} />);

    const [gateway, provider, hook] = Array.from(
      screen.getByRole('img').children,
    );
    expect(gateway.className).toContain('bg-stone-300');
    expect(provider.className).toContain('bg-teal-600');
    expect(hook.className).toContain('bg-amber-600');
  });

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

  it('sets each name at the left edge of the stage it belongs to', () => {
    render(<RequestTrace stages={stages} total={123_959} />);

    // Nothing sits in front of the word, so the word is what lines up.
    expect(labelFor('routing').style.left).toBe('0%');
    expect(Number.parseFloat(labelFor('provider').style.left)).toBeCloseTo(
      87.9,
      1,
    );
    expect(Number.parseFloat(labelFor('review').style.left)).toBeCloseTo(
      94.2,
      1,
    );
  });

  it('holds every name on one line when each has room', () => {
    render(<RequestTrace stages={stages} total={123_959} />);

    for (const name of ['routing', 'provider', 'review']) {
      expect(labelFor(name).style.top).toBe('5px');
    }
  });

  it('stacks and pulls back the names of stages with nowhere to sit', () => {
    render(<RequestTrace stages={lopsided} total={246_600} />);

    const provider = labelFor('provider');
    const review = labelFor('review');
    expect(provider.style.right).toBe('0px');
    expect(review.style.right).toBe('0px');
    expect(provider.style.top).toBe('5px');
    expect(review.style.top).toBe('20px');
    expect(labelFor('routing').style.left).toBe('0%');
  });
});
