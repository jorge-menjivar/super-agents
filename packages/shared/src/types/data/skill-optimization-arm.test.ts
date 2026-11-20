import { SkillOptimizationArmParams } from '@shared/types/data/skill-optimization-arm';
import { describe, expect, it } from 'vitest';

const params = {
  model_id: '123e4567-e89b-12d3-a456-426614174000',
  temperature_min: 0,
  temperature_max: 1,
  top_p_min: 0,
  top_p_max: 1,
  top_k_min: 0,
  top_k_max: 1,
  frequency_penalty_min: 0,
  frequency_penalty_max: 0,
  presence_penalty_min: 0,
  presence_penalty_max: 0,
  thinking_min: 0,
  thinking_max: 0,
};

describe('SkillOptimizationArmParams', () => {
  it('takes a system prompt', () => {
    expect(
      SkillOptimizationArmParams.parse({
        ...params,
        system_prompt: 'Be brief.',
      }).system_prompt,
    ).toBe('Be brief.');
  });

  // A decision skill the gateway creates has no policy until someone writes
  // one. Arms stored that way have to read back, or every request to the
  // skill fails on reading them.
  it('takes an empty system prompt, which is no prompt', () => {
    expect(
      SkillOptimizationArmParams.parse({ ...params, system_prompt: '' })
        .system_prompt,
    ).toBe('');
  });
});
