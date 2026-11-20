import { FunctionName } from '@shared/types/api/request';
import { isOptimizedFunction } from '@shared/utils/optimized-functions';
import { describe, expect, it } from 'vitest';

describe('isOptimizedFunction', () => {
  it('is every request a skill system prompt shapes', () => {
    for (const functionName of [
      FunctionName.CHAT_COMPLETE,
      FunctionName.STREAM_CHAT_COMPLETE,
      FunctionName.CREATE_MODEL_RESPONSE,
      // Its system prompt is the policy each question is asked under.
      FunctionName.SYSTEM_ONE,
    ]) {
      expect(isOptimizedFunction(functionName)).toBe(true);
    }
  });

  it('is none that has no system prompt to evolve', () => {
    expect(isOptimizedFunction(FunctionName.EMBED)).toBe(false);
    expect(isOptimizedFunction(undefined)).toBe(false);
    expect(isOptimizedFunction(null)).toBe(false);
  });
});
