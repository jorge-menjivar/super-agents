import { shouldTriggerRealtimeEvaluation } from '@api/utils/realtime-evaluations';
import { describe, expect, it } from 'vitest';

const url = (path: string) => new URL(`http://localhost:3000${path}`);

describe('shouldTriggerRealtimeEvaluation', () => {
  it('evaluates an answered gateway request', () => {
    expect(
      shouldTriggerRealtimeEvaluation(200, url('/v1/chat/completions')),
    ).toBe(true);
  });

  it('leaves a failed request alone', () => {
    expect(
      shouldTriggerRealtimeEvaluation(503, url('/v1/chat/completions')),
    ).toBe(false);
  });

  it("leaves the dashboard's own API alone", () => {
    expect(
      shouldTriggerRealtimeEvaluation(200, url('/v1/super-agents/agents')),
    ).toBe(false);
  });

  // A decision skill is judged like any other, by the methods that read
  // decisions.
  it("evaluates a decision model's answer", () => {
    expect(
      shouldTriggerRealtimeEvaluation(200, url('/v1/agents/guard/systemone')),
    ).toBe(true);
  });
});
