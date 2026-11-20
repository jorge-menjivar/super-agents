import { shouldTriggerRealtimeEvaluation } from '@api/utils/realtime-evaluations';
import { FunctionName } from '@shared/types/api/request';
import { describe, expect, it } from 'vitest';

const url = (path: string) => new URL(`http://localhost:3000${path}`);

describe('shouldTriggerRealtimeEvaluation', () => {
  it('evaluates an answered gateway request', () => {
    expect(
      shouldTriggerRealtimeEvaluation(
        200,
        url('/v1/chat/completions'),
        FunctionName.CHAT_COMPLETE,
      ),
    ).toBe(true);
  });

  it('leaves a failed request alone', () => {
    expect(
      shouldTriggerRealtimeEvaluation(
        503,
        url('/v1/chat/completions'),
        FunctionName.CHAT_COMPLETE,
      ),
    ).toBe(false);
  });

  it("leaves the dashboard's own API alone", () => {
    expect(
      shouldTriggerRealtimeEvaluation(200, url('/v1/super-agents/agents')),
    ).toBe(false);
  });

  // A decision model answers with probabilities, and the evaluations are
  // LLMs reading text.
  it("leaves a decision model's answer alone", () => {
    expect(
      shouldTriggerRealtimeEvaluation(
        200,
        url('/v1/agents/guard/systemone'),
        FunctionName.SYSTEM_ONE,
      ),
    ).toBe(false);
  });
});
